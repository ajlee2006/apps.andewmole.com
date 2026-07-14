'use strict';

// ----- Config -----
const API_BASE = 'https://api.andewmole.com/bustimings';
const POLL_MS = 5000;

// ----- State -----
// Ordered list of bus stop codes the user has added (top of UI = first in array).
const stops = [];
// Per-stop arrivals data, keyed by stop code: { data: <api response> | null, error: string | null }
const stopState = new Map();
let fetchTimer = null;
let tickRAF = null;

// Persistence
const LS_STOPS = 'stops_v2';
function loadStopsFromStorage() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_STOPS) || '[]');
    if (Array.isArray(arr)) return arr.filter(s => /^\d{5}$/.test(s));
  } catch (_) {}
  return [];
}
function saveStopsToStorage() {
  localStorage.setItem(LS_STOPS, JSON.stringify(stops));
}

// ----- Helpers -----
const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');

function formatClock(d) {
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

// Returns {minutes, seconds, totalSec, past}
function etaParts(arrivalDate, now) {
  const diffSec = Math.floor((arrivalDate.getTime() - now.getTime()) / 1000);
  const past = diffSec < 0;
  const abs = Math.abs(diffSec);
  return {
    minutes: Math.floor(abs / 60),
    seconds: abs % 60,
    totalSec: diffSec,
    past
  };
}

function loadClass(load) {
  if (load === 'SEA') return 'sea';
  if (load === 'SDA') return 'sda';
  if (load === 'LSD') return 'lsd';
  return '';
}

function compareServiceNo(a, b) {
  const reA = /\d+/.exec(a.ServiceNo);
  const reB = /\d+/.exec(b.ServiceNo);
  const na = reA ? parseInt(reA[0], 10) : 0;
  const nb = reB ? parseInt(reB[0], 10) : 0;
  if (na !== nb) return na - nb;
  return a.ServiceNo.localeCompare(b.ServiceNo);
}

function setStatus(state, text) {
  const dot = $('status-dot');
  dot.className = 'status-dot ' + state;
  dot.title = text;
}

function escapeHTML(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

// Compare two arrival responses and return a Map of "serviceNo|busKey" → flashEndMs
// (a timestamp in ms after which the flash effect should stop). LTA updated its
// prediction when EstimatedArrival changes between fetches. We only flag changes
// when BOTH old and new have a non-empty EstimatedArrival, so the initial load
// (prev === null) doesn't flash everything.
const FLASH_MS = 900;
function diffArrivalChanges(prevData, nextData) {
  const changed = new Map();
  if (!prevData || !nextData) return changed;
  const flashEnd = Date.now() + FLASH_MS;
  const prevByService = new Map();
  for (const svc of (prevData.Services || [])) prevByService.set(svc.ServiceNo, svc);
  for (const svc of (nextData.Services || [])) {
    const prevSvc = prevByService.get(svc.ServiceNo);
    if (!prevSvc) continue;
    for (const key of ['NextBus', 'NextBus2', 'NextBus3']) {
      const a = (prevSvc[key] || {}).EstimatedArrival || '';
      const b = (svc[key] || {}).EstimatedArrival || '';
      if (a && b && a !== b) changed.set(svc.ServiceNo + '|' + key, flashEnd);
    }
  }
  return changed;
}

// ----- Icon library -----
// Front-view bus icons in the SG bus-app style: filled body with white insets.
// Uses currentColor for the body so they stay neutral and pick up text-2 in the cell.
// SD: 30×30 squarish. DD: 30×36 (taller, with destination panel between the two decks).
// BD: 44×30 — front face on the left, accordion bellows, perspective trailer behind.
function busSVG(type) {
  if (type === 'DD') {
    return `<svg viewBox="0 0 30 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="20" width="2" height="3" rx="0.5" fill="currentColor"/>
      <rect x="26" y="20" width="2" height="3" rx="0.5" fill="currentColor"/>
      <path d="M4 6 Q4 3 8 3 L22 3 Q26 3 26 6 L26 31 Q26 32 25 32 L5 32 Q4 32 4 31 Z" fill="currentColor"/>
      <rect x="6" y="6" width="18" height="8" rx="1" fill="#fff"/>
      <rect x="8" y="15" width="14" height="2.5" rx="0.4" fill="#fff"/>
      <rect x="6" y="18.5" width="18" height="8" rx="1" fill="#fff"/>
      <circle cx="9" cy="29" r="1.4" fill="#fff"/>
      <circle cx="21" cy="29" r="1.4" fill="#fff"/>
      <rect x="5.5" y="32" width="2.5" height="2.5" rx="0.4" fill="currentColor"/>
      <rect x="22" y="32" width="2.5" height="2.5" rx="0.4" fill="currentColor"/>
    </svg>`;
  }
  if (type === 'BD') {
    return `<svg viewBox="0 0 44 30" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="11" width="2" height="3" rx="0.5" fill="currentColor"/>
      <path d="M4 7 Q4 3 8 3 L22 3 Q26 3 26 7 L26 25 Q26 26 25 26 L5 26 Q4 26 4 25 Z" fill="currentColor"/>
      <rect x="8" y="6" width="14" height="2.5" rx="0.4" fill="#fff"/>
      <rect x="6" y="10" width="18" height="8" rx="1" fill="#fff"/>
      <circle cx="9" cy="22" r="1.6" fill="#fff"/>
      <circle cx="21" cy="22" r="1.6" fill="#fff"/>
      <rect x="5.5" y="26" width="2.5" height="2.5" rx="0.4" fill="currentColor"/>
      <rect x="22" y="26" width="2.5" height="2.5" rx="0.4" fill="currentColor"/>
      <path d="M26 8 L29 9 M26 12 L29 12 M26 16 L29 15 M26 20 L29 19 M26 24 L29 23" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <path d="M29 9 L40 11 Q42 11.3 42 13 L42 21 Q42 22.7 40 23 L29 23 Z" fill="currentColor"/>
      <path d="M30 12 L39 13.6 L39 20.4 L30 22 Z" fill="#fff"/>
      <rect x="38" y="23" width="2.5" height="2" rx="0.3" fill="currentColor"/>
    </svg>`;
  }
  // Single decker — default. Square 30×30.
  return `<svg viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="11" width="2" height="3" rx="0.5" fill="currentColor"/>
    <rect x="26" y="11" width="2" height="3" rx="0.5" fill="currentColor"/>
    <path d="M4 7 Q4 3 8 3 L22 3 Q26 3 26 7 L26 25 Q26 26 25 26 L5 26 Q4 26 4 25 Z" fill="currentColor"/>
    <rect x="8" y="6" width="14" height="2.5" rx="0.4" fill="#fff"/>
    <rect x="6" y="10" width="18" height="8" rx="1" fill="#fff"/>
    <circle cx="9" cy="22" r="1.6" fill="#fff"/>
    <circle cx="21" cy="22" r="1.6" fill="#fff"/>
    <rect x="5.5" y="26" width="2.5" height="2.5" rx="0.4" fill="currentColor"/>
    <rect x="22" y="26" width="2.5" height="2.5" rx="0.4" fill="currentColor"/>
  </svg>`;
}

function wabSVG() {
  // Simple wheelchair accessible icon
  return `<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">
    <circle cx="6" cy="2" r="1"/>
    <path d="M6 4 L6 8 L10 8 L11 12"/>
    <circle cx="6.5" cy="10.5" r="2.5"/>
  </svg>`;
}

function clockSVG() {
  return `<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">
    <circle cx="7" cy="7" r="5"/>
    <path d="M7 4 L7 7 L9 9"/>
  </svg>`;
}

function gripSVG() {
  // Six-dot drag handle
  return `<svg viewBox="0 0 14 14" width="14" height="14" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/>
    <circle cx="5" cy="7" r="1.2"/><circle cx="9" cy="7" r="1.2"/>
    <circle cx="5" cy="11" r="1.2"/><circle cx="9" cy="11" r="1.2"/>
  </svg>`;
}

function xSVG() {
  return `<svg viewBox="0 0 14 14" width="14" height="14" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
    <line x1="3.5" y1="3.5" x2="10.5" y2="10.5"/>
    <line x1="10.5" y1="3.5" x2="3.5" y2="10.5"/>
  </svg>`;
}

// ----- Fetching (all stops in parallel) -----
async function fetchAllArrivals() {
  if (stops.length === 0) {
    setStatus('', 'idle');
    return;
  }
  setStatus('fetching', 'fetching');
  const results = await Promise.allSettled(
    stops.map(code => fetch(`${API_BASE}/arrivals/${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
          throw new Error(err.error || ('HTTP ' + r.status));
        }
        return r.json();
      })
      .then(data => ({ code, data })))
  );

  let anyError = false;
  let networkError = false;
  for (let i = 0; i < results.length; i++) {
    const code = stops[i];
    const r = results[i];
    if (r.status === 'fulfilled') {
      const prev = stopState.get(code) || { data: null, error: null };
      // Detect which (service, slot) timings changed since last fetch
      const changed = diffArrivalChanges(prev.data, r.value.data);
      stopState.set(code, { data: r.value.data, error: null, changed });
    } else {
      anyError = true;
      const msg = (r.reason && r.reason.message) || 'fetch failed';
      if (/Failed to fetch|NetworkError/.test(msg)) networkError = true;
      const prev = stopState.get(code) || { data: null, error: null };
      stopState.set(code, { data: prev.data, error: msg, changed: prev.changed });
    }
  }

  setStatus(anyError ? 'error' : 'live', anyError ? (networkError ? 'cannot reach API server' : 'some stops failed') : 'live');
  if (networkError) {
    $('hints').innerHTML = '<span class="err">Cannot reach server at ' + API_BASE + '. Is <code>node server.js</code> running?</span>';
  } else {
    $('hints').textContent = '';
  }
  updateLegend();
}

// Show the BD and Scheduled legend entries only when at least one matching bus is present.
function updateLegend() {
  let hasBD = false;
  let hasScheduled = false;
  for (const code of stops) {
    const data = (stopState.get(code) || {}).data;
    if (!data || !data.Services) continue;
    for (const svc of data.Services) {
      for (const key of ['NextBus', 'NextBus2', 'NextBus3']) {
        const bus = svc[key];
        if (!bus || !bus.EstimatedArrival) continue;
        if (bus.Type === 'BD') hasBD = true;
        if (!bus.Monitored) hasScheduled = true;
      }
    }
  }
  const bdEl = $('legend-bd');
  const schedEl = $('legend-sched');
  if (bdEl) bdEl.style.display = hasBD ? '' : 'none';
  if (schedEl) schedEl.style.display = hasScheduled ? '' : 'none';
  const grid = document.querySelector('.legend-grid');
  if (grid) grid.classList.toggle('scheduled-visible', hasScheduled);
}

function startPolling() {
  stopPolling();
  fetchAllArrivals();
  fetchTimer = setInterval(fetchAllArrivals, POLL_MS);
}
function stopPolling() {
  if (fetchTimer) { clearInterval(fetchTimer); fetchTimer = null; }
}

// Manual per-stop refresh (fired when the user taps an arrival cell).
// Rate-limited so mashing doesn't spam the API.
const REFRESH_DEBOUNCE_MS = 1000;
const lastManualRefresh = new Map();
async function refreshStop(code) {
  const now = Date.now();
  const last = lastManualRefresh.get(code) || 0;
  if (now - last < REFRESH_DEBOUNCE_MS) return;
  lastManualRefresh.set(code, now);

  try {
    const r = await fetch(`${API_BASE}/arrivals/${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();
    const prev = stopState.get(code) || { data: null, error: null };
    const changed = diffArrivalChanges(prev.data, data);
    stopState.set(code, { data, error: null, changed });
  } catch (_) {
    // Silent — the periodic poll will surface persistent issues
  }
}

// ----- Add / remove / reorder stops -----
async function addStop(code) {
  if (stops.includes(code)) {
    // Already present — flash it briefly so the user knows
    const existing = document.querySelector(`.stop-card[data-code="${code}"]`);
    if (existing) {
      existing.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      existing.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }],
        { duration: 320 }
      );
    }
    return;
  }
  // Validate first via /busstop/:code
  try {
    const r = await fetch(`${API_BASE}/busstop/${code}`);
    if (r.status === 404) {
      $('hints').innerHTML = '<span class="err">Bus stop ' + code + ' not found.</span>';
      return;
    }
    if (!r.ok && r.status !== 503) {
      $('hints').innerHTML = '<span class="err">Could not validate stop (HTTP ' + r.status + ').</span>';
      return;
    }
  } catch (_) {
    $('hints').innerHTML = '<span class="err">Cannot reach server at ' + API_BASE + '. Is <code>node server.js</code> running?</span>';
    return;
  }
  // Prepend to top
  stops.unshift(code);
  stopState.set(code, { data: null, error: null });
  saveStopsToStorage();
  $('hints').textContent = '';
  // Render placeholder card so something appears immediately
  renderStops();
  // Then trigger a fresh fetch for everyone
  fetchAllArrivals();
}

function removeStop(code) {
  const i = stops.indexOf(code);
  if (i === -1) return;
  stops.splice(i, 1);
  stopState.delete(code);
  saveStopsToStorage();
  renderStops();
  updateLegend();
  if (stops.length === 0) setStatus('', 'idle');
}

function moveStop(fromCode, toCode, placeBefore) {
  const fromIdx = stops.indexOf(fromCode);
  if (fromIdx === -1) return;
  const [moved] = stops.splice(fromIdx, 1);
  let toIdx = stops.indexOf(toCode);
  if (toIdx === -1) {
    stops.push(moved);
  } else {
    stops.splice(placeBefore ? toIdx : toIdx + 1, 0, moved);
  }
  saveStopsToStorage();
  renderStops();
}

// ----- Clock + ticker -----
function startTicker() {
  if (tickRAF) return;
  function loop() {
    $('clock-time').textContent = formatClock(new Date());
    renderAllArrivals();
    tickRAF = requestAnimationFrame(loop);
  }
  loop();
}

// ----- Rendering -----

// Build (or reuse) a .stop-card element for a given code.
function buildStopCard(code) {
  const card = document.createElement('div');
  card.className = 'stop-card';
  card.dataset.code = code;
  card.draggable = false;

  card.innerHTML = `
    <div class="stop-info">
      <span class="stop-grip" title="Drag to reorder">${gripSVG()}</span>
      <div class="stop-meta">
        <div class="stop-name">—</div>
        <div class="stop-sub">
          <span class="stop-code-pill">${escapeHTML(code)}</span>
          <span class="stop-road">—</span>
        </div>
      </div>
      <div class="stop-actions">
        <button class="stop-close" title="Remove this stop" aria-label="Remove this stop">${xSVG()}</button>
      </div>
    </div>
    <div class="board"></div>
  `;

  // Wire up the X button
  card.querySelector('.stop-close').addEventListener('click', () => removeStop(code));

  // Drag handle: card is only draggable while the user is pressing on the grip.
  // Otherwise draggable=true swallows normal clicks (e.g. tap-to-refresh).
  card.addEventListener('mousedown', (e) => {
    card.draggable = !!e.target.closest('.stop-grip');
  });
  card.addEventListener('mouseup', () => { card.draggable = false; });

  // DnD handlers
  card.addEventListener('dragstart', (e) => {
    if (!e.target.closest('.stop-grip') && e.target !== card) {
      // dragstart can fire from anywhere if draggable=true; check the actual mouse target
      // But we already gated via mousedown; this is just defensive.
    }
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', code);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    card.draggable = false;
    document.querySelectorAll('.stop-card.drag-over-top, .stop-card.drag-over-bottom')
      .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = card.getBoundingClientRect();
    const isTopHalf = (e.clientY - rect.top) < rect.height / 2;
    card.classList.toggle('drag-over-top', isTopHalf);
    card.classList.toggle('drag-over-bottom', !isTopHalf);
  });
  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    const fromCode = e.dataTransfer.getData('text/plain');
    if (fromCode && fromCode !== code) {
      const isTopHalf = card.classList.contains('drag-over-top');
      moveStop(fromCode, code, isTopHalf);
    }
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  return card;
}

// Top-level: ensure a card exists for each stop in `stops`, in the correct order.
function renderStops() {
  const container = $('stops-container');
  const existing = new Map();
  for (const child of Array.from(container.children)) {
    if (child.dataset && child.dataset.code) existing.set(child.dataset.code, child);
  }

  const ordered = [];
  for (const code of stops) {
    let card = existing.get(code);
    if (!card) card = buildStopCard(code);
    else existing.delete(code);
    ordered.push(card);
  }
  // Remove cards no longer in `stops`
  for (const stale of existing.values()) stale.remove();
  // Reorder
  for (let i = 0; i < ordered.length; i++) {
    if (container.children[i] !== ordered[i]) {
      container.insertBefore(ordered[i], container.children[i] || null);
    }
  }
  // Paint header + arrivals from cached state
  renderAllArrivals();
}

// Per-frame renderer — paints headers and arrivals for every stop card from cache
function renderAllArrivals() {
  const now = new Date();
  for (const code of stops) {
    const card = document.querySelector(`.stop-card[data-code="${code}"]`);
    if (!card) continue;
    const state = stopState.get(code) || { data: null, error: null };

    // Header
    const data = state.data;
    if (data) {
      card.querySelector('.stop-name').textContent = data.Description || '—';
      card.querySelector('.stop-road').textContent = data.RoadName || '';
    }

    // Error banner
    let errBanner = card.querySelector('.stop-error');
    if (state.error && !state.data) {
      if (!errBanner) {
        errBanner = document.createElement('div');
        errBanner.className = 'stop-error';
        card.querySelector('.stop-info').after(errBanner);
      }
      errBanner.textContent = state.error;
    } else if (errBanner) {
      errBanner.remove();
    }

    // Arrivals board
    const board = card.querySelector('.board');
    renderBoardForStop(board, data ? data.Services : null, now, state.changed);
  }
}

function renderBoardForStop(board, services, now, changed) {
  if (!services) {
    if (!board.querySelector('.empty-state')) {
      board.innerHTML = '<div class="empty-state">Loading…</div>';
    }
    return;
  }

  const sorted = services.slice().sort(compareServiceNo);

  // Drop the empty-state node if present
  const emptyState = board.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Diff-in-place keyed by service number
  const existing = new Map();
  for (const child of Array.from(board.children)) {
    if (child.dataset && child.dataset.svc) existing.set(child.dataset.svc, child);
  }

  const nextNodes = [];
  const nowMs = Date.now();

  for (const svc of sorted) {
    let row = existing.get(svc.ServiceNo);
    if (!row) {
      row = document.createElement('div');
      row.className = 'service-row';
      row.dataset.svc = svc.ServiceNo;
      row.innerHTML = `
        <div class="service-left">
          <div class="service-num"></div>
        </div>
        <div class="service-body">
          <div class="route"></div>
          <div class="arrivals"></div>
        </div>`;
    }
    row.querySelector('.service-num').textContent = svc.ServiceNo;

    const next = svc.NextBus || {};
    const origin = next.OriginName || '—';
    const dest = next.DestinationName || '—';
    row.querySelector('.route').innerHTML =
      `<span class="op">${escapeHTML(svc.Operator || '')}</span>${escapeHTML(origin)} <span class="arrow">→</span> ${escapeHTML(dest)}`;

    const arrivalsBox = row.querySelector('.arrivals');
    for (let i = 0; i < 3; i++) {
      const key = ['NextBus', 'NextBus2', 'NextBus3'][i];
      const bus = svc[key];
      let cell = arrivalsBox.children[i];
      // Rebuild the cell only when the identity or slot metadata actually changes.
      // Otherwise reuse the existing DOM node — this keeps the click target stable
      // across per-frame ticks so mousedown+mouseup can land on the same node.
      const sig = arrivalSignature(bus);
      if (!cell || cell.dataset.sig !== sig) {
        const newCell = buildArrivalCell(bus, now);
        newCell.dataset.sig = sig;
        if (cell) arrivalsBox.replaceChild(newCell, cell);
        else arrivalsBox.appendChild(newCell);
        cell = newCell;
      } else {
        // Just refresh the ticking time text on the existing cell
        updateArrivalCellTick(cell, bus, now);
      }

      // Apply/update the flash tint (independent of whether the cell is new)
      if (changed) {
        const slotKey = svc.ServiceNo + '|' + key;
        const flashEnd = changed.get(slotKey);
        if (flashEnd) {
          if (nowMs < flashEnd) {
            const t = (flashEnd - nowMs) / FLASH_MS;
            cell.style.backgroundColor = `rgba(240, 168, 48, ${(0.35 * t).toFixed(3)})`;
          } else {
            changed.delete(slotKey);
            cell.style.backgroundColor = '';
          }
        }
      }
    }
    // Drop any extra cells (shouldn't happen since there are always 3 slots)
    while (arrivalsBox.children.length > 3) arrivalsBox.lastChild.remove();

    nextNodes.push(row);
    existing.delete(svc.ServiceNo);
  }

  for (const stale of existing.values()) stale.remove();
  for (let i = 0; i < nextNodes.length; i++) {
    if (board.children[i] !== nextNodes[i]) {
      board.insertBefore(nextNodes[i], board.children[i] || null);
    }
  }

  if (sorted.length === 0 && !board.querySelector('.empty-state')) {
    board.innerHTML = '<div class="empty-state">No services reporting at this stop.</div>';
  }
}

// Signature of everything about a bus that requires rebuilding the DOM.
// The ticking min/sec text is NOT part of this — it's updated separately per frame.
function arrivalSignature(bus) {
  if (!bus || !bus.EstimatedArrival) return 'empty';
  return [
    bus.EstimatedArrival,
    bus.Load || '',
    bus.Type || '',
    bus.Feature || '',
    bus.Monitored ? '1' : '0'
  ].join('|');
}

// Update just the ticking min/sec (and the "gone" class) on an existing cell,
// without touching the surrounding DOM. Called every animation frame.
function updateArrivalCellTick(cell, bus, now) {
  if (!bus || !bus.EstimatedArrival) return;
  const arrival = new Date(bus.EstimatedArrival);
  const { minutes, seconds, past } = etaParts(arrival, now);
  const sign = past ? '-' : '';
  const etaEl = cell.querySelector('.eta-time');
  if (!etaEl) return;
  etaEl.classList.toggle('gone', past);
  const minEl = etaEl.querySelector('.eta-min-num');
  const secEl = etaEl.querySelector('.eta-sec-num');
  if (minEl) minEl.textContent = sign + minutes;
  if (secEl) secEl.textContent = pad2(seconds);
}

function buildArrivalCell(bus, now) {
  const cell = document.createElement('div');
  cell.className = 'arrival';

  if (!bus || !bus.EstimatedArrival) {
    cell.classList.add('empty');
    cell.innerHTML = `
      <div class="eta-time-box">
        <span class="eta-time">—</span>
      </div>
      <div class="eta-icons">
        <span class="bus-icon"></span>
        <span class="load-bar"></span>
        <span class="meta-icons">
          <span class="wab-icon"></span>
          <span class="sched-icon"></span>
        </span>
      </div>`;
    return cell;
  }

  const arrival = new Date(bus.EstimatedArrival);
  const { minutes, seconds, past } = etaParts(arrival, now);
  const sign = past ? '-' : '';
  const isWAB = bus.Feature === 'WAB';
  const isScheduled = !bus.Monitored;
  const busType = bus.Type || 'SD';
  const lc = loadClass(bus.Load);
  const absTime = formatClock(arrival);

  const timeHTML = `<span class="eta-time ${past ? 'gone' : ''}">`
    + `<span class="eta-min-num">${sign}${minutes}</span>`
    + `<span class="eta-unit-inline with-gap">min</span>`
    + `<span class="eta-sec-num">${pad2(seconds)}</span>`
    + `<span class="eta-unit-inline">s</span>`
    + `</span>`;

  cell.innerHTML = `
    <div class="eta-time-box">
      ${timeHTML}
      <span class="eta-abs">${absTime}</span>
    </div>
    <div class="eta-icons">
      <span class="bus-icon ${busType === 'DD' ? 'dd' : ''}" title="${escapeHTML(busTypeLabel(busType))}">${busSVG(busType)}</span>
      <span class="load-bar ${lc}"></span>
      <span class="meta-icons">
        <span class="wab-icon ${isWAB ? 'show' : ''}" title="Wheelchair accessible">${isWAB ? wabSVG() : ''}</span>
        <span class="sched-icon ${isScheduled ? 'show' : ''}" title="Scheduled (not GPS-tracked)">${isScheduled ? clockSVG() : ''}</span>
      </span>
    </div>`;
  cell.title = 'Tap to check for an update';
  return cell;
}

function busTypeLabel(t) {
  if (t === 'DD') return 'Double decker';
  if (t === 'BD') return 'Bendy bus';
  return 'Single decker';
}

// ----- Wiring -----
$('search-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const code = ($('stop-input').value || '').trim();
  if (!/^\d{5}$/.test(code)) {
    $('hints').innerHTML = '<span class="err">Enter a 5-digit bus stop code.</span>';
    return;
  }
  $('hints').textContent = '';
  await addStop(code);
  $('stop-input').value = '';
  $('stop-input').focus();
});

// Tap an arrival cell to force a fresh check for that stop.
$('stops-container').addEventListener('click', (ev) => {
  const cell = ev.target.closest('.arrival');
  if (!cell || cell.classList.contains('empty')) return;
  const card = cell.closest('.stop-card[data-code]');
  if (!card) return;
  refreshStop(card.dataset.code);
});

// ----- About modal -----
const infoModal = $('info-modal');
function openInfoModal() {
  infoModal.hidden = false;
  // Move focus into the dialog for keyboard users
  $('info-modal-close').focus();
}
function closeInfoModal() {
  infoModal.hidden = true;
  $('info-btn').focus();
}
$('info-btn').addEventListener('click', openInfoModal);
$('info-modal-close').addEventListener('click', closeInfoModal);
infoModal.addEventListener('click', (ev) => {
  // Close if the click landed on the backdrop itself (not inside .modal)
  if (ev.target === infoModal) closeInfoModal();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !infoModal.hidden) closeInfoModal();
});

// Populate legend icons
for (const el of document.querySelectorAll('.legend [data-bus]')) {
  el.innerHTML = busSVG(el.dataset.bus);
}
for (const el of document.querySelectorAll('.legend [data-icon="wab"]')) {
  el.innerHTML = wabSVG();
}
for (const el of document.querySelectorAll('.legend [data-icon="clock"]')) {
  el.innerHTML = clockSVG();
}

// Restore stops from storage, or default to 01012 if none saved.
const savedStops = loadStopsFromStorage();
if (savedStops.length > 0) {
  for (const code of savedStops) {
    stops.push(code);
    stopState.set(code, { data: null, error: null });
  }
} else {
  stops.push('01012');
  stopState.set('01012', { data: null, error: null });
  saveStopsToStorage();
}
renderStops();
updateLegend();
startPolling();
startTicker();
