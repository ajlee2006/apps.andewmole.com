// ============================================================================
// Core Daniels-Gilbert VDOT model
// ============================================================================
function vo2(v) { return -4.60 + 0.182258*v + 0.000104*v*v; }
function pctMax(t) { return 0.8 + 0.1894393*Math.exp(-0.012778*t) + 0.2989558*Math.exp(-0.1932605*t); }
function vdotOf(d_m, t_min) { return vo2(d_m/t_min) / pctMax(t_min); }
function timeFor(d_m, targetVdot) {
  let lo = 0.05, hi = 600;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdotOf(d_m, mid) > targetVdot) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function solveOutdoorV(target) {
  const a = 0.000104, b = 0.182258, c = -4.60 - target;
  return (-b + Math.sqrt(b*b - 4*a*c)) / (2*a);
}
 
// ============================================================================
// Conditions adjustments
// ============================================================================
const REF_TEMP_C = 15.5556;  // 60 °F neutral reference
function altitudeFactor(altM) { return 1 - 8.8006e-6 * altM; }
function tempFactor(tempC) {
  const dF = (tempC - REF_TEMP_C) * 9/5;
  return 1 - 1.4257e-3 * dF - 1.0241e-5 * dF * Math.abs(dF);
}
function windVo2Pct(wMph) { return 0.02 * wMph * wMph + 0.88 * wMph; }
function hillTimeDelta(H_m, F_m, v_m_per_min) {
  return (0.926 * H_m - 0.489 * F_m) / vo2(v_m_per_min) * 60;
}
 
// ============================================================================
// Parsers / formatters
// ============================================================================
function parseTime(s) {
  if (s === null || s === undefined) return NaN;
  s = String(s).trim();
  if (s === "") return NaN;
  if (!/^\d{1,3}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) return NaN;
  const parts = s.split(":").map(p => parseFloat(p));
  if (parts.some(isNaN)) return NaN;
  if (parts.length === 2) {
    if (parts[1] >= 60) return NaN;
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    if (parts[1] >= 60 || parts[2] >= 60) return NaN;
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return NaN;
}
function fmtTime(secs, withTenths = false) {
  if (!isFinite(secs) || secs < 0) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs - h * 3600 - m * 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2,"0")}:${withTenths ? s.toFixed(1).padStart(4,"0") : String(Math.round(s)).padStart(2,"0")}`;
  }
  if (withTenths) return `${m}:${s.toFixed(1).padStart(4,"0")}`;
  return `${m}:${String(Math.round(s)).padStart(2,"0")}`;
}
function fmtPace(secsPerUnit) {
  if (!isFinite(secsPerUnit) || secsPerUnit < 0) return "—";
  const m = Math.floor(secsPerUnit / 60);
  const s = secsPerUnit - m * 60;
  return `${m}:${s.toFixed(1).padStart(4,"0")}`;
}
function fmtDelta(secs) {
  if (!isFinite(secs)) return "—";
  if (Math.abs(secs) < 0.5) return `<span class="delta-zero">±0s</span>`;
  const sign = secs > 0 ? "+" : "−";
  const abs = Math.abs(secs);
  const cls = secs > 0 ? "delta-pos" : "delta-neg";
  return `<span class="${cls}">${sign}${fmtTime(abs, abs < 60)}</span>`;
}
 
// ============================================================================
// Unit conversions
// ============================================================================
const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;
function distToM(val, unit) { return unit === "mi" ? val * KM_PER_MI * 1000 : val * 1000; }
function elevToM(val, unit) { return unit === "ft" ? val * M_PER_FT : val; }
function tempToC(val, unit) { return unit === "F" ? (val - 32) * 5/9 : val; }
function windToMph(val, unit) {
  if (unit === "kph") return val / KM_PER_MI;
  if (unit === "mps") return val * 2.23694;
  if (unit === "fps") return val * 0.681818;
  return val;
}
 
function convertValue(val, fromUnit, toUnit, family) {
  if (fromUnit === toUnit) return val;
  if (!isFinite(val)) return val;
  if (family === "distance") {
    if (fromUnit === "km" && toUnit === "mi") return val / KM_PER_MI;
    if (fromUnit === "mi" && toUnit === "km") return val * KM_PER_MI;
  } else if (family === "elevation") {
    if (fromUnit === "m" && toUnit === "ft") return val / M_PER_FT;
    if (fromUnit === "ft" && toUnit === "m") return val * M_PER_FT;
  } else if (family === "temperature") {
    if (fromUnit === "C" && toUnit === "F") return val * 9/5 + 32;
    if (fromUnit === "F" && toUnit === "C") return (val - 32) * 5/9;
  } else if (family === "wind") {
    let mps = val;
    if (fromUnit === "mph") mps = val / 2.23694;
    else if (fromUnit === "kph") mps = val / 3.6;
    else if (fromUnit === "fps") mps = val * 0.3048;
    if (toUnit === "mps") return mps;
    if (toUnit === "mph") return mps * 2.23694;
    if (toUnit === "kph") return mps * 3.6;
    if (toUnit === "fps") return mps / 0.3048;
  }
  return val;
}
function niceRound(v, family) {
  if (!isFinite(v)) return v;
  if (family === "distance") return Math.round(v * 1000) / 1000;
  if (family === "elevation") return Math.round(v);
  if (family === "temperature") return Math.round(v * 10) / 10;
  if (family === "wind") return Math.round(v * 10) / 10;
  return v;
}
 
// ============================================================================
// Combined model — actual race -> neutral VDOT -> hypothetical time
// ============================================================================
// Given an actual race performance with full conditions, return the runner's
// "neutral VDOT" (what they'd show at sea level, 15.5°C neutral, no wind, flat).
function inferNeutralVdot(actual) {
  const { distM, timeSec, altM, tempC, windMph, upM, dnM } = actual;
  const tMin = timeSec / 60;
  const vActual = distM / tMin;
 
  // 1) Strip hill penalty (in seconds) using actual velocity
  const hillSec = hillTimeDelta(upM, dnM, vActual);
  const tNoHill = timeSec - hillSec;
  if (tNoHill <= 0) return NaN;
 
  // 2) Strip wind. At pace v_noHill, VO2 demand was vo2(v_noHill)*(1+p).
  //    In still air, same supply, demand = vo2(v_still) only. So:
  //    vo2(v_still) = vo2(v_noHill) * (1 + p)
  const vNoHill = distM / (tNoHill / 60);
  const p = windVo2Pct(windMph) / 100;
  const vo2Still = vo2(vNoHill) * (1 + p);
  const vStill = solveOutdoorV(vo2Still);
  const tStill = distM / vStill * 60;
 
  // 3) Compute observed VDOT for the still-air, flat equivalent time
  const vdotObserved = vdotOf(distM, tStill / 60);
 
  // 4) Adjust to neutral by removing altitude and temperature effects
  const vdotNeutral = vdotObserved / (altitudeFactor(altM) * tempFactor(tempC));
 
  return vdotNeutral;
}
 
// Forward: given neutral VDOT and hypothetical conditions, predict the race time.
function predictHypothetical(neutralVdot, hyp) {
  const { distM, altM, tempC, windMph, upM, dnM } = hyp;
 
  // 1) Effective VDOT under target conditions
  const vdotEff = neutralVdot * altitudeFactor(altM) * tempFactor(tempC);
 
  // 2) Flat, still-air time at this VDOT and distance
  const tFlatStill = timeFor(distM, vdotEff);  // minutes
  const vFlatStill = distM / tFlatStill;       // m/min
 
  // 3) Apply wind. At target wind, demand at speed v is vo2(v)*(1+p).
  //    Supply (vo2 at v) is the still-air vo2(vFlatStill).
  //    So vo2(v_wind) * (1+p) = vo2(vFlatStill)  =>  vo2(v_wind) = vo2(vFlatStill)/(1+p)
  const p = windVo2Pct(windMph) / 100;
  const vo2Target = vo2(vFlatStill) / (1 + p);
  const vWind = solveOutdoorV(vo2Target);
  const tWind = distM / vWind * 60;  // seconds
 
  // 4) Add hill penalty using v_wind
  const hillSec = hillTimeDelta(upM, dnM, vWind);
  const tFinal = tWind + hillSec;
 
  // Also compute the underlying %VO2max for this duration at v_wind
  // (best estimated using the flat-still equivalent, since that's where VDOT eqn applies)
  const pctVO2 = pctMax(tFlatStill);
 
  return { timeSec: tFinal, vMperMin: distM / tFinal * 60, pctVO2, vdotEff };
}
 
// ============================================================================
// State
// ============================================================================
const state = {
  neutralVdot: null,
};
 
// ============================================================================
// Read inputs
// ============================================================================
// Tracks current course mode per side ("outdoor" or "treadmill")
const courseMode = { act: "outdoor", hyp: "outdoor" };
 
function isEnabled(id) {
  const el = document.getElementById(id);
  return el ? el.checked : true;
}
 
function readRaceInputs(prefix) {
  // prefix = "act" or "hyp"
  const distEl = document.getElementById(prefix + "Dist");
  const distVal = parseFloat(distEl.value);
  const distUnit = document.getElementById(prefix + "DistUnit").value;
  const distValid = !isNaN(distVal) && distVal > 0;
  distEl.classList.toggle("invalid", !distValid);
 
  let timeSec = null;
  if (prefix === "act") {
    const timeEl = document.getElementById("actTime");
    timeSec = parseTime(timeEl.value);
    const timeValid = isFinite(timeSec) && timeSec > 0;
    timeEl.classList.toggle("invalid", !timeValid);
    if (!timeValid) return null;
  }
 
  if (!distValid) return null;
 
  const distM = distToM(distVal, distUnit);
 
  // Altitude — if disabled, use 0 (sea level)
  let altM = 0;
  if (isEnabled(prefix + "AltEnable")) {
    const altVal = parseFloat(document.getElementById(prefix + "Alt").value) || 0;
    const altUnit = document.getElementById(prefix + "AltUnit").value;
    altM = elevToM(altVal, altUnit);
  }
 
  // Temperature — if disabled, use neutral reference (15.5°C)
  let tempC = REF_TEMP_C;
  if (isEnabled(prefix + "TempEnable")) {
    const tempVal = parseFloat(document.getElementById(prefix + "Temp").value) || 0;
    const tempUnit = document.getElementById(prefix + "TempUnit").value;
    tempC = tempToC(tempVal, tempUnit);
  }
 
  // Wind — if disabled, use 0 (still air)
  let windMph = 0;
  if (isEnabled(prefix + "WindEnable")) {
    const windVal = parseFloat(document.getElementById(prefix + "Wind").value) || 0;
    const windUnit = document.getElementById(prefix + "WindUnit").value;
    windMph = windToMph(windVal, windUnit);
  }
 
  // Course profile — if disabled, no climbs or descents
  let upM = 0, dnM = 0;
  if (isEnabled(prefix + "CourseEnable")) {
    if (courseMode[prefix] === "treadmill") {
      const gradePct = parseFloat(document.getElementById(prefix + "Grade").value) || 0;
      upM = distM * (gradePct / 100);
      dnM = 0;
    } else {
      const upVal = parseFloat(document.getElementById(prefix + "Up").value) || 0;
      const upUnit = document.getElementById(prefix + "UpUnit").value;
      const dnVal = parseFloat(document.getElementById(prefix + "Dn").value) || 0;
      const dnUnit = document.getElementById(prefix + "DnUnit").value;
      upM = elevToM(upVal, upUnit);
      dnM = elevToM(dnVal, dnUnit);
    }
  }
 
  return {
    distM,
    timeSec,
    altM, tempC, windMph, upM, dnM,
  };
}
 
// ============================================================================
// Stat display
// ============================================================================
const setStat = (id, t) => document.getElementById(id).textContent = t;
const setHTML = (id, h) => document.getElementById(id).innerHTML = h;
 
function displayRaceStats(prefix, distM, timeSec, vdot, pctVO2max) {
  const distKm = distM / 1000;
  const distMi = distKm / KM_PER_MI;
  const secPerKm = timeSec / distKm;
  const secPerMi = timeSec / distMi;
  const secPer400 = timeSec / (distM / 400);
  setStat(prefix + "StatDist", `${distKm.toFixed(3)} km`);
  setStat(prefix + "StatTime", fmtTime(timeSec, timeSec < 3600));
  setStat(prefix + "StatPaceKm", fmtPace(secPerKm));
  setStat(prefix + "StatPaceMi", fmtPace(secPerMi));
  setStat(prefix + "StatKph", (distKm / (timeSec/3600)).toFixed(2));
  setStat(prefix + "StatMph", (distMi / (timeSec/3600)).toFixed(2));
  setStat(prefix + "StatPace400", fmtPace(secPer400));
  setStat(prefix + "StatVdot", isFinite(vdot) ? vdot.toFixed(2) : "—");
  setStat(prefix + "StatPct", isFinite(pctVO2max) ? (pctVO2max * 100).toFixed(1) + "%" : "—");
}
 
function clearStats(prefix) {
  ["StatDist","StatTime","StatPaceKm","StatPaceMi","StatKph","StatMph","StatPace400","StatVdot","StatPct"]
    .forEach(s => setStat(prefix + s, "—"));
}
 
// ============================================================================
// Sensitivity chart
// ============================================================================
const SENS_COLORS = {
  distance:    "#5b4cd6",  // purple
  altitude:    "#1f7a4a",  // green
  temperature: "#c4452a",  // red
  wind:        "#d68b1f",  // amber
};
 
function clearSensitivityChart() {
  document.getElementById("sensChart").innerHTML = "";
  document.getElementById("chartLegend").innerHTML = "";
}
 
// Predict race time given full conditions (used by chart sweep)
function predictTime(neutralVdot, distM, altM, tempC, windMph, upM, dnM) {
  const pred = predictHypothetical(neutralVdot, { distM, altM, tempC, windMph, upM, dnM });
  return pred.timeSec;
}
 
function updateSensitivityChart(neutralVdot, actual, hyp) {
  // Define the four variables we sweep
  const sweeps = [
    {
      key: "distance",
      label: "Distance",
      color: SENS_COLORS.distance,
      min: 1000,
      max: 42195,
      current: actual.distM,
      hyp: hyp ? hyp.distM : null,
      formatVal: (v) => (v/1000).toFixed(1) + " km",
      sweepFn: (v) => predictTime(neutralVdot, v, actual.altM, actual.tempC, actual.windMph, actual.upM, actual.dnM) / (v/1000),  // sec per km
    },
    {
      key: "altitude",
      label: "Altitude",
      color: SENS_COLORS.altitude,
      min: 0,
      max: 3500,
      current: actual.altM,
      hyp: hyp ? hyp.altM : null,
      formatVal: (v) => Math.round(v) + " m",
      sweepFn: (v) => predictTime(neutralVdot, actual.distM, v, actual.tempC, actual.windMph, actual.upM, actual.dnM) / (actual.distM/1000),
    },
    {
      key: "temperature",
      label: "Temperature",
      color: SENS_COLORS.temperature,
      min: -5,
      max: 40,
      current: actual.tempC,
      hyp: hyp ? hyp.tempC : null,
      formatVal: (v) => v.toFixed(1) + " °C",
      sweepFn: (v) => predictTime(neutralVdot, actual.distM, actual.altM, v, actual.windMph, actual.upM, actual.dnM) / (actual.distM/1000),
    },
    {
      key: "wind",
      label: "Headwind",
      color: SENS_COLORS.wind,
      min: -9,
      max: 9,
      current: actual.windMph / 2.23694,
      hyp: hyp ? hyp.windMph / 2.23694 : null,
      formatVal: (v) => v.toFixed(1) + " m/s",
      sweepFn: (v) => predictTime(neutralVdot, actual.distM, actual.altM, actual.tempC, v * 2.23694, actual.upM, actual.dnM) / (actual.distM/1000),
    },
  ];
 
  // Sample each line at high resolution
  const N = 300;
  let yMin = Infinity, yMax = -Infinity;
  for (const s of sweeps) {
    s.points = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = s.min + t * (s.max - s.min);
      const y = s.sweepFn(x);
      s.points.push({ x, y, t });
      if (isFinite(y)) {
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    // Also compute the current and hyp points' y so we can mark them
    s.currentY = s.sweepFn(s.current);
    if (isFinite(s.currentY)) {
      if (s.currentY < yMin) yMin = s.currentY;
      if (s.currentY > yMax) yMax = s.currentY;
    }
    if (s.hyp != null) {
      s.hypY = s.sweepFn(s.hyp);
      if (isFinite(s.hypY)) {
        if (s.hypY < yMin) yMin = s.hypY;
        if (s.hypY > yMax) yMax = s.hypY;
      }
    }
  }
 
  if (!isFinite(yMin) || !isFinite(yMax) || yMin === yMax) {
    clearSensitivityChart();
    return;
  }
 
  // Add 5% padding to y range
  const yRange = yMax - yMin;
  yMin -= yRange * 0.08;
  yMax += yRange * 0.08;
 
  // SVG dimensions — adapt to container width.
  // We choose a height that scales gently with width so the chart doesn't
  // become a thin strip on wide screens or a tall narrow box on phones.
  const svg = document.getElementById("sensChart");
  const containerWidth = Math.max(280, svg.parentElement.getBoundingClientRect().width || 800);
  const W = Math.round(containerWidth);
  // Aspect: ~2.5:1 at wide widths, ~1.4:1 at narrow widths. Linear blend in between.
  const aspectMin = 1.4, aspectMax = 2.5;
  const widthMin = 320, widthMax = 800;
  const blend = Math.min(1, Math.max(0, (W - widthMin) / (widthMax - widthMin)));
  const aspect = aspectMin + blend * (aspectMax - aspectMin);
  const H = Math.round(W / aspect);
  const padL = 56, padR = 16, padT = 16, padB = 16;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
 
  // Y axis: convert seconds/km to a position
  function yPos(secPerKm) {
    return padT + (1 - (secPerKm - yMin) / (yMax - yMin)) * plotH;
  }
  // X axis: t parameter (0..1)
  function xPos(t) {
    return padL + t * plotW;
  }
 
  // Build SVG
  let html = "";
 
  // Y axis grid lines + labels (5 levels)
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const sec = yMin + (i / yTicks) * (yMax - yMin);
    const y = yPos(sec);
    html += `<line class="grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`;
    const min = Math.floor(sec / 60);
    const s = sec - min * 60;
    const lbl = `${min}:${s.toFixed(0).padStart(2,"0")}`;
    html += `<text class="tick-label" x="${padL - 6}" y="${y + 3}" text-anchor="end">${lbl}</text>`;
  }
  // Y axis label
  html += `<text class="axis-label" x="${padL}" y="${padT - 4}" text-anchor="start">Pace (min/km)</text>`;
 
  // X axis baseline
  html += `<line class="axis" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}"/>`;
  html += `<line class="axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}"/>`;
 
  // Pass 1: lines (with invisible hit-area underneath)
  for (const s of sweeps) {
    const pts = s.points.filter(p => isFinite(p.y));
    if (pts.length < 2) continue;
    const path = pts.map((p, i) => (i === 0 ? "M" : "L") + xPos(p.t) + " " + yPos(p.y)).join(" ");
    s._path = path;
    // Hit area (transparent, wide)
    html += `<path class="series-hit" d="${path}" data-key="${s.key}" stroke="transparent" stroke-width="14" fill="none"/>`;
    // Visible line
    html += `<path class="series-line" d="${path}" stroke="${s.color}" pointer-events="none"/>`;
  }
 
  // Pass 2: hypothetical markers (drawn first so actual markers can sit on top)
  for (const s of sweeps) {
    if (s.hyp == null || !isFinite(s.hypY)) continue;
    const tHyp = (s.hyp - s.min) / (s.max - s.min);
    if (tHyp < 0 || tHyp > 1) continue;
    html += `<circle class="series-hyp-dot" cx="${xPos(tHyp)}" cy="${yPos(s.hypY)}" r="5" fill="white" stroke="${s.color}" stroke-width="2.5" pointer-events="none"/>`;
  }
 
  // Pass 3: actual markers — drawn last so they appear on top of hypothetical markers
  for (const s of sweeps) {
    const tCur = (s.current - s.min) / (s.max - s.min);
    if (tCur < 0 || tCur > 1 || !isFinite(s.currentY)) continue;
    html += `<circle class="series-dot" cx="${xPos(tCur)}" cy="${yPos(s.currentY)}" r="5" fill="${s.color}" pointer-events="none"/>`;
  }
 
  // Hover overlay group (horizontal pace indicator + dot), invisible by default
  html += `<g id="sensHover" pointer-events="none" style="display:none">
    <line id="sensHoverLine" class="hover-line" x1="${padL}" x2="${W - padR}"/>
    <circle id="sensHoverDot" r="5" fill="white" stroke-width="2"/>
  </g>`;
 
  // Store sweep data globally so the hover handler can read it
  window._sensSweeps = sweeps;
  window._sensGeom = { padL, padR, padT, padB, plotW, plotH, W, H, yMin, yMax };
 
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  svg.innerHTML = html;
 
  // Legend — explain the two dot styles up top, then list each variable
  const legend = document.getElementById("chartLegend");
  const swatches = sweeps.map(s => `
    <span class="legend-item">
      <span class="legend-swatch" style="background:${s.color}"></span>
      <span class="label-text">${s.label}</span>
      <span class="label-value">${s.formatVal(s.min)} → ${s.formatVal(s.max)}</span>
    </span>
  `).join("");
  const markers = `
    <span class="legend-item legend-markers">
      <span class="legend-marker-pair">
        <span class="legend-marker legend-marker-filled"></span>
        <span class="label-text">Actual</span>
      </span>
      <span class="legend-marker-pair">
        <span class="legend-marker legend-marker-hollow"></span>
        <span class="label-text">Hypothetical</span>
      </span>
    </span>
  `;
  legend.innerHTML = swatches + markers;
}
 
// ============================================================================
// Recompute everything
// ============================================================================
function recompute() {
  const actual = readRaceInputs("act");
  const hyp = readRaceInputs("hyp");
 
  const hypDeltaMeta = document.getElementById("hypDeltaMeta");
 
  if (!actual) {
    clearStats("act");
    clearStats("hyp");
    hypDeltaMeta.textContent = "";
    document.getElementById("trainTable").innerHTML = "";
    clearSensitivityChart();
    return;
  }
 
  const neutralVdot = inferNeutralVdot(actual);
  state.neutralVdot = neutralVdot;
 
  if (!isFinite(neutralVdot)) {
    clearStats("act");
    clearStats("hyp");
    hypDeltaMeta.textContent = "";
    document.getElementById("trainTable").innerHTML = "";
    clearSensitivityChart();
    return;
  }
 
  // Actual race: observed VDOT, %VO2max for actual time
  const observedVdot = vdotOf(actual.distM, actual.timeSec / 60);
  const actPct = pctMax(actual.timeSec / 60);
  displayRaceStats("act", actual.distM, actual.timeSec, observedVdot, actPct);
 
  // Predict hypothetical
  if (!hyp) {
    clearStats("hyp");
    hypDeltaMeta.textContent = "";
  } else {
    const pred = predictHypothetical(neutralVdot, hyp);
    displayRaceStats("hyp", hyp.distM, pred.timeSec, pred.vdotEff, pred.pctVO2);
    const dSec = pred.timeSec - actual.timeSec;
    hypDeltaMeta.innerHTML = "Δ time " + fmtDelta(dSec);
  }
 
  // Training paces — based on the runner's effective VDOT under the ACTUAL race conditions
  // (so paces match what they'd hit at the same altitude/temperature/wind they raced in).
  // Note: training paces don't try to account for hills (they're per-km in steady state).
  const actEffectiveVdot = neutralVdot * altitudeFactor(actual.altM) * tempFactor(actual.tempC);
  updateTrainingTable(actEffectiveVdot, actual.windMph);
 
  // Sensitivity chart
  updateSensitivityChart(neutralVdot, actual, hyp);
}
 
function updateTrainingTable(vdot, windMph = 0) {
  const tbody = document.getElementById("trainTable");
  tbody.innerHTML = "";
  const paces = [
    ["Easy / long (E)",       0.70],
    ["Marathon pace (M)",     0.84],
    ["Threshold / tempo (T)", 0.88],
    ["Interval / VO₂max (I)", 0.98],
    ["Repetition (R)",        1.05],
  ];
  const windPenalty = 1 + windVo2Pct(windMph) / 100;
  for (const [name, pct] of paces) {
    // Effort target = pct * vdot. With wind, demand at velocity v is vo2(v)*(1+p);
    // To produce same effort, vo2(v_wind) = vo2(v_still)/(1+p)
    const targetVO2 = (pct * vdot) / windPenalty;
    const v = solveOutdoorV(targetVO2);
    const secPerKm = 60000 / v;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td class="num">${fmtPace(secPerKm * 0.4)}</td><td class="num">${fmtPace(secPerKm)}</td><td class="num">${fmtPace(secPerKm * KM_PER_MI)}</td>`;
    tbody.appendChild(tr);
  }
}
 
// ============================================================================
// Wiring
// ============================================================================
function linkPair(sliderId, numberId) {
  const s = document.getElementById(sliderId);
  const n = document.getElementById(numberId);
  s.addEventListener("input", () => { n.value = s.value; recompute(); });
  n.addEventListener("input", () => {
    const v = parseFloat(n.value);
    if (isFinite(v)) s.value = v;
    recompute();
  });
}
 
// Race time slider (special: text input format)
const actTimeSlider = document.getElementById("actTimeSlider");
const actTimeInput = document.getElementById("actTime");
actTimeSlider.addEventListener("input", () => {
  actTimeInput.value = fmtTime(parseFloat(actTimeSlider.value), false);
  actTimeInput.classList.remove("invalid");
  recompute();
});
actTimeInput.addEventListener("input", () => {
  const v = parseTime(actTimeInput.value);
  if (isFinite(v) && v > 0) actTimeSlider.value = Math.min(Math.max(v, parseFloat(actTimeSlider.min)), parseFloat(actTimeSlider.max));
  recompute();
});
 
// All other slider/number pairs
[
  "actDist","actAlt","actTemp","actWind","actUp","actDn","actGrade",
  "hypDist","hypAlt","hypTemp","hypWind","hypUp","hypDn","hypGrade",
].forEach(id => linkPair(id + "Slider", id));
 
// Unit change handlers — preserve quantity by converting value
function makeUnitHandler({ unitId, inputId, sliderId, family, onUnit }) {
  const unitEl = document.getElementById(unitId);
  unitEl.dataset.prev = unitEl.value;
  unitEl.addEventListener("change", () => {
    const prev = unitEl.dataset.prev;
    const next = unitEl.value;
    const inp = document.getElementById(inputId);
    const sld = sliderId ? document.getElementById(sliderId) : null;
    const oldVal = parseFloat(inp.value);
    const newVal = niceRound(convertValue(oldVal, prev, next, family), family);
    if (isFinite(newVal)) inp.value = newVal;
    if (onUnit) onUnit(next, sld);
    if (sld && isFinite(newVal)) {
      const clamped = Math.min(Math.max(newVal, parseFloat(sld.min)), parseFloat(sld.max));
      sld.value = clamped;
      inp.value = clamped;
    }
    unitEl.dataset.prev = next;
    recompute();
  });
}
 
function distSliderUpdate(unit, slider) {
  if (!slider) return;
  slider.max = unit === "mi" ? 31 : 50;
}
function altSliderUpdate(unit, slider) {
  if (!slider) return;
  slider.max = unit === "ft" ? 11500 : 3500;
  slider.step = unit === "ft" ? 50 : 10;
}
function tempSliderUpdate(unit, slider) {
  if (!slider) return;
  if (unit === "F") { slider.min = 15; slider.max = 105; }
  else { slider.min = -10; slider.max = 40; }
  slider.step = 0.1;
}
function hillSliderUpdate(unit, slider) {
  if (!slider) return;
  slider.max = unit === "ft" ? 6500 : 2000;
  slider.step = unit === "ft" ? 20 : 5;
}
function windSliderUpdate(unit, slider) {
  if (!slider) return;
  const max = unit === "mph" ? 20 : unit === "kph" ? 32 : unit === "fps" ? 30 : 9;
  slider.min = -max; slider.max = max;
}
 
// Apply to actual and hypothetical
["act","hyp"].forEach(prefix => {
  makeUnitHandler({ unitId: prefix+"DistUnit",  inputId: prefix+"Dist",  sliderId: prefix+"DistSlider",  family: "distance",    onUnit: distSliderUpdate });
  makeUnitHandler({ unitId: prefix+"AltUnit",   inputId: prefix+"Alt",   sliderId: prefix+"AltSlider",   family: "elevation",   onUnit: altSliderUpdate });
  makeUnitHandler({ unitId: prefix+"TempUnit",  inputId: prefix+"Temp",  sliderId: prefix+"TempSlider",  family: "temperature", onUnit: tempSliderUpdate });
  makeUnitHandler({ unitId: prefix+"WindUnit",  inputId: prefix+"Wind",  sliderId: prefix+"WindSlider",  family: "wind",        onUnit: windSliderUpdate });
  makeUnitHandler({ unitId: prefix+"UpUnit",    inputId: prefix+"Up",    sliderId: prefix+"UpSlider",    family: "elevation",   onUnit: hillSliderUpdate });
  makeUnitHandler({ unitId: prefix+"DnUnit",    inputId: prefix+"Dn",    sliderId: prefix+"DnSlider",    family: "elevation",   onUnit: hillSliderUpdate });
});
 
// Master Metric/Imperial toggle
const UNIT_PAIRS = {
  km: "mi", mi: "km",
  m: "ft", ft: "m",
  C: "F", F: "C",
  mps: "fps", fps: "mps",
  kph: "mph", mph: "kph",
};
const METRIC_UNITS = new Set(["km","m","C","mps","kph"]);
const IMPERIAL_UNITS = new Set(["mi","ft","F","fps","mph"]);
const ALL_UNIT_SELECTS = [];
["act","hyp"].forEach(prefix => {
  ["Dist","Alt","Temp","Wind","Up","Dn"].forEach(k => ALL_UNIT_SELECTS.push(prefix + k + "Unit"));
});
document.querySelectorAll("#unitSystemToggle button").forEach(b => {
  b.addEventListener("click", () => {
    const system = b.dataset.system;
    document.querySelectorAll("#unitSystemToggle button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    const targetSet = system === "metric" ? METRIC_UNITS : IMPERIAL_UNITS;
    ALL_UNIT_SELECTS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const cur = el.value;
      if (targetSet.has(cur)) return;
      const next = UNIT_PAIRS[cur];
      if (!next) return;
      el.value = next;
      el.dispatchEvent(new Event("change"));
    });
  });
});
 
// Presets
function bindPreset(id, distInputId, sliderId, unitId) {
  document.getElementById(id).addEventListener("change", (e) => {
    if (!e.target.value) return;
    const km = parseFloat(e.target.value);
    const unit = document.getElementById(unitId).value;
    const v = niceRound(convertValue(km, "km", unit, "distance"), "distance");
    const sld = document.getElementById(sliderId);
    const clamped = Math.min(Math.max(v, parseFloat(sld.min)), parseFloat(sld.max));
    document.getElementById(distInputId).value = clamped;
    sld.value = clamped;
    recompute();
    e.target.value = "";
  });
}
bindPreset("actDistPreset", "actDist", "actDistSlider", "actDistUnit");
bindPreset("hypDistPreset", "hypDist", "hypDistSlider", "hypDistUnit");
 
// Course type toggle (outdoor / treadmill grade)
function setCourseMode(prefix, mode) {
  courseMode[prefix] = mode;
  // Activate the right button
  document.querySelectorAll(`[data-course-toggle="${prefix}"] button`).forEach(b => {
    b.classList.toggle("active", b.dataset.course === mode);
  });
  // Show/hide the right rows
  document.querySelector(`[data-course-rows="${prefix}-outdoor"]`).style.display = mode === "outdoor" ? "" : "none";
  document.querySelector(`[data-course-rows="${prefix}-treadmill"]`).style.display = mode === "treadmill" ? "" : "none";
}
document.querySelectorAll("[data-course-toggle] button").forEach(b => {
  b.addEventListener("click", () => {
    const prefix = b.parentElement.dataset.courseToggle;
    setCourseMode(prefix, b.dataset.course);
    recompute();
  });
});
 
// Enable checkboxes for conditions/course profile.
// Actual & hypothetical share state — toggling one toggles the other.
const ENABLE_PAIRS = [
  // [key, actFields, hypFields, optional act extra, optional hyp extra]
  ["Alt",    ["actAltField"],    ["hypAltField"]],
  ["Temp",   ["actTempField"],   ["hypTempField"]],
  ["Wind",   ["actWindField"],   ["hypWindField"]],
  ["Course", ["actCourseField"], ["hypCourseField"],
   ['[data-course-rows="act-outdoor"]','[data-course-rows="act-treadmill"]'],
   ['[data-course-rows="hyp-outdoor"]','[data-course-rows="hyp-treadmill"]']],
];
 
function applyEnableState(checked, fieldIds, extraSelectors) {
  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("disabled", !checked);
  });
  if (extraSelectors) {
    extraSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.querySelectorAll(".field").forEach(f => f.classList.toggle("disabled", !checked));
      });
    });
  }
}
 
ENABLE_PAIRS.forEach(([key, actFields, hypFields, actExtra, hypExtra]) => {
  const actCb = document.getElementById("act" + key + "Enable");
  const hypCb = document.getElementById("hyp" + key + "Enable");
  if (!actCb || !hypCb) return;
  // Initial visual state
  applyEnableState(actCb.checked, actFields, actExtra);
  applyEnableState(hypCb.checked, hypFields, hypExtra);
  // Link: toggling either updates both and re-applies styling
  function sync(source) {
    const v = source.checked;
    if (actCb.checked !== v) actCb.checked = v;
    if (hypCb.checked !== v) hypCb.checked = v;
    applyEnableState(v, actFields, actExtra);
    applyEnableState(v, hypFields, hypExtra);
    recompute();
  }
  actCb.addEventListener("change", () => sync(actCb));
  hypCb.addEventListener("change", () => sync(hypCb));
});
 
// "Copy from actual" — copy all condition + distance variables (excluding time) plus course mode
document.getElementById("copyFromActual").addEventListener("click", () => {
  const FIELDS = [
    ["Dist", "DistUnit", "DistSlider"],
    ["Alt", "AltUnit", "AltSlider"],
    ["Temp", "TempUnit", "TempSlider"],
    ["Wind", "WindUnit", "WindSlider"],
    ["Up", "UpUnit", "UpSlider"],
    ["Dn", "DnUnit", "DnSlider"],
  ];
  FIELDS.forEach(([input, unit, slider]) => {
    const actVal = document.getElementById("act" + input).value;
    const actUnit = document.getElementById("act" + unit).value;
    // Set hyp unit first (without triggering convertValue), then value
    const hypUnitEl = document.getElementById("hyp" + unit);
    if (hypUnitEl.value !== actUnit) {
      hypUnitEl.dataset.prev = actUnit;
      hypUnitEl.value = actUnit;
      const slEl = document.getElementById("hyp" + slider);
      const family = (
        input === "Dist" ? "distance" :
        input === "Temp" ? "temperature" :
        input === "Wind" ? "wind" : "elevation"
      );
      const onUnitFn = (
        family === "distance" ? distSliderUpdate :
        family === "temperature" ? tempSliderUpdate :
        family === "wind" ? windSliderUpdate :
        (input === "Alt" ? altSliderUpdate : hillSliderUpdate)
      );
      onUnitFn(actUnit, slEl);
    }
    document.getElementById("hyp" + input).value = actVal;
    document.getElementById("hyp" + slider).value = actVal;
  });
  // Also copy course mode + treadmill grade
  setCourseMode("hyp", courseMode.act);
  if (courseMode.act === "treadmill") {
    const g = document.getElementById("actGrade").value;
    document.getElementById("hypGrade").value = g;
    document.getElementById("hypGradeSlider").value = g;
  }
  recompute();
});
 
// Position tooltips via event delegation. Clamp to viewport so they never overflow.
const _ttCanvas = document.createElement("canvas").getContext("2d");
_ttCanvas.font = "400 12px " + getComputedStyle(document.body).fontFamily;
function _ttMeasure(text) {
  // Measure each line broken at words (max width = min(260, viewport-20))
  const maxW = Math.min(260, window.innerWidth - 20);
  const words = String(text).split(/\s+/);
  let lineW = 0, maxLineW = 0, lines = 1;
  for (const w of words) {
    const wW = _ttCanvas.measureText((lineW === 0 ? "" : " ") + w).width;
    if (lineW + wW > maxW - 24) {  // 24 = horizontal padding
      lines++;
      lineW = _ttCanvas.measureText(w).width;
    } else {
      lineW += wW;
    }
    if (lineW > maxLineW) maxLineW = lineW;
  }
  const width = Math.min(maxW, maxLineW + 24);
  const height = lines * 17 + 16;  // 17 = line-height for 12px/1.4, 16 = vertical padding
  return { width, height };
}
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest(".info");
  if (!el) return;
  const r = el.getBoundingClientRect();
  const tip = el.getAttribute("data-tip") || "";
  const { width, height } = _ttMeasure(tip);
  const margin = 8;
  // Desired horizontal center on the ?
  let left = r.left + r.width / 2 - width / 2;
  // Clamp to viewport
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  // Vertical: prefer above; if not enough room, place below
  let top = r.top - 8;
  if (top - height < margin) top = r.bottom + 8 + height;  // 'top' here means bottom of tooltip
  el.style.setProperty("--tt-x", left + "px");
  el.style.setProperty("--tt-y", top + "px");
});
 
// Sensitivity chart hover — delegated on the SVG so re-renders don't lose the handler
(function() {
  const svg = document.getElementById("sensChart");
  const tip = document.getElementById("sensTip");
  const container = svg.parentElement;
 
  function hide() {
    tip.classList.remove("visible");
    const hov = document.getElementById("sensHover");
    if (hov) hov.style.display = "none";
  }
 
  svg.addEventListener("pointermove", (e) => {
    const hit = e.target.closest(".series-hit");
    if (!hit) { hide(); return; }
    const key = hit.getAttribute("data-key");
    const sweeps = window._sensSweeps;
    const geom = window._sensGeom;
    if (!sweeps || !geom) return;
    const s = sweeps.find(x => x.key === key);
    if (!s) return;
 
    // Convert pointer position to SVG userspace coords
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * geom.W;
    let t = (sx - geom.padL) / geom.plotW;
    t = Math.max(0, Math.min(1, t));
    // Linear-interpolate between adjacent sample points so hover feels continuous
    const fIdx = t * (s.points.length - 1);
    const i0 = Math.floor(fIdx);
    const i1 = Math.min(i0 + 1, s.points.length - 1);
    const frac = fIdx - i0;
    const p0 = s.points[i0];
    const p1 = s.points[i1];
    if (!p0 || !p1 || !isFinite(p0.y) || !isFinite(p1.y)) { hide(); return; }
    const pt = {
      x: p0.x + (p1.x - p0.x) * frac,
      y: p0.y + (p1.y - p0.y) * frac,
      t: p0.t + (p1.t - p0.t) * frac,
    };
 
    // Position the hover line + dot
    const hov = document.getElementById("sensHover");
    const line = document.getElementById("sensHoverLine");
    const dot = document.getElementById("sensHoverDot");
    if (hov && line && dot) {
      const xCoord = geom.padL + pt.t * geom.plotW;
      const yCoord = geom.padT + (1 - (pt.y - geom.yMin) / (geom.yMax - geom.yMin)) * geom.plotH;
      line.setAttribute("y1", yCoord);
      line.setAttribute("y2", yCoord);
      dot.setAttribute("cx", xCoord);
      dot.setAttribute("cy", yCoord);
      dot.setAttribute("stroke", s.color);
      hov.style.display = "";
    }
 
    // Tooltip content + position
    const m = Math.floor(pt.y / 60);
    const ss = pt.y - m * 60;
    const paceStr = `${m}:${ss.toFixed(1).padStart(4,"0")} /km`;
    tip.innerHTML = `<span class="tip-color" style="background:${s.color}"></span><span class="tip-label">${s.label}</span> <span class="tip-value">${s.formatVal(pt.x)} · pace ${paceStr}</span>`;
 
    const cRect = container.getBoundingClientRect();
    const localX = e.clientX - cRect.left;
    const localY = e.clientY - cRect.top;
    tip.style.left = "0px";
    tip.style.top = "0px";
    tip.classList.add("visible");
    const tRect = tip.getBoundingClientRect();
    let left = localX + 12;
    let top = localY - tRect.height - 8;
    if (left + tRect.width > cRect.width - 4) left = localX - tRect.width - 12;
    if (top < 4) top = localY + 16;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  });
  svg.addEventListener("pointerleave", hide);
})();
 
// Re-render chart on container resize so width:height ratio stays sensible
(function() {
  const svg = document.getElementById("sensChart");
  if (!svg || !window.ResizeObserver) return;
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.round(svg.parentElement.getBoundingClientRect().width);
    if (Math.abs(w - lastW) > 4) {  // ignore tiny fluctuations
      lastW = w;
      recompute();
    }
  });
  ro.observe(svg.parentElement);
})();
 
recompute();
