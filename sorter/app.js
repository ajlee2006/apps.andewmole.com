import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/modular/sortable.complete.esm.js';
// (MultiDrag, AutoScroll, Swap, OnSpill are pre-mounted in the complete bundle)

const STORAGE_KEY = 'sorter_state_v1';

const TIER_COLORS = [
  '#ff6b6b', // S - red
  '#ff9f43', // A - orange
  '#feca57', // B - yellow
  '#a8e063', // C - lime
  '#54d6a3', // D - teal/green
  '#48b3ff', // E - blue
  '#a78bfa', // F - purple
  '#ff8fc7', // pink
];
function tierColor(i) { return TIER_COLORS[i % TIER_COLORS.length]; }
let state = { categories: [], pool: [] };
// category: { id, name, items: [string] }

const $ = id => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try { state = JSON.parse(raw); return true; } catch { return false; }
}

function render() {
  const catsEl = $('categories');
  catsEl.innerHTML = '';
  state.categories.forEach((cat, idx) => {
    const color = tierColor(idx);
    const row = document.createElement('div');
    row.className = 'category';
    row.dataset.catId = cat.id;
    row.innerHTML = `
      <div class="cat-label" style="background:${color}">
        <div class="cat-name" contenteditable="true" spellcheck="false">${escapeHtml(cat.name)}</div>
      </div>
      <div class="cat-items" data-cat-id="${cat.id}"></div>
      <div class="cat-actions">
        <button title="Move up" class="up">↑</button>
        <button title="Move down" class="down">↓</button>
        <button title="Delete" class="del">×</button>
      </div>
    `;
    const itemsEl = row.querySelector('.cat-items');
    cat.items.forEach(it => itemsEl.appendChild(makeItemEl(it)));
    catsEl.appendChild(row);

    // events
    const nameEl = row.querySelector('.cat-name');
    nameEl.addEventListener('blur', () => {
      const v = nameEl.textContent.trim() || 'Untitled';
      cat.name = v; nameEl.textContent = v; save();
    });
    nameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    });
    row.querySelector('.up').onclick = () => moveCat(cat.id, -1);
    row.querySelector('.down').onclick = () => moveCat(cat.id, 1);
    row.querySelector('.del').onclick = () => deleteCat(cat.id);

    new Sortable(itemsEl, {
      group: 'items',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      multiDrag: true,
      multiDragKey: 'Shift',
      selectedClass: 'selected',
      onEnd: syncFromDom
    });
  });

  const poolEl = $('pool');
  poolEl.innerHTML = '';
  state.pool.forEach(it => poolEl.appendChild(makeItemEl(it)));
  $('poolCount').textContent = `${state.pool.length} item${state.pool.length === 1 ? '' : 's'}`;
}

function makeItemEl(label) {
  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.label = label;
  el.innerHTML = `<span>${escapeHtml(label)}</span><span class="x" title="Delete">×</span>`;
  el.querySelector('.x').onclick = e => {
    e.stopPropagation();
    deleteItem(label);
  };
  return el;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function syncFromDom() {
  // re-read items in each category and pool from DOM order
  state.categories.forEach(cat => {
    const el = document.querySelector(`.cat-items[data-cat-id="${cat.id}"]`);
    cat.items = Array.from(el.children).map(c => c.dataset.label);
  });
  const poolEl = $('pool');
  state.pool = Array.from(poolEl.children).map(c => c.dataset.label);
  $('poolCount').textContent = `${state.pool.length} item${state.pool.length === 1 ? '' : 's'}`;
  save();
}

function moveCat(id, delta) {
  const i = state.categories.findIndex(c => c.id === id);
  const j = i + delta;
  if (j < 0 || j >= state.categories.length) return;
  [state.categories[i], state.categories[j]] = [state.categories[j], state.categories[i]];
  save(); render();
}

function deleteCat(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;
  if (cat.items.length && !confirm(`Delete "${cat.name}"? Its ${cat.items.length} item(s) will move to Unsorted.`)) return;
  state.pool.push(...cat.items);
  state.categories = state.categories.filter(c => c.id !== id);
  save(); render();
}

function deleteItem(label) {
  state.categories.forEach(c => c.items = c.items.filter(x => x !== label));
  state.pool = state.pool.filter(x => x !== label);
  save(); render();
}

function addCategory(name) {
  name = (name || '').trim() || 'New Category';
  state.categories.push({ id: uid(), name, items: [] });
  save(); render();
}

function addItem(label) {
  label = (label || '').trim();
  if (!label) return;
  // check duplicates
  const all = [...state.pool, ...state.categories.flatMap(c => c.items)];
  if (all.includes(label)) { alert(`"${label}" already exists.`); return; }
  state.pool.push(label);
  save(); render();
}

// Toolbar wiring
$('addCatBtn').onclick = () => {
  const name = prompt('Category name:');
  if (name !== null) addCategory(name);
};
$('addItemBtn').onclick = () => {
  const v = $('newItemInput').value;
  addItem(v);
  $('newItemInput').value = '';
  $('newItemInput').focus();
};
$('newItemInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('addItemBtn').click();
});

$('exportBtn').onclick = () => {
  const data = {
    exportedAt: new Date().toISOString(),
    categories: state.categories.map(c => ({ name: c.name, items: c.items })),
    unsorted: state.pool
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url; a.download = `sorter-${ts}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

$('importBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.categories || !Array.isArray(data.categories)) throw new Error('Invalid format');
      state = {
        categories: data.categories.map(c => ({
          id: uid(),
          name: String(c.name || 'Untitled'),
          items: Array.isArray(c.items) ? c.items.map(String) : []
        })),
        pool: Array.isArray(data.unsorted) ? data.unsorted.map(String) : []
      };
      save(); render();
    } catch (err) {
      alert('Could not import file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};

$('resetBtn').onclick = () => {
  if (!confirm('Reset everything to a clean slate?\n\n⚠ Make sure you exported first — this cannot be undone.')) return;
  if (!confirm('Really reset? All categories and items will be deleted.')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = { categories: [], pool: [] };
  showSetup();
};

// Setup modal
function showSetup() {
  $('setupItems').value = '';
  $('setupCats').value = '';
  $('setupModal').style.display = 'flex';
  $('setupCancel').style.display = state.categories.length || state.pool.length ? 'inline-block' : 'none';
  setTimeout(() => $('setupItems').focus(), 50);
}
$('setupCancel').onclick = () => { $('setupModal').style.display = 'none'; };
$('setupGo').onclick = () => {
  const items = $('setupItems').value.split('\n').map(s => s.trim()).filter(Boolean);
  const cats = $('setupCats').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!items.length && !cats.length) {
    if (!confirm('Both fields are empty. Start anyway with an empty board?')) return;
  }
  // dedupe items
  const seen = new Set(); const dedup = [];
  items.forEach(i => { if (!seen.has(i)) { seen.add(i); dedup.push(i); } });
  state = {
    categories: cats.map(name => ({ id: uid(), name, items: [] })),
    pool: dedup
  };
  save(); render();
  $('setupModal').style.display = 'none';
};

// Pool sortable
new Sortable($('pool'), {
  group: 'items',
  animation: 150,
  ghostClass: 'sortable-ghost',
  chosenClass: 'sortable-chosen',
  multiDrag: true,
  multiDragKey: 'Shift',
  selectedClass: 'selected',
  onEnd: syncFromDom
});

// Ctrl/Cmd + click toggles selection (Shift is handled natively by MultiDrag)
document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
  const item = e.target.closest('.item');
  if (!item || e.target.closest('.x')) return;
  e.preventDefault();
  e.stopPropagation();
  if (item.classList.contains('selected')) Sortable.utils.deselect(item);
  else Sortable.utils.select(item);
}, true);

// ---------- Custom multi-item drag (preserves relative positions) ----------
document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;
  const item = e.target.closest('.item');
  if (!item || e.target.closest('.x')) return;

  const selected = Array.from(document.querySelectorAll('.item.selected'));
  if (!item.classList.contains('selected') || selected.length < 2) return;
  // Multi-drag scenario: take over from SortableJS
  e.preventDefault();
  e.stopImmediatePropagation();
  beginMultiDrag(e, item, selected);
}, true);

function beginMultiDrag(downEv, grabbedItem, items) {
  const startX = downEv.clientX, startY = downEv.clientY;
  let dragStarted = false;
  let clones = [];
  let indicator = null;
  let dropContainer = null;
  let dropBefore = null;

  function startDrag() {
    dragStarted = true;
    clones = items.map(el => {
      const r = el.getBoundingClientRect();
      const clone = el.cloneNode(true);
      clone.classList.add('drag-clone');
      clone.classList.remove('selected');
      clone.style.left = r.left + 'px';
      clone.style.top = r.top + 'px';
      clone.style.width = r.width + 'px';
      clone.style.height = r.height + 'px';
      document.body.appendChild(clone);
      el.classList.add('dragging-source');
      return { clone, origEl: el, label: el.dataset.label, dx: r.left - startX, dy: r.top - startY };
    });
    indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    indicator.style.display = 'none';
    document.body.appendChild(indicator);
  }

  function findDrop(x, y) {
    // Hide clones briefly for hit-testing
    clones.forEach(c => c.clone.style.display = 'none');
    const under = document.elementFromPoint(x, y);
    clones.forEach(c => c.clone.style.display = '');
    if (!under) return { container: null, before: null };
    const container = under.closest('.cat-items, .pool');
    if (!container) return { container: null, before: null };

    const excluded = items;
    const candidates = Array.from(container.children)
      .filter(it => it.classList.contains('item') && !excluded.includes(it));

    if (candidates.length === 0) return { container, before: null };

    // Find closest by center
    let closest = null, bestDist = Infinity, before = true;
    for (const it of candidates) {
      const r = it.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestDist) {
        bestDist = d;
        closest = it;
        before = x < cx;
      }
    }
    let target;
    if (before) {
      target = closest;
    } else {
      target = closest.nextElementSibling;
      while (target && excluded.includes(target)) target = target.nextElementSibling;
    }
    return { container, before: target };
  }

  function showIndicator(container, before) {
    if (!container) { indicator.style.display = 'none'; return; }
    indicator.style.display = 'block';
    if (before) {
      const r = before.getBoundingClientRect();
      indicator.style.left = (r.left - 4) + 'px';
      indicator.style.top = r.top + 'px';
      indicator.style.width = '2px';
      indicator.style.height = r.height + 'px';
    } else {
      // Insert at end of container
      const siblings = Array.from(container.children).filter(it => it.classList.contains('item') && !items.includes(it));
      if (siblings.length) {
        const last = siblings[siblings.length - 1];
        const r = last.getBoundingClientRect();
        indicator.style.left = (r.right + 2) + 'px';
        indicator.style.top = r.top + 'px';
        indicator.style.width = '2px';
        indicator.style.height = r.height + 'px';
      } else {
        const r = container.getBoundingClientRect();
        indicator.style.left = (r.left + 12) + 'px';
        indicator.style.top = (r.top + 12) + 'px';
        indicator.style.width = '40px';
        indicator.style.height = '2px';
      }
    }
  }

  const onMove = ev => {
    if (!dragStarted) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      startDrag();
    }
    clones.forEach(c => {
      c.clone.style.left = (ev.clientX + c.dx) + 'px';
      c.clone.style.top = (ev.clientY + c.dy) + 'px';
    });
    const drop = findDrop(ev.clientX, ev.clientY);
    dropContainer = drop.container;
    dropBefore = drop.before;
    showIndicator(dropContainer, dropBefore);
  };

  const onUp = ev => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keydown', onKey);

    if (!dragStarted) {
      // Pure click on a selected item: clear other selections, keep this one
      deselectAll();
      Sortable.utils.select(grabbedItem);
      return;
    }

    // Cleanup
    clones.forEach(c => { c.clone.remove(); c.origEl.classList.remove('dragging-source'); });
    indicator.remove();

    if (!dropContainer) return; // dropped outside

    const labels = items.map(el => el.dataset.label);
    // Remove from current locations
    state.categories.forEach(cat => cat.items = cat.items.filter(it => !labels.includes(it)));
    state.pool = state.pool.filter(it => !labels.includes(it));

    // Determine destination list
    const targetCatId = dropContainer.dataset.catId;
    const targetList = targetCatId
      ? state.categories.find(c => c.id === targetCatId).items
      : state.pool;

    let idx = targetList.length;
    if (dropBefore) {
      const i = targetList.indexOf(dropBefore.dataset.label);
      if (i !== -1) idx = i;
    }
    targetList.splice(idx, 0, ...labels);

    save();
    render();
    // Re-select the moved items
    requestAnimationFrame(() => {
      Array.from(document.querySelectorAll('.item')).forEach(el => {
        if (labels.includes(el.dataset.label)) Sortable.utils.select(el);
      });
    });
  };

  const onKey = ev => {
    if (ev.key === 'Escape' && dragStarted) {
      clones.forEach(c => { c.clone.remove(); c.origEl.classList.remove('dragging-source'); });
      indicator.remove();
      dropContainer = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('keydown', onKey);
}

// ---------- Marquee selection ----------
let marquee = null, mqStart = null, mqShift = false, mqMoved = false;

document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const container = e.target.closest('.cat-items, .pool');
  if (!container) return;
  // Only start marquee if mousedown happened on the container background, not on a child item
  if (e.target !== container) return;

  mqShift = e.shiftKey || e.ctrlKey || e.metaKey;
  mqStart = { x: e.clientX, y: e.clientY };
  mqMoved = false;
  marquee = document.createElement('div');
  marquee.className = 'marquee-box';
  marquee.style.left = mqStart.x + 'px';
  marquee.style.top = mqStart.y + 'px';
  marquee.style.width = '0px';
  marquee.style.height = '0px';
  document.body.appendChild(marquee);
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!marquee) return;
  if (Math.abs(e.clientX - mqStart.x) > 3 || Math.abs(e.clientY - mqStart.y) > 3) mqMoved = true;
  const x1 = Math.min(mqStart.x, e.clientX);
  const y1 = Math.min(mqStart.y, e.clientY);
  const x2 = Math.max(mqStart.x, e.clientX);
  const y2 = Math.max(mqStart.y, e.clientY);
  marquee.style.left = x1 + 'px';
  marquee.style.top = y1 + 'px';
  marquee.style.width = (x2 - x1) + 'px';
  marquee.style.height = (y2 - y1) + 'px';
});

document.addEventListener('mouseup', e => {
  if (!marquee) return;
  const rect = marquee.getBoundingClientRect();
  marquee.remove();
  marquee = null;

  // Pure click (no drag) on empty area: deselect all
  if (!mqMoved) {
    if (!mqShift) deselectAll();
    return;
  }

  // If not shift, clear existing selection first
  if (!mqShift) deselectAll();

  // Select items whose bounding box intersects the marquee
  document.querySelectorAll('.item').forEach(el => {
    const r = el.getBoundingClientRect();
    const hit = r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
    if (hit) Sortable.utils.select(el);
  });
});

function deselectAll() {
  document.querySelectorAll('.item.selected').forEach(el => Sortable.utils.deselect(el));
}

// Escape clears selection
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') deselectAll();
});

// Boot
if (load() && (state.categories.length || state.pool.length)) {
  render();
} else {
  showSetup();
}
