// ===== Static data layer =====
// Replaces the original Flask backend. On first call, fetches meta.json
// (chars + indexes); per-character stroke/median data is loaded lazily
// from shard files (data/graphics/N.json).
const dataAPI = (() => {
  let metaPromise = null;
  const shardCache = new Map(); // shardIdx → Promise<obj>

  // Tone-mark normalization for pinyin search.
  const TONE_MAP = {
    "ā":"a","á":"a","ǎ":"a","à":"a",
    "ē":"e","é":"e","ě":"e","è":"e",
    "ī":"i","í":"i","ǐ":"i","ì":"i",
    "ō":"o","ó":"o","ǒ":"o","ò":"o",
    "ū":"u","ú":"u","ǔ":"u","ù":"u",
    "ǖ":"u","ǘ":"u","ǚ":"u","ǜ":"u","ü":"u",
  };
  function normalizePinyin(s) {
    s = s.toLowerCase();
    let out = "";
    for (const c of s) out += TONE_MAP[c] || c;
    return out;
  }

  function loadMeta() {
    if (!metaPromise) {
      metaPromise = fetch("data/meta.json").then((r) => {
        if (!r.ok) throw new Error(`meta.json: ${r.status}`);
        return r.json();
      });
    }
    return metaPromise;
  }

  // Each character lives in shard (codepoint mod n_shards). We learn n_shards
  // from meta, but for getChar we can use it directly without waiting for
  // the full meta — the formula is fixed at build time.
  // To avoid that coupling, we always go through meta which sets n_shards.
  async function loadShard(idx) {
    if (!shardCache.has(idx)) {
      shardCache.set(
        idx,
        fetch(`data/graphics/${idx}.json`).then((r) => {
          if (!r.ok) throw new Error(`shard ${idx}: ${r.status}`);
          return r.json();
        })
      );
    }
    return shardCache.get(idx);
  }

  async function getChar(ch) {
    const meta = await loadMeta();
    const idx = ch.codePointAt(0) % meta.n_shards;
    const shard = await loadShard(idx);
    const g = shard[ch];
    if (!g) throw new Error(`Character ${ch} not in dataset`);
    const cm = meta.char_meta[ch] || {};
    return {
      strokes: g.strokes,
      medians: g.medians,
      stroke_types: g.stroke_types || null,
      pinyin: cm.p || [],
      definition: cm.d || "",
      radical: cm.r || "",
      decomposition: cm.i || "",
    };
  }

  async function listRadicals() {
    const meta = await loadMeta();
    return meta.radicals;
  }

  async function radicalChars(rad, limit = 120) {
    const meta = await loadMeta();
    const chars = (meta.rad_index[rad] || []).slice(0, limit);
    return {
      radical: rad,
      characters: chars.map((ch) => {
        const cm = meta.char_meta[ch] || {};
        return {
          character: ch,
          pinyin: cm.p || [],
          definition: cm.d || "",
          n_strokes: cm.n || 0,
        };
      }),
    };
  }

  async function lookupIDS(ids) {
    const meta = await loadMeta();
    const chars = meta.ids_index[ids] || [];
    return chars.slice(0, 8).map((ch) => {
      const cm = meta.char_meta[ch] || {};
      return {
        character: ch,
        pinyin: cm.p || [],
        definition: cm.d || "",
        n_strokes: cm.n || 0,
        decomposition: ids,
      };
    });
  }

  async function searchPinyin(query) {
    const meta = await loadMeta();
    const q = normalizePinyin(query);
    if (!q) return [];
    const exact = [], prefix = [], contains = [];
    const seen = new Set();
    // pinyin_index entries: [normalized, char, original_pinyin]
    for (const [npy, ch] of meta.pinyin_index) {
      if (seen.has(ch)) continue;
      if (npy === q) { exact.push(ch); seen.add(ch); }
      else if (npy.startsWith(q)) { prefix.push(ch); seen.add(ch); }
      else if (npy.includes(q)) { contains.push(ch); seen.add(ch); }
    }
    const out = [];
    for (const ch of [...exact, ...prefix, ...contains].slice(0, 100)) {
      const cm = meta.char_meta[ch] || {};
      out.push({
        character: ch,
        pinyin: cm.p || [],
        definition: cm.d || "",
        n_strokes: cm.n || 0,
      });
    }
    return out;
  }

  async function searchDefinition(query) {
    const meta = await loadMeta();
    const q = query.toLowerCase();
    if (!q) return [];
    const out = [];
    // def_index entries: [char, lowercased_definition]
    for (const [ch, defn] of meta.def_index) {
      if (defn.includes(q)) {
        const cm = meta.char_meta[ch] || {};
        out.push({
          character: ch,
          pinyin: cm.p || [],
          definition: cm.d || "",
          n_strokes: cm.n || 0,
        });
        if (out.length >= 50) break;
      }
    }
    return out;
  }

  async function searchByStrokeCount(n, maxN) {
    const meta = await loadMeta();
    const lo = Math.min(n, maxN ?? n);
    const hi = Math.max(n, maxN ?? n);
    const out = [];
    for (const ch of meta.chars) {
      const cm = meta.char_meta[ch] || {};
      if (cm.n >= lo && cm.n <= hi) {
        out.push({
          character: ch,
          pinyin: cm.p || [],
          definition: cm.d || "",
          n_strokes: cm.n,
        });
        if (out.length >= 200) break;
      }
    }
    out.sort((a, b) => a.n_strokes - b.n_strokes || a.character.localeCompare(b.character));
    return out;
  }

  async function randomChar() {
    const meta = await loadMeta();
    const ch = meta.chars[Math.floor(Math.random() * meta.chars.length)];
    const cm = meta.char_meta[ch] || {};
    return { character: ch, pinyin: cm.p || [], definition: cm.d || "" };
  }

  return {
    getChar,
    listRadicals,
    radicalChars,
    lookupIDS,
    searchPinyin,
    searchDefinition,
    searchByStrokeCount,
    randomChar,
  };
})();

// ===== Data model =====
// Each stroke:
//   { d, median, controls: [{idx, dx, dy}], tx, ty, sx, sy, label, selected }
//   - controls: list of control points (indices into median array) and their
//     deltas in MMH coords. Always includes median[0] and median[last] as
//     the first/last entries. Interior controls added at detected corners.
const state = {
  strokes: [],
  selected: new Set(),  // indices of selected strokes
  selectedHandles: new Set(),  // strings "strokeIdx:cidx" for selected control points
  drag: null,
  showHandles: true,
  showGuides: true,
  marquee: null,
  collapsedLayers: new Set(),  // source-character keys whose layer is collapsed in the list
  hiddenLayers: new Set(),     // layer keys whose strokes are hidden from canvas
  // Viewport: SVG viewBox in MMH coords. Default fills the 1024x1024 canvas.
  viewBox: { x: 0, y: 0, w: 1024, h: 1024 },
};

// ===== History (undo/redo) =====
// Snapshots are JSON-stringified copies of state.strokes. We push BEFORE any
// mutating operation. Capped at HISTORY_LIMIT entries.
// (Named editHistory to avoid clash with window.history.)
const HISTORY_LIMIT = 100;
const editHistory = {
  past: [],
  future: [],
};

function snapshotStrokes() {
  return JSON.stringify(state.strokes);
}

function pushHistory() {
  editHistory.past.push(snapshotStrokes());
  if (editHistory.past.length > HISTORY_LIMIT) editHistory.past.shift();
  editHistory.future = [];
}

function undo() {
  if (editHistory.past.length === 0) return;
  const current = snapshotStrokes();
  const prev = editHistory.past.pop();
  editHistory.future.push(current);
  state.strokes = JSON.parse(prev);
  state.selected = new Set();
  state.selectedHandles = new Set();
  renderStrokes();
}

function redo() {
  if (editHistory.future.length === 0) return;
  const current = snapshotStrokes();
  const next = editHistory.future.pop();
  editHistory.past.push(current);
  state.strokes = JSON.parse(next);
  state.selected = new Set();
  state.selectedHandles = new Set();
  renderStrokes();
}

// ===== Path bbox =====
function pathBBox(d) {
  const nums = d.match(/-?\d+(\.\d+)?/g);
  if (!nums || nums.length < 2) return { x: 0, y: 0, w: 1024, h: 1024 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = +nums[i], y = +nums[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function unionBBox(boxes) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  boxes.forEach((b) => {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function transformPathD(d, fn) {
  return d.replace(/(-?\d+(\.\d+)?)\s+(-?\d+(\.\d+)?)/g, (_m, x, _x2, y) => {
    const [nx, ny] = fn(+x, +y);
    return `${nx.toFixed(2)} ${ny.toFixed(2)}`;
  });
}

// ===== Detect corners in median =====
// Returns sorted array of median indices that are control points.
// Approach: at each interior point compute the angle between vectors
// median[i-w..i] and median[i..i+w] (windowed, smoother). Then pick local
// maxima above a threshold, enforcing a minimum arc-length gap between
// neighboring controls so we don't double-pick the same bend.
function detectCornerIndices(median, angleThresholdDeg = 40, minArcGap = 0.18) {
  if (!median || median.length < 3) {
    return median && median.length >= 1 ? [0, median.length - 1] : [];
  }
  const arc = medianArcLengths(median);
  const total = arc[arc.length - 1] || 1;
  const thr = (angleThresholdDeg * Math.PI) / 180;
  const w = 2; // window radius (samples on each side)
  // Score each interior index by windowed turn angle.
  const scores = new Array(median.length).fill(0);
  for (let i = w; i < median.length - w; i++) {
    const aL = median[i - w], aR = median[i + w], b = median[i];
    const v1x = b[0] - aL[0], v1y = b[1] - aL[1];
    const v2x = aR[0] - b[0], v2y = aR[1] - b[1];
    const l1 = Math.hypot(v1x, v1y) || 1e-6;
    const l2 = Math.hypot(v2x, v2y) || 1e-6;
    const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
    scores[i] = Math.acos(Math.max(-1, Math.min(1, dot)));
  }
  // Collect candidates above threshold; sort by score descending, greedy
  // non-max suppression by arc-length distance.
  const candidates = [];
  for (let i = 0; i < median.length; i++) {
    if (scores[i] > thr) candidates.push({ i, score: scores[i], t: arc[i] / total });
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept = [0, median.length - 1];
  const keptT = [0, 1];
  // Also exclude any candidate too close to an endpoint along the arc.
  for (const c of candidates) {
    if (keptT.every((kt) => Math.abs(kt - c.t) >= minArcGap)) {
      kept.push(c.i);
      keptT.push(c.t);
    }
  }
  return kept.sort((a, b) => a - b);
}

// Compute cumulative arc-length along the median.
function medianArcLengths(median) {
  const arr = [0];
  for (let i = 1; i < median.length; i++) {
    arr.push(arr[i - 1] + Math.hypot(
      median[i][0] - median[i - 1][0],
      median[i][1] - median[i - 1][1]
    ));
  }
  return arr;
}

// Given a point (x,y) and median, find the parameter t (arc-length fraction
// along the median) of the nearest point on the polyline.
function nearestArcParam(x, y, median, arc) {
  const total = arc[arc.length - 1] || 1;
  let bestD2 = Infinity, bestParam = 0;
  for (let i = 0; i < median.length - 1; i++) {
    const ax = median[i][0], ay = median[i][1];
    const bx = median[i + 1][0], by = median[i + 1][1];
    const dx = bx - ax, dy = by - ay;
    const segLen2 = dx * dx + dy * dy || 1e-6;
    let t = ((x - ax) * dx + (y - ay) * dy) / segLen2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestParam = (arc[i] + t * (arc[i + 1] - arc[i])) / total;
    }
  }
  return bestParam;
}

// ===== Multi-control-point warp =====
// For each point in the path:
//  1. Find its parameter t along the median (0..1).
//  2. Find which two adjacent control points bracket t.
//  3. Linearly interpolate their deltas based on t between them.
//  4. Apply a global falloff so points far from the median get partial warp.
function applyControlWarp(d, median, controls) {
  if (!median || median.length < 2 || !controls || controls.length === 0) return d;
  const arc = medianArcLengths(median);
  const totalLen = arc[arc.length - 1] || 1;
  // Build sorted controls by median index; precompute t for each.
  const cps = controls
    .filter((c) => c.idx >= 0 && c.idx < median.length)
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((c) => ({ t: arc[c.idx] / totalLen, dx: c.dx || 0, dy: c.dy || 0, idx: c.idx }));
  if (cps.length === 0) return d;
  // Ensure endpoints are covered.
  if (cps[0].t > 0) cps.unshift({ t: 0, dx: cps[0].dx, dy: cps[0].dy });
  if (cps[cps.length - 1].t < 1) cps.push({ t: 1, dx: cps[cps.length - 1].dx, dy: cps[cps.length - 1].dy });

  return transformPathD(d, (x, y) => {
    const t = nearestArcParam(x, y, median, arc);
    // Find bracketing CPs.
    let i = 0;
    while (i < cps.length - 1 && cps[i + 1].t < t) i++;
    const a = cps[i], b = cps[Math.min(i + 1, cps.length - 1)];
    const span = b.t - a.t || 1e-6;
    const u = Math.max(0, Math.min(1, (t - a.t) / span));
    // Smoothstep between adjacent controls so the transition is gentle.
    const w = u * u * (3 - 2 * u);
    const dx = a.dx + (b.dx - a.dx) * w;
    const dy = a.dy + (b.dy - a.dy) * w;
    return [x + dx, y + dy];
  });
}

// Position of a given control's median point AFTER its own delta is applied
// (other controls' deltas don't move it, since at its own t the interpolation
// gives exactly its own delta).
function controlPos(median, controls, idx) {
  const cp = controls.find((c) => c.idx === idx);
  const base = median[idx];
  return [base[0] + (cp ? cp.dx : 0), base[1] + (cp ? cp.dy : 0)];
}

// Densify: add controls for every median index not already covered, with
// deltas computed by interpolating the existing warp at that point. This
// ensures the median curve follows the warp precisely, even between corner
// controls. Densification controls are marked ui:false (hidden from handles).
function densifyControls(stroke) {
  const { median, controls } = stroke;
  if (!median || median.length < 2) return;
  const arc = medianArcLengths(median);
  const total = arc[arc.length - 1] || 1;
  const cps = controls
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((c) => ({ t: arc[c.idx] / total, dx: c.dx, dy: c.dy, idx: c.idx }));
  if (cps.length === 0) return;
  if (cps[0].t > 0) cps.unshift({ t: 0, dx: cps[0].dx, dy: cps[0].dy });
  if (cps[cps.length - 1].t < 1) cps.push({ t: 1, dx: cps[cps.length - 1].dx, dy: cps[cps.length - 1].dy });
  const existing = new Set(controls.map((c) => c.idx));
  const additions = [];
  for (let i = 0; i < median.length; i++) {
    if (existing.has(i)) continue;
    const t = arc[i] / total;
    let k = 0;
    while (k < cps.length - 1 && cps[k + 1].t < t) k++;
    const a = cps[k], b = cps[Math.min(k + 1, cps.length - 1)];
    const span = b.t - a.t || 1e-6;
    const u = Math.max(0, Math.min(1, (t - a.t) / span));
    const w = u * u * (3 - 2 * u);
    const dx = a.dx + (b.dx - a.dx) * w;
    const dy = a.dy + (b.dy - a.dy) * w;
    additions.push({ idx: i, dx, dy, ui: false });
  }
  stroke.controls = controls.concat(additions).sort((a, b) => a.idx - b.idx);
}

// Inverse: drop ui:false controls to simplify back. (Optional, called after
// resize-drag ends — currently we keep them, as they don't hurt anything.)
function simplifyControls(stroke) {
  stroke.controls = stroke.controls.filter((c) => c.ui !== false);
}

// "Bake" the current warp into the path data and median, then reset controls
// to fresh corners with zero deltas. After baking, the stroke renders the same
// as before but the data state is "clean" — useful before starting a new edit
// operation so densified/stale controls don't cause kinks.
function bakeWarp(stroke) {
  if (!stroke.median || stroke.median.length < 2) return;
  if (!stroke.controls || stroke.controls.length === 0) return;
  // Skip if no warp deltas are present (everything is at zero already).
  const hasDelta = stroke.controls.some((c) => Math.abs(c.dx) > 1e-6 || Math.abs(c.dy) > 1e-6);
  if (!hasDelta) {
    // Still drop densified controls so the UI shows only corners.
    simplifyControls(stroke);
    return;
  }
  // Bake the path: apply current warp to d.
  stroke.d = applyControlWarp(stroke.d, stroke.median, stroke.controls);
  // Bake the median: each median point is displaced by the warp at its own t.
  const arc = medianArcLengths(stroke.median);
  const total = arc[arc.length - 1] || 1;
  const cps = stroke.controls
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((c) => ({ t: arc[c.idx] / total, dx: c.dx, dy: c.dy }));
  if (cps[0].t > 0) cps.unshift({ t: 0, dx: cps[0].dx, dy: cps[0].dy });
  if (cps[cps.length - 1].t < 1) cps.push({ t: 1, dx: cps[cps.length - 1].dx, dy: cps[cps.length - 1].dy });
  stroke.median = stroke.median.map((pt, i) => {
    const t = arc[i] / total;
    let k = 0;
    while (k < cps.length - 1 && cps[k + 1].t < t) k++;
    const a = cps[k], b = cps[Math.min(k + 1, cps.length - 1)];
    const span = b.t - a.t || 1e-6;
    const u = Math.max(0, Math.min(1, (t - a.t) / span));
    const w = u * u * (3 - 2 * u);
    const dx = a.dx + (b.dx - a.dx) * w;
    const dy = a.dy + (b.dy - a.dy) * w;
    return [pt[0] + dx, pt[1] + dy];
  });
  // Reset controls to corners-only with zero deltas, recomputed on the new median.
  const corners = detectCornerIndices(stroke.median);
  stroke.controls = corners.map((idx) => ({ idx, dx: 0, dy: 0, ui: true }));
}

// Project (x,y) onto a median polyline; return [px, py] = the nearest point
// on the polyline.
function projectOntoMedian(x, y, median) {
  let bestD2 = Infinity, bestPx = median[0][0], bestPy = median[0][1];
  for (let i = 0; i < median.length - 1; i++) {
    const ax = median[i][0], ay = median[i][1];
    const bx = median[i + 1][0], by = median[i + 1][1];
    const dx = bx - ax, dy = by - ay;
    const segLen2 = dx * dx + dy * dy || 1e-6;
    let t = ((x - ax) * dx + (y - ay) * dy) / segLen2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (d2 < bestD2) { bestD2 = d2; bestPx = px; bestPy = py; }
  }
  return [bestPx, bestPy];
}

// Scale each path point's perpendicular distance from the median by `factor`.
// factor < 1 -> thinner, factor > 1 -> thicker. Endpoints (projection == self)
// stay fixed. Modifies stroke.d in place. Does NOT modify median/controls,
// so endpoint dragging still works the same.
function thinThickenStroke(stroke, factor) {
  if (!stroke.median || stroke.median.length < 2) return;
  stroke.d = transformPathD(stroke.d, (x, y) => {
    const [px, py] = projectOntoMedian(x, y, stroke.median);
    // New position = median point + factor * (point - median point).
    return [px + (x - px) * factor, py + (y - py) * factor];
  });
}

// ===== Render =====
function renderStrokes() {
  const layer = document.getElementById("strokesLayer");
  const guides = document.getElementById("guidesLayer");
  // Sync viewBox to state.
  const editor = document.getElementById("editor");
  const vb = state.viewBox;
  editor.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  layer.innerHTML = "";
  // Determine which layer each stroke belongs to so we can skip hidden ones.
  const strokeLayerKey = [];
  {
    let cur = null, layerIdx = -1;
    state.strokes.forEach((s, i) => {
      const src = sourceCharOf(s);
      if (!cur || cur.src !== src) { cur = { src }; layerIdx++; }
      strokeLayerKey.push(`${src}#${layerIdx}`);
    });
  }
  // Guides
  guides.innerHTML = "";
  if (state.showGuides) {
    // Outer square + 9-grid (Mi-zi-ge style: cross + diagonals).
    const ns = "http://www.w3.org/2000/svg";
    const mk = (x1, y1, x2, y2, cls) => {
      const l = document.createElementNS(ns, "line");
      l.setAttribute("x1", x1); l.setAttribute("y1", y1);
      l.setAttribute("x2", x2); l.setAttribute("y2", y2);
      l.setAttribute("class", "guide " + cls);
      return l;
    };
    // Mid-cross
    guides.appendChild(mk(512, 0, 512, 1024, "g-cross"));
    guides.appendChild(mk(0, 512, 1024, 512, "g-cross"));
    // Diagonals
    guides.appendChild(mk(0, 0, 1024, 1024, "g-diag"));
    guides.appendChild(mk(1024, 0, 0, 1024, "g-diag"));
    // Outer border
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", 0); r.setAttribute("y", 0);
    r.setAttribute("width", 1024); r.setAttribute("height", 1024);
    r.setAttribute("class", "guide g-border");
    guides.appendChild(r);
  }
  // Strokes
  state.strokes.forEach((s, i) => {
    if (state.hiddenLayers.has(strokeLayerKey[i])) return;
    let d = s.d;
    if (s.controls && s.controls.length > 0) {
      d = applyControlWarp(d, s.median, s.controls);
    }
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    const sx = s.sx ?? 1, sy = s.sy ?? 1, tx = s.tx ?? 0, ty = s.ty ?? 0;
    p.setAttribute("transform", `translate(${tx} ${ty}) scale(${sx} ${sy})`);
    if (state.selected.has(i)) p.classList.add("selected");
    p.dataset.idx = i;
    p.addEventListener("mousedown", onStrokeMouseDown);
    layer.appendChild(p);
  });
  // Handles (drawn after strokes so they're on top)
  if (state.showHandles) {
    state.strokes.forEach((s, i) => {
      if (!s.median || s.median.length < 2) return;
      if (state.hiddenLayers.has(strokeLayerKey[i])) return;
      const sx = s.sx ?? 1, sy = s.sy ?? 1, tx = s.tx ?? 0, ty = s.ty ?? 0;
      s.controls.forEach((cp, ci) => {
        if (cp.ui === false) return;  // densification-only control, no UI handle
        const [mx, my] = controlPos(s.median, s.controls, cp.idx);
        const hx = mx * sx + tx, hy = my * sy + ty;
        const isEndpoint = cp.idx === 0 || cp.idx === s.median.length - 1;
        const handleKey = `${i}:${ci}`;
        const isSelected = state.selectedHandles.has(handleKey);
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("cx", hx);
        c.setAttribute("cy", hy);
        c.setAttribute("r", isEndpoint ? 18 : 14);
        c.setAttribute("class",
          "handle" +
          (state.selected.has(i) ? " sel" : "") +
          (isEndpoint ? " endpoint" : " corner") +
          (isSelected ? " handle-multi" : "")
        );
        c.dataset.idx = i;
        c.dataset.cidx = ci;
        c.addEventListener("mousedown", onHandleMouseDown);
        layer.appendChild(c);
      });
    });
  }
  // Selection bounding box (only when 2+ strokes selected)
  if (state.selected.size >= 2 && !state.drag) {
    const bb = selectionBBox();
    if (bb) drawSelectionBBox(layer, bb);
  }
  // Marquee box
  if (state.marquee) {
    const m = state.marquee;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", x); r.setAttribute("y", y);
    r.setAttribute("width", w); r.setAttribute("height", h);
    r.setAttribute("class", "marquee");
    layer.appendChild(r);
  }
  renderStrokeList();
}

// ===== Selection bounding box =====
// Returns {x0, y0, x1, y1} in MMH layer coords, or null.
function selectionBBox() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  state.selected.forEach((i) => {
    const s = state.strokes[i];
    // Compute current rendered bbox = pathBBox(warped d) * (sx,sy) + (tx,ty)
    let d = s.d;
    if (s.controls && s.controls.length > 0) {
      d = applyControlWarp(d, s.median, s.controls);
    }
    const bb = pathBBox(d);
    const sx = s.sx ?? 1, sy = s.sy ?? 1, tx = s.tx ?? 0, ty = s.ty ?? 0;
    const ax = bb.x * sx + tx, bx = (bb.x + bb.w) * sx + tx;
    const ay = bb.y * sy + ty, by = (bb.y + bb.h) * sy + ty;
    x0 = Math.min(x0, ax, bx); x1 = Math.max(x1, ax, bx);
    y0 = Math.min(y0, ay, by); y1 = Math.max(y1, ay, by);
  });
  if (x0 === Infinity) return null;
  return { x0, y0, x1, y1 };
}

// 8 resize handles named by edge/corner. Each has the "anchor" coordinate
// that stays fixed and which axis it scales.
const RESIZE_HANDLES = [
  { name: "nw", x: "x0", y: "y1", sx: 1, sy: 1 },  // top-left in flipped coords: high y
  { name: "n",  x: null, y: "y1", sx: 0, sy: 1 },
  { name: "ne", x: "x1", y: "y1", sx: 1, sy: 1 },
  { name: "e",  x: "x1", y: null, sx: 1, sy: 0 },
  { name: "se", x: "x1", y: "y0", sx: 1, sy: 1 },
  { name: "s",  x: null, y: "y0", sx: 0, sy: 1 },
  { name: "sw", x: "x0", y: "y0", sx: 1, sy: 1 },
  { name: "w",  x: "x0", y: null, sx: 1, sy: 0 },
];

function drawSelectionBBox(layer, bb) {
  const ns = "http://www.w3.org/2000/svg";
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", bb.x0);
  rect.setAttribute("y", bb.y0);
  rect.setAttribute("width", bb.x1 - bb.x0);
  rect.setAttribute("height", bb.y1 - bb.y0);
  rect.setAttribute("class", "sel-bbox");
  layer.appendChild(rect);
  // Handle positions. Remember we're in MMH y-up coords (rendered flipped).
  // In MMH "y0" (small y) = bottom of glyph visually; "y1" (large y) = top.
  // The handle "n" should be at top edge visually = y1 in MMH, ymid for x.
  const xmid = (bb.x0 + bb.x1) / 2;
  const ymid = (bb.y0 + bb.y1) / 2;
  function posFor(h) {
    let x, y;
    if (h.x === "x0") x = bb.x0;
    else if (h.x === "x1") x = bb.x1;
    else x = xmid;
    if (h.y === "y0") y = bb.y0;
    else if (h.y === "y1") y = bb.y1;
    else y = ymid;
    return [x, y];
  }
  RESIZE_HANDLES.forEach((h) => {
    const [hx, hy] = posFor(h);
    const c = document.createElementNS(ns, "rect");
    c.setAttribute("x", hx - 14);
    c.setAttribute("y", hy - 14);
    c.setAttribute("width", 28);
    c.setAttribute("height", 28);
    c.setAttribute("class", "resize-handle resize-" + h.name);
    c.dataset.h = h.name;
    c.addEventListener("mousedown", (e) => onResizeMouseDown(e, h, bb));
    layer.appendChild(c);
  });
}

// Extract source character from a stroke's label. Labels are typically
// "<char> #<n>" — we take the first whitespace-separated token. Handle copies
// like "<char> #N (copy)" too.
function sourceCharOf(stroke) {
  const lbl = stroke.label || "";
  // Match the first non-space token.
  const m = lbl.match(/^\s*(\S+)/);
  return m ? m[1] : "?";
}

function renderStrokeList() {
  const list = document.getElementById("strokeList");
  list.innerHTML = "";
  const layers = [];
  let cur = null;
  state.strokes.forEach((s, i) => {
    const src = sourceCharOf(s);
    if (!cur || cur.src !== src) {
      cur = { src, strokes: [], indices: [] };
      layers.push(cur);
    }
    cur.strokes.push(s);
    cur.indices.push(i);
  });

  layers.forEach((layer, layerIdx) => {
    const layerKey = `${layer.src}#${layerIdx}`;
    const collapsed = state.collapsedLayers.has(layerKey);
    const hidden = state.hiddenLayers.has(layerKey);
    const layerSel = layer.indices.filter((i) => state.selected.has(i)).length;
    const header = document.createElement("div");
    header.className = "stroke-layer-header" + (collapsed ? " collapsed" : "") + (hidden ? " hidden" : "");
    header.dataset.layerKey = layerKey;
    header.dataset.layerIdx = layerIdx;
    header.innerHTML = `
      <span class="caret" data-layer-act="toggle">▾</span>
      <span class="source-ch" data-layer-act="toggle">${layer.src}</span>
      <span class="layer-count" data-layer-act="toggle">${layer.strokes.length} stroke${layer.strokes.length === 1 ? "" : "s"}${layerSel ? `, ${layerSel} selected` : ""}</span>
      <div class="layer-actions">
        <button data-layer-act="visibility" title="${hidden ? "Show" : "Hide"} layer">${hidden ? "👁" : "🙈"}</button>
        <button data-layer-act="select" title="Select all in layer (shift to add)">⊕</button>
        <button data-layer-act="addToComposer" title="Add layer to composer as a component">→C</button>
        <button data-layer-act="del" title="Delete layer">×</button>
      </div>
    `;
    list.appendChild(header);

    const layerDiv = document.createElement("div");
    layerDiv.className = "stroke-layer" + (collapsed ? " collapsed" : "");
    layer.indices.forEach((i) => {
      const s = state.strokes[i];
      const div = document.createElement("div");
      div.className = "stroke-item" + (state.selected.has(i) ? " selected" : "");
      div.dataset.idx = i;
      const typeBadge = s.type
        ? `<span class="stroke-type" title="${s.type.name}">${s.type.glyph || ""} <small>${s.type.abbrev}</small></span>`
        : "";
      div.innerHTML = `
        <span class="num">#${i + 1}</span>
        ${typeBadge}
        <span class="stroke-label" style="flex:1">${s.label || "stroke"}</span>
        <button data-row-act="up" title="Move up">↑</button>
        <button data-row-act="down" title="Move down">↓</button>
        <button data-row-act="thick" title="Thicker">▓</button>
        <button data-row-act="thin" title="Thinner">░</button>
        <button data-row-act="dup" title="Duplicate">⎘</button>
        <button data-row-act="reset" title="Reset warp">↺</button>
        <button data-row-act="del" title="Delete">×</button>
      `;
      layerDiv.appendChild(div);
    });
    list.appendChild(layerDiv);
  });
  // Toolbar for multi-select
  const tb = document.getElementById("multiToolbar");
  if (state.selected.size > 1) {
    tb.style.display = "flex";
    tb.querySelector("#selCount").textContent = `${state.selected.size} strokes selected`;
  } else {
    tb.style.display = "none";
  }
}

// One delegated click listener on the stroke list element. Robust against
// rerenders and removes any class of "listener never got attached" bugs.
document.getElementById("strokeList").addEventListener("click", (e) => {
  const layerActEl = e.target.closest("[data-layer-act]");
  const rowBtn = e.target.closest("button[data-row-act]");
  const row = e.target.closest(".stroke-item");

  if (rowBtn) {
    e.stopPropagation();
    const rowEl = rowBtn.closest(".stroke-item");
    const idx = +rowEl.dataset.idx;
    const act = rowBtn.dataset.rowAct;
    if (isNaN(idx)) return;
    pushHistory();
    if (act === "del") deleteStrokes([idx]);
    else if (act === "up" && idx > 0) {
      [state.strokes[idx - 1], state.strokes[idx]] = [state.strokes[idx], state.strokes[idx - 1]];
    } else if (act === "down" && idx < state.strokes.length - 1) {
      [state.strokes[idx + 1], state.strokes[idx]] = [state.strokes[idx], state.strokes[idx + 1]];
    } else if (act === "reset") {
      state.strokes[idx].controls = state.strokes[idx].controls.map(
        (cp) => ({ ...cp, dx: 0, dy: 0 })
      );
    } else if (act === "thick") {
      thinThickenStroke(state.strokes[idx], 1.15);
    } else if (act === "thin") {
      thinThickenStroke(state.strokes[idx], 1 / 1.15);
    } else if (act === "dup") {
      duplicateStrokes([idx]);
    }
    renderStrokes();
    return;
  }

  if (layerActEl) {
    const header = layerActEl.closest(".stroke-layer-header");
    if (!header) return;
    const layerKey = header.dataset.layerKey;
    const layerIdx = +header.dataset.layerIdx;
    const indices = strokesInLayer(layerIdx);
    const act = layerActEl.dataset.layerAct;
    if (act === "toggle") {
      if (state.collapsedLayers.has(layerKey)) state.collapsedLayers.delete(layerKey);
      else state.collapsedLayers.add(layerKey);
      renderStrokes();
    } else if (act === "visibility") {
      if (state.hiddenLayers.has(layerKey)) state.hiddenLayers.delete(layerKey);
      else state.hiddenLayers.add(layerKey);
      renderStrokes();
    } else if (act === "select") {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        indices.forEach((i) => state.selected.add(i));
      } else {
        state.selected = new Set(indices);
      }
      state.selectedHandles = new Set();
      renderStrokes();
    } else if (act === "addToComposer") {
      addLayerToComposer(indices);
    } else if (act === "del") {
      pushHistory();
      deleteStrokes(indices);
      renderStrokes();
    }
    return;
  }

  if (row) {
    const idx = +row.dataset.idx;
    if (isNaN(idx)) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleSelectStroke(idx);
    } else {
      setSelectionSingle(idx);
    }
  }
});

// Helper: get indices of strokes belonging to the Nth layer (by groupings).
function strokesInLayer(layerIdx) {
  let cur = null;
  const layers = [];
  state.strokes.forEach((s, i) => {
    const src = sourceCharOf(s);
    if (!cur || cur.src !== src) {
      cur = { src, indices: [] };
      layers.push(cur);
    }
    cur.indices.push(i);
  });
  return (layers[layerIdx] && layers[layerIdx].indices) || [];
}

// Send a single character (the source of a layer) into the first empty
// composer slot. If all slots are full, replace the last one.
function sendCharToComposer(ch) {
  if (!ch || ch.length !== 1) return;
  // Auto-open composer panel if hidden.
  const panel = document.getElementById("composerPanel");
  if (panel && panel.style.display === "none") {
    panel.style.display = "";
    document.getElementById("toggleComposerBtn").classList.add("active");
  }
  const inputs = Array.from(document.querySelectorAll(".comp")).filter((i) => !i.disabled);
  let target = inputs.find((i) => !i.value.trim());
  if (!target) target = inputs[inputs.length - 1];
  if (target) {
    target.value = ch;
    target.focus();
    target.dispatchEvent(new Event("input", { bubbles: true }));
    // Flash highlight so user notices.
    target.classList.add("flash");
    setTimeout(() => target.classList.remove("flash"), 700);
  }
}

function addLayerToComposer(indices) {
  if (!indices.length) return;
  const src = sourceCharOf(state.strokes[indices[0]]);
  if (src && src.length === 1 && /[\u3400-\u9FFF\uF900-\uFAFF]/.test(src)) {
    sendCharToComposer(src);
  } else {
    alert("This layer's source isn't a single character — composer needs a character.");
  }
}

function setSelectionSingle(i) {
  state.selected = new Set([i]);
  // Drop handle selections that belong to other strokes; keep this stroke's.
  const keep = new Set();
  state.selectedHandles.forEach((k) => {
    if (k.startsWith(i + ":")) keep.add(k);
  });
  state.selectedHandles = keep;
  renderStrokes();
}
function toggleSelectStroke(i) {
  if (state.selected.has(i)) state.selected.delete(i);
  else state.selected.add(i);
  renderStrokes();
}
function clearSelection() {
  state.selected = new Set();
  state.selectedHandles = new Set();
  renderStrokes();
}

// ===== Multi-select actions =====
function deleteStrokes(indices) {
  const set = new Set(indices);
  state.strokes = state.strokes.filter((_, i) => !set.has(i));
  state.selected = new Set();
}
function duplicateStrokes(indices) {
  const sorted = [...indices].sort((a, b) => b - a); // process desc to keep indices stable
  const newSel = new Set();
  sorted.forEach((idx) => {
    const orig = state.strokes[idx];
    const copy = {
      ...orig,
      median: orig.median ? orig.median.map((p) => [...p]) : null,
      controls: orig.controls.map((c) => ({ ...c })),
      tx: (orig.tx ?? 0) + 40,
      ty: (orig.ty ?? 0) - 40,
      label: orig.label + " (copy)",
    };
    state.strokes.splice(idx + 1, 0, copy);
  });
  // Re-select the copies
  // (Skipping the math; just clear selection.)
  state.selected = newSel;
}
function scaleSelected(factor) {
  // Scale around the union centroid of selected strokes' apparent bboxes.
  const sel = [...state.selected];
  if (sel.length === 0) return;
  // Estimate centroid using bbox of each stroke's current path (with transforms).
  // For simplicity use the average of (tx, ty) + bbox midpoint of d * (sx, sy).
  let cx = 0, cy = 0, n = 0;
  sel.forEach((i) => {
    const s = state.strokes[i];
    const bb = pathBBox(s.d);
    const mx = bb.x + bb.w / 2, my = bb.y + bb.h / 2;
    cx += mx * (s.sx ?? 1) + (s.tx ?? 0);
    cy += my * (s.sy ?? 1) + (s.ty ?? 0);
    n++;
  });
  cx /= n; cy /= n;
  sel.forEach((i) => {
    const s = state.strokes[i];
    const sx = s.sx ?? 1, sy = s.sy ?? 1, tx = s.tx ?? 0, ty = s.ty ?? 0;
    // New scale & adjust translate to keep centroid stable:
    //   (px * sx + tx - cx) * factor + cx  ==  px * (sx*factor) + tx'
    //   => tx' = (tx - cx) * factor + cx
    s.sx = sx * factor;
    s.sy = sy * factor;
    s.tx = (tx - cx) * factor + cx;
    s.ty = (ty - cy) * factor + cy;
  });
  renderStrokes();
}

// ===== Mouse =====
function svgPoint(evt) {
  const layer = document.getElementById("strokesLayer");
  const svg = document.getElementById("editor");
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  return pt.matrixTransform(layer.getScreenCTM().inverse());
}

function onStrokeMouseDown(e) {
  const idx = +e.currentTarget.dataset.idx;
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    toggleSelectStroke(idx);
  } else if (!state.selected.has(idx)) {
    setSelectionSingle(idx);
  }
  pushHistory();
  const p = svgPoint(e);
  // Move all selected strokes
  const origPositions = new Map();
  state.selected.forEach((i) => {
    const s = state.strokes[i];
    origPositions.set(i, { tx: s.tx ?? 0, ty: s.ty ?? 0 });
  });
  state.drag = { kind: "move", startX: p.x, startY: p.y, origPositions };
  e.preventDefault();
  e.stopPropagation();
}

function onHandleMouseDown(e) {
  const idx = +e.currentTarget.dataset.idx;
  let cidx = +e.currentTarget.dataset.cidx;
  // Capture the median index BEFORE simplification (which may renumber controls).
  // After simplifying, the cidx might shift but the median idx is stable.
  const stroke = state.strokes[idx];
  const medianIdx = stroke && stroke.controls[cidx] ? stroke.controls[cidx].idx : null;
  const handleKey = `${idx}:${cidx}`;
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    if (state.selectedHandles.has(handleKey)) state.selectedHandles.delete(handleKey);
    else state.selectedHandles.add(handleKey);
    state.selected.add(idx);
    renderStrokes();
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  pushHistory();
  // BUG FIX: densified controls (added during compose or resize) hold stale
  // deltas that, when one corner is dragged, create visible kinks because the
  // warp interpolates linearly between the new corner position and the still-
  // unchanged densified neighbors. Bake the current warp into the path & median
  // and reset to clean corner controls before starting the drag.
  if (stroke && (stroke.controls.some((c) => c.ui === false) ||
                 stroke.controls.some((c) => Math.abs(c.dx) > 1e-6 || Math.abs(c.dy) > 1e-6))) {
    bakeWarp(stroke);
    // Re-find cidx by the captured medianIdx (closest one if exact not found).
    let best = 0, bestDiff = Infinity;
    stroke.controls.forEach((c, i) => {
      const diff = Math.abs(c.idx - medianIdx);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    cidx = best;
  }
  const newKey = `${idx}:${cidx}`;
  if (!state.selectedHandles.has(newKey)) {
    state.selectedHandles = new Set([newKey]);
  }
  setSelectionSingle(idx);
  const p = svgPoint(e);
  const origDeltas = new Map();
  state.selectedHandles.forEach((key) => {
    const [si, ci] = key.split(":").map(Number);
    const cp = state.strokes[si]?.controls[ci];
    if (cp) origDeltas.set(key, { dx: cp.dx, dy: cp.dy });
  });
  state.drag = {
    kind: "control-group",
    startX: p.x,
    startY: p.y,
    origDeltas,
  };
  e.preventDefault();
  e.stopPropagation();
}

function onResizeMouseDown(e, h, bb) {
  pushHistory();
  const p = svgPoint(e);
  const xmid = (bb.x0 + bb.x1) / 2;
  const ymid = (bb.y0 + bb.y1) / 2;
  let anchorX = xmid, anchorY = ymid;
  if (h.x === "x0") anchorX = bb.x1;
  else if (h.x === "x1") anchorX = bb.x0;
  if (h.y === "y0") anchorY = bb.y1;
  else if (h.y === "y1") anchorY = bb.y0;
  // Snapshot, per selected stroke, each control point's CURRENT layer-coord
  // position (post-warp, post-transform). During drag we map each of these
  // points through the bbox scale and set the control delta needed to put
  // the warped median endpoint at that target. Width is preserved because
  // we only move controls, not the path geometry itself.
  const snapshots = new Map();
  state.selected.forEach((i) => {
    const s = state.strokes[i];
    if (!s.median || s.median.length < 2) return;
    // Bake any existing warp into d/median first so we start from a clean state.
    // Otherwise stacked resizes accumulate stale densified controls.
    bakeWarp(s);
    // Densify: add interior median points as ui:false controls so the resize
    // warp follows the median's curve precisely instead of linearly between
    // corner controls.
    densifyControls(s);
    const sx = s.sx ?? 1, sy = s.sy ?? 1, tx = s.tx ?? 0, ty = s.ty ?? 0;
    const ctrlSnap = s.controls.map((cp, ci) => {
      // Current layer-coord position of this control point's median target
      const base = s.median[cp.idx];
      const mx = base[0] + cp.dx;
      const my = base[1] + cp.dy;
      return {
        cidx: ci,
        idx: cp.idx,
        baseX: base[0], baseY: base[1],
        layerX: mx * sx + tx,
        layerY: my * sy + ty,
        origDx: cp.dx, origDy: cp.dy,
      };
    });
    snapshots.set(i, { sx, sy, tx, ty, ctrlSnap });
  });
  state.drag = {
    kind: "resize",
    h, bb,
    anchorX, anchorY,
    startX: p.x, startY: p.y,
    snapshots,
  };
  e.preventDefault();
  e.stopPropagation();
}

function onCanvasMouseDown(e) {
  // Skip if click is on a stroke, handle, or any other interactive element.
  // The selection bbox rect has pointer-events:none so it won't fire here,
  // but the resize handles (also rects) and other shapes might.
  if (e.target.tagName === "path" || e.target.tagName === "circle") return;
  if (e.target.classList && (
      e.target.classList.contains("resize-handle") ||
      e.target.classList.contains("sel-bbox"))) return;
  const p = svgPoint(e);
  state.drag = { kind: "marquee" };
  state.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  if (!(e.shiftKey || e.metaKey || e.ctrlKey)) clearSelection();
  renderStrokes();
  e.preventDefault();
}

function onMouseMove(e) {
  if (!state.drag) return;
  const p = svgPoint(e);
  if (state.drag.kind === "move") {
    const dx = p.x - state.drag.startX;
    const dy = p.y - state.drag.startY;
    state.drag.origPositions.forEach((orig, i) => {
      state.strokes[i].tx = orig.tx + dx;
      state.strokes[i].ty = orig.ty + dy;
    });
  } else if (state.drag.kind === "control-group") {
    const dx = p.x - state.drag.startX;
    const dy = p.y - state.drag.startY;
    state.drag.origDeltas.forEach((orig, key) => {
      const [si, ci] = key.split(":").map(Number);
      const s = state.strokes[si];
      if (!s || !s.controls[ci]) return;
      const sx = s.sx ?? 1, sy = s.sy ?? 1;
      // Convert pointer delta from layer coords into the stroke's own coord
      // system (since the path itself is scaled by sx,sy before applying tx,ty).
      s.controls[ci].dx = orig.dx + dx / sx;
      s.controls[ci].dy = orig.dy + dy / sy;
    });
  } else if (state.drag.kind === "resize") {
    const { h, bb, anchorX, anchorY, snapshots } = state.drag;
    // Scale factors from anchor in layer coords.
    let fx = 1, fy = 1;
    if (h.sx) {
      const draggedX = h.x === "x0" ? bb.x0 : bb.x1;
      const newDraggedX = draggedX + (p.x - state.drag.startX);
      const oldSpan = draggedX - anchorX;
      const newSpan = newDraggedX - anchorX;
      if (Math.abs(oldSpan) > 1) fx = newSpan / oldSpan;
    }
    if (h.sy) {
      const draggedY = h.y === "y0" ? bb.y0 : bb.y1;
      const newDraggedY = draggedY + (p.y - state.drag.startY);
      const oldSpan = draggedY - anchorY;
      const newSpan = newDraggedY - anchorY;
      if (Math.abs(oldSpan) > 1) fy = newSpan / oldSpan;
    }
    if (Math.abs(fx) < 0.01) fx = fx < 0 ? -0.01 : 0.01;
    if (Math.abs(fy) < 0.01) fy = fy < 0 ? -0.01 : 0.01;
    // For each selected stroke: keep sx, sy, tx, ty the same. Adjust each
    // control point's delta so that its median target lands at the scaled
    // layer-coord position. This preserves stroke width: the path geometry
    // (which encodes thickness) is never scaled — only the control points
    // that the warp interpolates between move.
    snapshots.forEach((snap, i) => {
      const s = state.strokes[i];
      const { sx, sy, tx, ty, ctrlSnap } = snap;
      ctrlSnap.forEach((snapCp) => {
        const targLX = (snapCp.layerX - anchorX) * fx + anchorX;
        const targLY = (snapCp.layerY - anchorY) * fy + anchorY;
        // Convert back to (dx, dy) in path-local coords:
        //   layer = (base + d) * scale + translate
        //   d = (layer - translate) / scale - base
        const dx = (targLX - tx) / sx - snapCp.baseX;
        const dy = (targLY - ty) / sy - snapCp.baseY;
        s.controls[snapCp.cidx].dx = dx;
        s.controls[snapCp.cidx].dy = dy;
      });
    });
  } else if (state.drag.kind === "marquee" && state.marquee) {
    state.marquee.x1 = p.x;
    state.marquee.y1 = p.y;
  }
  renderStrokes();
}

function onMouseUp() {
  // Only do anything if we were actually in a drag — otherwise re-rendering
  // on every mouseup anywhere on the page destroys button targets between
  // mousedown and click, swallowing button activations.
  if (!state.drag) return;
  if (state.drag.kind === "marquee" && state.marquee) {
    const m = state.marquee;
    const minX = Math.min(m.x0, m.x1), maxX = Math.max(m.x0, m.x1);
    const minY = Math.min(m.y0, m.y1), maxY = Math.max(m.y0, m.y1);
    const layerKeys = computeStrokeLayerKeys();
    state.strokes.forEach((s, i) => {
      if (state.hiddenLayers.has(layerKeys[i])) return;  // skip hidden
      const bb = pathBBox(s.d);
      const sx = s.sx ?? 1, sy = s.sy ?? 1, tx = s.tx ?? 0, ty = s.ty ?? 0;
      const x0 = bb.x * sx + tx, x1 = (bb.x + bb.w) * sx + tx;
      const y0 = bb.y * sy + ty, y1 = (bb.y + bb.h) * sy + ty;
      if (x1 >= minX && x0 <= maxX && y1 >= minY && y0 <= maxY) {
        state.selected.add(i);
      }
    });
    state.marquee = null;
  }
  state.drag = null;
  renderStrokes();
}
// Note: mousemove/mouseup listeners are attached below (patched versions
// that also handle pan drags).

// ===== API =====
async function fetchChar(ch) {
  return dataAPI.getChar(ch);
}
function strokeFromData(data, ch, i) {
  const median = (data.medians && data.medians[i]) || null;
  const controlIdxs = median ? detectCornerIndices(median) : [];
  const type = (data.stroke_types && data.stroke_types[i]) || null;
  return {
    d: data.strokes[i],
    median,
    // Each control: idx into median, dx/dy delta, ui=true means show as a
    // draggable handle in the editor; ui=false means it's only used as a
    // densification sample for the warp.
    controls: controlIdxs.map((idx) => ({ idx, dx: 0, dy: 0, ui: true })),
    tx: 0, ty: 0, sx: 1, sy: 1,
    label: `${ch} #${i + 1}`,
    type,
  };
}

async function loadChar(ch, append = false) {
  try {
    const data = await fetchChar(ch);
    if (!append) { state.strokes = []; state.selected = new Set(); }
    data.strokes.forEach((_, i) => state.strokes.push(strokeFromData(data, ch, i)));
    renderStrokes();
  } catch (err) { alert(err.message); }
}

// ===== Wire UI =====
document.getElementById("clearBtn").addEventListener("click", () => {
  pushHistory();
  state.strokes = []; state.selected = new Set(); renderStrokes();
});
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("redoBtn").addEventListener("click", redo);
document.getElementById("saveUrlBtn").addEventListener("click", saveStateToURL);

function setComposerVisible(visible) {
  const panel = document.getElementById("composerPanel");
  panel.style.display = visible ? "" : "none";
  document.getElementById("toggleComposerBtn").classList.toggle("active", visible);
}
document.getElementById("toggleComposerBtn").addEventListener("click", () => {
  const panel = document.getElementById("composerPanel");
  setComposerVisible(panel.style.display === "none");
});
document.getElementById("composerClose").addEventListener("click", () => setComposerVisible(false));
document.getElementById("exportBtn").addEventListener("click", () => {
  const svg = document.getElementById("editor").outerHTML;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "hanzi.svg"; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("showHandles").addEventListener("change", (e) => {
  state.showHandles = e.target.checked;
  renderStrokes();
});
document.getElementById("showGuides").addEventListener("change", (e) => {
  state.showGuides = e.target.checked;
  renderStrokes();
});

// Multi-select toolbar
document.getElementById("multiDel").addEventListener("click", () => {
  pushHistory();
  deleteStrokes([...state.selected]);
  renderStrokes();
});
document.getElementById("multiDup").addEventListener("click", () => {
  pushHistory();
  duplicateStrokes([...state.selected]);
  renderStrokes();
});
document.getElementById("multiScaleUp").addEventListener("click", () => { pushHistory(); scaleSelected(1.1); });
document.getElementById("multiScaleDown").addEventListener("click", () => { pushHistory(); scaleSelected(1 / 1.1); });
document.getElementById("multiThicken").addEventListener("click", () => {
  pushHistory();
  state.selected.forEach((i) => thinThickenStroke(state.strokes[i], 1.15));
  renderStrokes();
});
document.getElementById("multiThinner").addEventListener("click", () => {
  pushHistory();
  state.selected.forEach((i) => thinThickenStroke(state.strokes[i], 1 / 1.15));
  renderStrokes();
});
document.getElementById("multiToComposer").addEventListener("click", () => {
  // If all selected strokes come from the same source character, send that
  // character. Otherwise prompt with the source of the first selected stroke.
  const sources = new Set();
  state.selected.forEach((i) => sources.add(sourceCharOf(state.strokes[i])));
  const sorted = [...sources];
  if (sorted.length === 1) {
    sendCharToComposer(sorted[0]);
  } else if (sorted.length > 1) {
    // Mixed sources — send the first; user can swap slots manually.
    const first = sourceCharOf(state.strokes[[...state.selected].sort((a, b) => a - b)[0]]);
    sendCharToComposer(first);
  }
});

document.getElementById("editor").addEventListener("mousedown", onCanvasMouseDown);

// ===== Zoom & pan =====
const MIN_ZOOM_W = 64;     // can zoom in until viewBox is 64x64
const MAX_ZOOM_W = 1024;   // can't zoom out past the 1024x1024 guideline frame

function clampZoom(w) {
  return Math.max(MIN_ZOOM_W, Math.min(MAX_ZOOM_W, w));
}

// Clamp viewBox so the visible area stays within [0..1024]. If the viewBox
// is smaller than 1024 we allow it to slide within the frame; if it's
// exactly 1024 it must sit at origin (0,0).
function clampViewBox(vb) {
  const w = clampZoom(vb.w);
  const h = w;  // square
  // Don't allow panning past the guideline frame.
  const maxX = MAX_ZOOM_W - w;
  const maxY = MAX_ZOOM_W - h;
  const x = Math.max(0, Math.min(maxX, vb.x));
  const y = Math.max(0, Math.min(maxY, vb.y));
  return { x, y, w, h };
}

// Zoom around a point (in viewBox / MMH coords). factor < 1 = zoom in,
// factor > 1 = zoom out (since smaller viewBox = bigger visible content).
function zoomAt(factor, cx, cy) {
  const vb = state.viewBox;
  const newW = clampZoom(vb.w * factor);
  const newH = newW;  // canvas is square (aspect-ratio: 1)
  const realFactor = newW / vb.w;
  // Keep (cx, cy) at the same screen position: new origin moves toward it.
  const newX = cx - (cx - vb.x) * realFactor;
  const newY = cy - (cy - vb.y) * realFactor;
  state.viewBox = clampViewBox({ x: newX, y: newY, w: newW, h: newH });
  renderStrokes();
}

function resetZoom() {
  state.viewBox = { x: 0, y: 0, w: 1024, h: 1024 };
  renderStrokes();
}

document.getElementById("zoomInBtn").addEventListener("click", () => {
  const vb = state.viewBox;
  zoomAt(1 / 1.25, vb.x + vb.w / 2, vb.y + vb.h / 2);
});
document.getElementById("zoomOutBtn").addEventListener("click", () => {
  const vb = state.viewBox;
  zoomAt(1.25, vb.x + vb.w / 2, vb.y + vb.h / 2);
});
document.getElementById("zoomResetBtn").addEventListener("click", resetZoom);

// Custom resize grip on the canvas bottom-right corner. Dragging it sets
// the editor PANEL's flex-basis so the whole column widens (and the canvas
// follows via width:100% + aspect-ratio:1). The other panels share the
// remaining space because they have flex:1 1 0.
(function setupCanvasResize() {
  const grip = document.getElementById("canvasResizeGrip");
  const wrap = document.getElementById("editorWrap");
  const panel = wrap.closest("section.panel");
  if (!grip || !panel) return;

  let dragState = null;
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origPanelWidth: panel.getBoundingClientRect().width,
    };
    wrap.classList.add("resizing");
    document.body.style.cursor = "nwse-resize";
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    // Use the larger of dx, dy so the user can drag any direction along the
    // diagonal; effectively the canvas can only grow uniformly because it's
    // square. Negative deltas shrink.
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    // Take whichever delta is larger in magnitude.
    const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    const targetW = Math.max(280, dragState.origPanelWidth + delta);
    panel.style.flex = `0 0 ${targetW}px`;
  });
  document.addEventListener("mouseup", () => {
    if (!dragState) return;
    dragState = null;
    wrap.classList.remove("resizing");
    document.body.style.cursor = "";
  });

  // Double-click the grip to reset the editor column to its default share.
  grip.addEventListener("dblclick", (e) => {
    e.preventDefault();
    panel.style.flex = "";  // back to default `1 1 0`
  });
})();

// Convert a pointer event to viewBox coords for zoom anchoring.
function pointerToViewBox(e) {
  const svg = document.getElementById("editor");
  const r = svg.getBoundingClientRect();
  const u = (e.clientX - r.left) / r.width;
  const v = (e.clientY - r.top) / r.height;
  const vb = state.viewBox;
  return { x: vb.x + u * vb.w, y: vb.y + v * vb.h };
}

// Wheel = zoom around cursor. Two-finger trackpad scroll usually arrives as
// wheel events with ctrlKey set (pinch gesture) — handle both naturally.
document.getElementById("editor").addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const p = pointerToViewBox(e);
    // deltaY positive = scroll down = zoom out
    const factor = Math.exp(e.deltaY * 0.0015);
    zoomAt(factor, p.x, p.y);
  },
  { passive: false }
);

// Middle-mouse-drag or space-drag = pan. We track pan in state.drag with
// kind="pan" so onMouseMove/Up can handle it like other drags.
let _spaceHeld = false;
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === " " && !_spaceHeld) {
    _spaceHeld = true;
    document.getElementById("editorWrap").classList.add("pan-ready");
    e.preventDefault();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    _spaceHeld = false;
    document.getElementById("editorWrap").classList.remove("pan-ready");
  }
});

// Intercept editor mousedown when middle button or space held, before the
// normal canvas mousedown (which starts a marquee).
document.getElementById("editor").addEventListener(
  "mousedown",
  (e) => {
    if (e.button === 1 || (e.button === 0 && _spaceHeld)) {
      e.preventDefault();
      e.stopPropagation();
      const p = pointerToViewBox(e);
      state.drag = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        origVB: { ...state.viewBox },
      };
      document.getElementById("editorWrap").classList.add("panning");
    }
  },
  true  // capture phase — must run before the marquee handler
);

// Wrap onMouseMove/onMouseUp to handle pan drags too. These are the actual
// document-level listeners (originals are not attached separately).
function onMouseMovePatched(e) {
  if (state.drag && state.drag.kind === "pan") {
    const svg = document.getElementById("editor");
    const r = svg.getBoundingClientRect();
    const dxPixels = e.clientX - state.drag.startX;
    const dyPixels = e.clientY - state.drag.startY;
    const vb = state.drag.origVB;
    const dx = -(dxPixels / r.width) * vb.w;
    const dy = -(dyPixels / r.height) * vb.h;
    state.viewBox = clampViewBox({ x: vb.x + dx, y: vb.y + dy, w: vb.w, h: vb.h });
    renderStrokes();
    return;
  }
  onMouseMove(e);
}
function onMouseUpPatched(e) {
  if (state.drag && state.drag.kind === "pan") {
    state.drag = null;
    document.getElementById("editorWrap").classList.remove("panning");
    return;
  }
  onMouseUp(e);
}
document.addEventListener("mousemove", onMouseMovePatched);
document.addEventListener("mouseup", onMouseUpPatched);

// ===== Touch: pinch-zoom + one-finger pan =====
const touchState = { p1: null, p2: null, startVB: null, startDist: 0, startCenter: null };

function avgTouches(t1, t2) {
  return { clientX: (t1.clientX + t2.clientX) / 2, clientY: (t1.clientY + t2.clientY) / 2 };
}
function touchDist(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

document.getElementById("editor").addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length === 1) {
      // One-finger pan (only if not on a stroke/handle — let those handlers run)
      const t = e.touches[0];
      const target = document.elementFromPoint(t.clientX, t.clientY);
      if (target && (target.tagName === "path" || target.tagName === "circle")) return;
      e.preventDefault();
      touchState.p1 = { clientX: t.clientX, clientY: t.clientY };
      touchState.p2 = null;
      touchState.startVB = { ...state.viewBox };
    } else if (e.touches.length === 2) {
      e.preventDefault();
      touchState.p1 = { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
      touchState.p2 = { clientX: e.touches[1].clientX, clientY: e.touches[1].clientY };
      touchState.startDist = touchDist(e.touches[0], e.touches[1]);
      touchState.startCenter = pointerToViewBox(avgTouches(e.touches[0], e.touches[1]));
      touchState.startVB = { ...state.viewBox };
    }
  },
  { passive: false }
);

document.getElementById("editor").addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length === 1 && touchState.p1 && !touchState.p2) {
      // One-finger pan
      e.preventDefault();
      const t = e.touches[0];
      const svg = document.getElementById("editor");
      const r = svg.getBoundingClientRect();
      const dxPixels = t.clientX - touchState.p1.clientX;
      const dyPixels = t.clientY - touchState.p1.clientY;
      const vb = touchState.startVB;
      const dx = -(dxPixels / r.width) * vb.w;
      const dy = -(dyPixels / r.height) * vb.h;
      state.viewBox = clampViewBox({ x: vb.x + dx, y: vb.y + dy, w: vb.w, h: vb.h });
      renderStrokes();
    } else if (e.touches.length === 2) {
      // Pinch zoom
      e.preventDefault();
      const dist = touchDist(e.touches[0], e.touches[1]);
      const factor = touchState.startDist / dist;  // <1 = zoom in, >1 = zoom out
      const vb0 = touchState.startVB;
      const cx = touchState.startCenter.x;
      const cy = touchState.startCenter.y;
      const newW = clampZoom(vb0.w * factor);
      const realFactor = newW / vb0.w;
      state.viewBox = clampViewBox({
        x: cx - (cx - vb0.x) * realFactor,
        y: cy - (cy - vb0.y) * realFactor,
        w: newW,
        h: newW,
      });
      renderStrokes();
    }
  },
  { passive: false }
);

document.getElementById("editor").addEventListener("touchend", (e) => {
  if (e.touches.length === 0) {
    touchState.p1 = null;
    touchState.p2 = null;
  } else if (e.touches.length === 1) {
    // dropped from 2-finger to 1, refresh anchor
    touchState.p1 = { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    touchState.p2 = null;
    touchState.startVB = { ...state.viewBox };
  }
});


// ===== URL state save/load =====
// Compress state.strokes to a base64-urlsafe gzip string for use in ?state=...
async function encodeStateForURL() {
  const json = JSON.stringify(state.strokes);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).arrayBuffer();
  // Base64-encode the compressed bytes (URL-safe variant).
  let bin = "";
  const bytes = new Uint8Array(compressed);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function decodeStateFromURL(s) {
  // Reverse url-safe base64, decompress, parse JSON.
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

async function saveStateToURL() {
  if (state.strokes.length === 0) {
    alert("Nothing to save");
    return;
  }
  try {
    const encoded = await encodeStateForURL();
    const url = `${location.origin}${location.pathname}?state=${encoded}`;
    // Warn if URL is unusually long.
    if (url.length > 8000) {
      if (!confirm(`URL is ${url.length} characters long — may be truncated by some apps. Copy anyway?`)) return;
    }
    // Update the address bar so the user can bookmark.
    history.replaceState(null, "", url);
    // Try to copy to clipboard.
    try {
      await navigator.clipboard.writeText(url);
      const btn = document.getElementById("saveUrlBtn");
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch {
      prompt("Copy this URL:", url);
    }
  } catch (e) {
    alert("Save failed: " + e.message);
  }
}

async function loadStateFromURL() {
  const params = new URLSearchParams(location.search);
  const s = params.get("state");
  if (!s) return false;
  try {
    state.strokes = await decodeStateFromURL(s);
    state.selected = new Set();
    state.selectedHandles = new Set();
    renderStrokes();
    return true;
  } catch (e) {
    console.error("Failed to load state from URL:", e);
    return false;
  }
}

// Select all strokes (Ctrl/Cmd + A).
// Compute, for each stroke index, the layer key it belongs to.
// Layers group consecutive strokes from the same source character.
function computeStrokeLayerKeys() {
  const keys = [];
  let cur = null, layerIdx = -1;
  state.strokes.forEach((s) => {
    const src = sourceCharOf(s);
    if (!cur || cur.src !== src) { cur = { src }; layerIdx++; }
    keys.push(`${src}#${layerIdx}`);
  });
  return keys;
}

function isStrokeHidden(i) {
  const keys = computeStrokeLayerKeys();
  return state.hiddenLayers.has(keys[i]);
}

function selectAll() {
  const keys = computeStrokeLayerKeys();
  state.selected = new Set(
    state.strokes
      .map((_, i) => i)
      .filter((i) => !state.hiddenLayers.has(keys[i]))
  );
  renderStrokes();
}

// Keyboard
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  const cmd = e.ctrlKey || e.metaKey;
  if (e.key === "Delete" || e.key === "Backspace") {
    if (state.selected.size > 0) {
      pushHistory();
      deleteStrokes([...state.selected]);
      renderStrokes();
      e.preventDefault();
    }
  } else if (cmd && (e.key === "a" || e.key === "A")) {
    selectAll();
    e.preventDefault();
  } else if (cmd && e.shiftKey && (e.key === "z" || e.key === "Z")) {
    // Ctrl/Cmd + Shift + Z = redo (common convention)
    redo();
    e.preventDefault();
  } else if (cmd && (e.key === "z" || e.key === "Z")) {
    undo();
    e.preventDefault();
  } else if (cmd && (e.key === "y" || e.key === "Y")) {
    redo();
    e.preventDefault();
  } else if (cmd && (e.key === "d" || e.key === "D")) {
    if (state.selected.size > 0) {
      pushHistory();
      duplicateStrokes([...state.selected]);
      renderStrokes();
      e.preventDefault();
    }
  } else if (e.key === "Escape") {
    clearSelection();
  }
});

// ===== Composer =====
const LAYOUTS = {
  horizontal: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  vertical: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]],
  enclosure_full: [[0, 0, 1, 1], [0.2, 0.2, 0.6, 0.6]],
  enclosure_top: [[0, 0, 1, 1], [0.2, 0.0, 0.6, 0.7]],
  enclosure_bottom: [[0, 0, 1, 1], [0.2, 0.3, 0.6, 0.7]],
  three_h: [[0, 0, 1/3, 1], [1/3, 0, 1/3, 1], [2/3, 0, 1/3, 1]],
  three_v: [[0, 0, 1, 1/3], [0, 1/3, 1, 1/3], [0, 2/3, 1, 1/3]],
};

document.getElementById("layoutSel").addEventListener("change", (e) => {
  const v = e.target.value;
  document.querySelector('.comp[data-slot="2"]').disabled =
    !(v === "three_h" || v === "three_v");
});

const SLOT_MARGIN = 0.04;

// MMH glyph "body" — the rectangle where typical ink lives. The canvas is
// 1024x1024 but glyphs typically occupy y ∈ [0, 800] with small overshoot
// either side. Composing into the full 0..1024 makes results look stretched
// vertically and biased upward. Centering on the glyph body fixes this.
const GLYPH_BODY_Y_MIN = 0;
const GLYPH_BODY_Y_MAX = 800;
const GLYPH_BODY_HEIGHT = GLYPH_BODY_Y_MAX - GLYPH_BODY_Y_MIN;

function composeStroke(strokeD, median, componentInk, slot) {
  if (!median || median.length < 2) {
    return { d: strokeD, median, controls: [], tx: 0, ty: 0, sx: 1, sy: 1 };
  }
  const [fx, fy, fw, fh] = slot;
  const m = SLOT_MARGIN;
  // Slot rect in MMH coords. X uses the full canvas width (glyphs use full
  // width). Y uses the glyph body (so results sit visually centered).
  const slotX = (fx + fw * m) * 1024;
  const slotW = fw * (1 - 2 * m) * 1024;
  // Slot uses fy=0 at top of glyph body, fy=1 at bottom (UI convention).
  // MMH y goes up, so map: visual top of glyph body = GLYPH_BODY_Y_MAX.
  const slotYbot = GLYPH_BODY_Y_MIN + (1 - fy - fh + fh * m) * GLYPH_BODY_HEIGHT;
  const slotH = fh * (1 - 2 * m) * GLYPH_BODY_HEIGHT;
  function mapPt([x, y]) {
    const u = (x - componentInk.x) / componentInk.w;
    const v = (y - componentInk.y) / componentInk.h;
    return [slotX + u * slotW, slotYbot + v * slotH];
  }
  // Use ALL median points as warp controls so curved strokes follow the slot
  // shape precisely (not just the corners). For the editor's UI controls
  // we still expose only the detected corners (to avoid clutter).
  const allControls = median.map((pt, idx) => {
    const target = mapPt(pt);
    return { idx, dx: target[0] - pt[0], dy: target[1] - pt[1] };
  });
  return { d: strokeD, median, controls: allControls, tx: 0, ty: 0, sx: 1, sy: 1 };
}

// Map our internal layout name to its IDS operator (Ideographic Description
// Sequence character). Used to look up real characters with matching
// decompositions.
const LAYOUT_TO_IDS = {
  horizontal: "⿰",
  vertical: "⿱",
  three_h: "⿲",
  three_v: "⿳",
  enclosure_full: "⿴",
  enclosure_top: "⿵",
  enclosure_bottom: "⿶",
};

async function doCompose() {
  const layout = document.getElementById("layoutSel").value;
  const inputs = Array.from(document.querySelectorAll(".comp")).filter((i) => !i.disabled);
  const chars = inputs.map((i) => i.value.trim()).filter(Boolean);
  if (chars.length < 2) { alert("Need at least 2 components"); return; }

  // First: check if this exact decomposition matches a real character.
  // If yes, load that character directly — its strokes are calligraphically
  // tuned for the composition, no warping artifacts.
  const op = LAYOUT_TO_IDS[layout];
  if (op) {
    const ids = op + chars.join("");
    try {
      const matches = await dataAPI.lookupIDS(ids);
      if (matches.length > 0) {
        await showRealCharInComposer(matches);
        return;
      }
    } catch (e) {
      console.warn("IDS lookup failed:", e);
    }
  }

  // Fallback: geometric composition.
  try {
    const compData = await Promise.all(chars.map(fetchChar));
    const slots = LAYOUTS[layout];
    const placed = [];
    compData.forEach((data, i) => {
      if (!slots[i]) return;
      const ink = unionBBox(data.strokes.map((d) => pathBBox(d)));
      data.strokes.forEach((d, j) => {
        const median = (data.medians && data.medians[j]) || null;
        const ps = composeStroke(d, median, ink, slots[i]);
        ps.label = `${chars[i]} #${j + 1}`;
        placed.push(ps);
      });
    });
    const layer = document.getElementById("composedLayer");
    layer.innerHTML = "";
    placed.forEach((s) => {
      let d = s.d;
      if (s.controls && s.controls.length > 0) {
        d = applyControlWarp(d, s.median, s.controls);
      }
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "#1a1a1a");
      layer.appendChild(p);
    });
    state._lastComposed = placed;
    showComposeStatus(null);  // clear any prior status badge
  } catch (e) { alert(e.message); }
}

// When IDS lookup hits, render the real character's strokes into the
// composer preview AND stash strokeFromData-style data so "Load into editor"
// loads the canonical version. If multiple characters share the
// decomposition, show all of them as quick-pick options.
async function showRealCharInComposer(matches) {
  // Render the first match into the preview.
  const primary = matches[0];
  const data = await fetchChar(primary.character);
  // Build "placed" using strokeFromData so the load-into-editor path treats
  // them as a regular loaded character (no warp deltas).
  const placed = data.strokes.map((d, i) => ({
    ...strokeFromData(data, primary.character, i),
    // The compose-render path renders s.d directly (no transform), so we
    // need d to already be in its final coords. strokeFromData returns
    // tx/ty/sx/sy all defaults (0,0,1,1), so this works.
  }));
  const layer = document.getElementById("composedLayer");
  layer.innerHTML = "";
  placed.forEach((s) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", s.d);
    p.setAttribute("fill", "#1a1a1a");
    layer.appendChild(p);
  });
  state._lastComposed = placed;
  showComposeStatus(matches);
}

// Show a small badge above the composed preview indicating which real
// character was matched (and offer alternatives if multiple share the IDS).
function showComposeStatus(matches) {
  let badge = document.getElementById("composeStatus");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "composeStatus";
    badge.className = "compose-status";
    const composer = document.querySelector(".composer");
    composer.parentNode.insertBefore(badge, composer.nextSibling);
  }
  if (!matches || matches.length === 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "block";
  const primary = matches[0];
  const pinyin = (primary.pinyin || []).join(", ");
  let html = `<strong>✓ Real character found:</strong> ` +
    `<span class="real-ch">${primary.character}</span> ` +
    (pinyin ? `<span class="real-py">${pinyin}</span> ` : "") +
    (primary.definition ? `<span class="real-def">— ${primary.definition}</span>` : "");
  if (matches.length > 1) {
    html += `<div class="alt-matches">Alternates: ` +
      matches.slice(1).map((m) => {
        const py = (m.pinyin || []).join(", ");
        return `<button class="alt-pick" data-ch="${m.character}" title="${m.definition || ""}">${m.character}${py ? ` (${py})` : ""}</button>`;
      }).join(" ") + `</div>`;
  }
  badge.innerHTML = html;
  badge.querySelectorAll(".alt-pick").forEach((b) => {
    b.addEventListener("click", async (e) => {
      const ch = e.target.dataset.ch;
      const data = await fetchChar(ch);
      const placed = data.strokes.map((d, i) => strokeFromData(data, ch, i));
      const layer = document.getElementById("composedLayer");
      layer.innerHTML = "";
      placed.forEach((s) => {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", s.d);
        p.setAttribute("fill", "#1a1a1a");
        layer.appendChild(p);
      });
      state._lastComposed = placed;
      // Update the primary on display.
      showComposeStatus([{ character: ch, pinyin: data.pinyin, definition: data.definition }]);
    });
  });
}

document.getElementById("composeBtn").addEventListener("click", doCompose);

document.getElementById("loadComposedBtn").addEventListener("click", () => {
  if (!state._lastComposed) { alert("Nothing composed yet"); return; }
  pushHistory();
  state.strokes = state._lastComposed.map((s) => {
    const bakedD = applyControlWarp(s.d, s.median, s.controls);
    let bakedMedian = null;
    if (s.median) {
      // Warp the median sample points the same way so the editor's handles
      // sit on the visible stroke.
      const arc = medianArcLengths(s.median);
      const totalLen = arc[arc.length - 1] || 1;
      // Apply same control-based piecewise interpolation directly.
      const cps = s.controls
        .slice()
        .sort((a, b) => a.idx - b.idx)
        .map((c) => ({ t: arc[c.idx] / totalLen, dx: c.dx, dy: c.dy, idx: c.idx }));
      bakedMedian = s.median.map((pt, i) => {
        const t = arc[i] / totalLen;
        let k = 0;
        while (k < cps.length - 1 && cps[k + 1].t < t) k++;
        const a = cps[k], b = cps[Math.min(k + 1, cps.length - 1)];
        const span = b.t - a.t || 1e-6;
        const u = Math.max(0, Math.min(1, (t - a.t) / span));
        const w = u * u * (3 - 2 * u);
        const dx = a.dx + (b.dx - a.dx) * w;
        const dy = a.dy + (b.dy - a.dy) * w;
        return [pt[0] + dx, pt[1] + dy];
      });
    }
    // Reset controls: keep the corner indices but zero out deltas (the warp
    // has already been baked into d and median).
    const newControls = bakedMedian ? detectCornerIndices(bakedMedian).map((idx) => ({ idx, dx: 0, dy: 0 })) : [];
    return {
      d: bakedD,
      median: bakedMedian,
      controls: newControls,
      tx: 0, ty: 0, sx: 1, sy: 1,
      label: s.label,
    };
  });
  renderStrokes();
});

// ===== Radicals & Components panel =====
async function loadRadicalsPanel() {
  const grid = document.getElementById("radicalsGrid");
  try {
    const radicals = await dataAPI.listRadicals();
    grid.innerHTML = "";
    radicals.forEach((rd) => {
      const div = document.createElement("div");
      let cls = "rad";
      if (rd.n_chars === 0) cls += " empty";
      if (!rd.kangxi) cls += " extra";
      div.className = cls;
      const numLabel = rd.kangxi ? `#${rd.number}` : "var";
      const title = `${rd.radical}` +
        (rd.kangxi ? ` (Kangxi #${rd.number})` : ` (variant — not in Kangxi 214)`) +
        (rd.pinyin && rd.pinyin.length ? ` · ${rd.pinyin.join(", ")}` : "") +
        (rd.definition ? `\n${rd.definition}` : "") +
        `\n${rd.n_chars} character${rd.n_chars === 1 ? "" : "s"} in dataset`;
      div.title = title;
      div.innerHTML = `${rd.radical}<small>${numLabel}</small>`;
      if (rd.n_chars > 0) {
        div.addEventListener("click", () => showRadicalVariants(rd.radical));
      }
      grid.appendChild(div);
    });
  } catch (e) {
    grid.innerHTML = `<p style="color:#b00;font-size:12px">Failed to load: ${e.message}</p>`;
  }
}

// ===== Panel-internal search =====
// When the search box has a query: replace the radical grid with variant
// tiles (each clickable → loads in the preview canvas). Empty query:
// restore the radical grid.
let _radSearchDebounce = null;
let _inSearchMode = false;

async function runRadSearch(q) {
  const grid = document.getElementById("radicalsGrid");
  if (!q) {
    if (_inSearchMode) {
      _inSearchMode = false;
      grid.className = "radicals-grid";
      loadRadicalsPanel();
    }
    return;
  }
  _inSearchMode = true;
  grid.className = "radicals-grid";

  // Stroke-count queries:
  //   "5", "5s", "5 strokes" → exactly 5 strokes
  //   "5-8", "5..8", "5 to 8" → range
  const strokeRange = q.match(/^\s*(\d+)\s*(?:[-–.]+|to)\s*(\d+)\s*(?:s|strokes?)?\s*$/i);
  const strokeExact = q.match(/^\s*(\d+)\s*(?:s|strokes?)?\s*$/i);
  let hits = [];
  if (strokeRange) {
    const a = +strokeRange[1], b = +strokeRange[2];
    try { hits = await dataAPI.searchByStrokeCount(a, b); } catch {}
    renderSearchHits(grid, hits, q);
    return;
  }
  if (strokeExact) {
    const n = +strokeExact[1];
    try { hits = await dataAPI.searchByStrokeCount(n); } catch {}
    renderSearchHits(grid, hits, q);
    return;
  }

  let directHits = [];
  if (q.length === 1 && /[\u3400-\u9FFF\uF900-\uFAFF]/.test(q)) {
    try {
      const d = await dataAPI.getChar(q);
      directHits.push({
        character: q,
        pinyin: d.pinyin || [],
        definition: d.definition || "",
        n_strokes: (d.strokes || []).length,
      });
    } catch {}
  }
  let pinyinHits = [];
  try { pinyinHits = await dataAPI.searchPinyin(q); } catch {}
  hits = [...directHits, ...pinyinHits.filter((h) => !directHits.some((d) => d.character === h.character))];
  if (hits.length === 0) {
    try { hits = await dataAPI.searchDefinition(q); } catch {}
  }
  renderSearchHits(grid, hits, q);
}

function renderSearchHits(grid, hits, q) {
  grid.innerHTML = "";
  if (hits.length === 0) {
    grid.innerHTML = `<p style="color:#888;font-size:12px;grid-column:1/-1;padding:8px">No matches for "${q}". Try: <em>lin</em>, <em>森</em>, <em>forest</em>, <em>5</em>, or <em>5-8</em></p>`;
    return;
  }
  hits.slice(0, 120).forEach((h) => {
    const div = document.createElement("div");
    div.className = "rad search-hit";
    const py = (h.pinyin && h.pinyin.length) ? h.pinyin[0] : "";
    const meta = h.n_strokes != null ? `${h.n_strokes}str` : (py || "?");
    div.title = `${h.character}` +
      (py ? ` (${py})` : "") +
      (h.definition ? `\n${h.definition}` : "") +
      (h.n_strokes != null ? `\n${h.n_strokes} strokes` : "") +
      `\nClick to preview · select strokes · add to canvas`;
    div.innerHTML = `${h.character}<small>${meta}</small>`;
    div.addEventListener("click", () => {
      // Came here via search (not via a radical) → just show the preview
      // canvas; no "characters using X" variants list to display.
      document.getElementById("radicalVariants").style.display = "none";
      loadVariantPreview(h.character);
    });
    grid.appendChild(div);
  });
}

document.getElementById("radSearchInput").addEventListener("input", (e) => {
  clearTimeout(_radSearchDebounce);
  const q = e.target.value.trim();
  _radSearchDebounce = setTimeout(() => runRadSearch(q), 150);
});
document.getElementById("radSearchClear").addEventListener("click", () => {
  const input = document.getElementById("radSearchInput");
  input.value = "";
  runRadSearch("");
  input.focus();
});

// State for the variants canvas (which strokes are selected from the current
// preview character).
const rvState = {
  currentChar: null,
  data: null,  // {strokes, medians, stroke_types, pinyin, definition}
  selected: new Set(),  // indices of selected strokes
  marquee: null,
};

async function showRadicalVariants(rad) {
  const panel = document.getElementById("radicalVariants");
  const title = document.getElementById("rvTitle");
  const variantsBox = document.getElementById("rvVariants");
  const canvasArea = document.getElementById("rvCanvasArea");
  panel.style.display = "block";
  title.textContent = `Characters using ${rad}`;
  variantsBox.innerHTML = "Loading…";
  canvasArea.style.display = "none";
  rvState.currentChar = null;
  rvState.data = null;
  rvState.selected = new Set();
  try {
    const data = await dataAPI.radicalChars(rad, 120);
    variantsBox.innerHTML = "";
    data.characters.forEach((c) => {
      const div = document.createElement("div");
      div.className = "variant";
      const pinyin = c.pinyin && c.pinyin.length ? c.pinyin[0] : "";
      div.title = `${c.character}` +
        (pinyin ? ` (${pinyin})` : "") +
        (c.definition ? `\n${c.definition}` : "") +
        `\n${c.n_strokes} strokes`;
      div.dataset.char = c.character;
      div.innerHTML = `<div class="ch">${c.character}</div><div class="meta">${c.n_strokes}str</div>`;
      div.addEventListener("click", () => loadVariantPreview(c.character));
      variantsBox.appendChild(div);
    });
  } catch (e) {
    variantsBox.innerHTML = `<p style="color:#b00">${e.message}</p>`;
  }
}

async function loadVariantPreview(ch) {
  // Mark selected variant card.
  document.querySelectorAll("#rvVariants .variant").forEach((v) => {
    v.classList.toggle("active", v.dataset.char === ch);
  });
  const canvasArea = document.getElementById("rvCanvasArea");
  canvasArea.style.display = "block";
  const titleEl = document.getElementById("rvCanvasTitle");
  titleEl.textContent = `Loading ${ch}…`;
  try {
    const data = await fetchChar(ch);
    rvState.currentChar = ch;
    rvState.data = data;
    // Select all strokes by default — most common workflow is "I want this character".
    rvState.selected = new Set(data.strokes.map((_, i) => i));
    const pinyin = (data.pinyin || []).join(", ");
    titleEl.innerHTML = `<strong>${ch}</strong>` +
      (pinyin ? ` <span style="color:#4f46e5">${pinyin}</span>` : "") +
      (data.definition ? ` <span style="color:#6b7280;font-weight:normal">— ${data.definition}</span>` : "");
    renderRvCanvas();
  } catch (e) {
    titleEl.textContent = `Failed: ${e.message}`;
  }
}

function renderRvCanvas() {
  const layer = document.getElementById("rvCanvasLayer");
  layer.innerHTML = "";
  if (!rvState.data) return;
  rvState.data.strokes.forEach((d, i) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    if (rvState.selected.has(i)) p.classList.add("selected");
    p.dataset.idx = i;
    p.addEventListener("mousedown", (e) => {
      // Plain click toggles single stroke; shift adds; without modifier, replace selection only if clicking unselected
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (rvState.selected.has(i)) rvState.selected.delete(i);
        else rvState.selected.add(i);
      } else {
        rvState.selected = new Set([i]);
      }
      renderRvCanvas();
      updateRvSelectionCount();
      e.preventDefault();
      e.stopPropagation();
    });
    layer.appendChild(p);
  });
  // Marquee
  if (rvState.marquee) {
    const m = rvState.marquee;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", x); r.setAttribute("y", y);
    r.setAttribute("width", w); r.setAttribute("height", h);
    r.setAttribute("class", "rv-marquee");
    layer.appendChild(r);
  }
  updateRvSelectionCount();
}

function updateRvSelectionCount() {
  const el = document.getElementById("rvSelectionCount");
  if (!rvState.data) { el.textContent = "0 selected"; return; }
  el.textContent = `${rvState.selected.size}/${rvState.data.strokes.length} selected`;
}

// Marquee on rv canvas.
function rvSvgPoint(evt) {
  const layer = document.getElementById("rvCanvasLayer");
  const svg = document.getElementById("rvCanvas");
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  return pt.matrixTransform(layer.getScreenCTM().inverse());
}

document.getElementById("rvCanvas").addEventListener("mousedown", (e) => {
  if (e.target.tagName === "path") return;  // path handler owns it
  if (!rvState.data) return;
  const p = rvSvgPoint(e);
  rvState.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, dragging: true };
  if (!(e.shiftKey || e.metaKey || e.ctrlKey)) rvState.selected = new Set();
  renderRvCanvas();
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!rvState.marquee || !rvState.marquee.dragging) return;
  const p = rvSvgPoint(e);
  rvState.marquee.x1 = p.x;
  rvState.marquee.y1 = p.y;
  renderRvCanvas();
});

document.addEventListener("mouseup", () => {
  if (!rvState.marquee || !rvState.marquee.dragging) return;
  const m = rvState.marquee;
  const minX = Math.min(m.x0, m.x1), maxX = Math.max(m.x0, m.x1);
  const minY = Math.min(m.y0, m.y1), maxY = Math.max(m.y0, m.y1);
  // Bbox intersection test for each stroke.
  rvState.data.strokes.forEach((d, i) => {
    const bb = pathBBox(d);
    if (bb.x + bb.w >= minX && bb.x <= maxX && bb.y + bb.h >= minY && bb.y <= maxY) {
      rvState.selected.add(i);
    }
  });
  rvState.marquee = null;
  renderRvCanvas();
});

document.getElementById("rvSelectAll").addEventListener("click", () => {
  if (!rvState.data) return;
  rvState.selected = new Set(rvState.data.strokes.map((_, i) => i));
  renderRvCanvas();
});
document.getElementById("rvSelectNone").addEventListener("click", () => {
  rvState.selected = new Set();
  renderRvCanvas();
});
document.getElementById("rvToComposer").addEventListener("click", () => {
  if (!rvState.currentChar) {
    alert("Pick a character first");
    return;
  }
  sendCharToComposer(rvState.currentChar);
});

document.getElementById("rvAddSelected").addEventListener("click", () => {
  if (!rvState.data || rvState.selected.size === 0) {
    alert("Select at least one stroke first");
    return;
  }
  pushHistory();
  const ch = rvState.currentChar;
  // Add selected strokes to main canvas, preserving order.
  const indices = [...rvState.selected].sort((a, b) => a - b);
  indices.forEach((i) => {
    state.strokes.push(strokeFromData(rvState.data, ch, i));
  });
  renderStrokes();
});

document.getElementById("rvClose").addEventListener("click", () => {
  document.getElementById("radicalVariants").style.display = "none";
});

// init
(async () => {
  loadRadicalsPanel();  // fire and forget
  const loaded = await loadStateFromURL();
  if (!loaded) {
    try {
      const d = await dataAPI.randomChar();
      await loadChar(d && d.character ? d.character : "林");
    } catch {
      await loadChar("林");
    }
  }
})();
