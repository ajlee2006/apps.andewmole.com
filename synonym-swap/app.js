// English Synonym Swapper
// Datamuse rel_syn for primary swap; ml as a fallback/extension for the chooser popup.

const $ = (id) => document.getElementById(id);
const input        = $('input');
const inputOverlay = $('input-overlay');
const output       = $('output');
const status       = $('status');
const useAsInputBtn= $('use-as-input');
const bubble       = $('word-bubble');
const titleEl      = $('title');

// lowercase word -> array of synonyms (rel_syn), or null
const synonymCache = new Map();
// lowercase word -> array of related words (ml), or null
const mlCache = new Map();
// in-flight fetches keyed by `${kind}:${word}`
const pendingFetches = new Map();

let tokens = [];               // current input tokens
let chosenOverride = [];       // per word-index: user-picked replacement (case-preserved). undefined = use default

const TOKEN_RE = /([A-Za-z]+(?:['-][A-Za-z]+)*)|([^A-Za-z]+)/g;
const BUBBLE_PAGE_SIZE = 5;
const EMPTY_OUTPUT_TEXT = 'Output will appear here.';

function tokenize(text) {
  const out = [];
  let wi = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1]) out.push({ type: 'word', text: m[1], index: wi++ });
    else      out.push({ type: 'gap', text: m[2] });
  }
  return out;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function preserveCase(original, replacement) {
  if (!replacement) return original;
  if (original.length > 1 && original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function isUsableWord(w) {
  return w && !w.includes(' ') && /^[A-Za-z][A-Za-z'-]*$/.test(w);
}

async function fetchKind(kind, word) {
  const key = word.toLowerCase();
  const cache = kind === 'rel_syn' ? synonymCache : mlCache;
  if (cache.has(key)) return cache.get(key);
  const fkey = `${kind}:${key}`;
  if (pendingFetches.has(fkey)) return pendingFetches.get(fkey);

  const p = (async () => {
    try {
      const r = await fetch(
        `https://api.datamuse.com/words?${kind}=${encodeURIComponent(key)}&max=100`
      );
      const data = await r.json();
      const list = data
        .map(d => d.word)
        .filter(w => isUsableWord(w) && w.toLowerCase() !== key);
      cache.set(key, list.length ? list : null);
      return cache.get(key);
    } catch {
      cache.set(key, null);
      return null;
    } finally {
      pendingFetches.delete(fkey);
    }
  })();
  pendingFetches.set(fkey, p);
  return p;
}
const fetchRelSyn = (w) => fetchKind('rel_syn', w);
const fetchMl     = (w) => fetchKind('ml', w);

// ============== Output ==============
function effectiveFor(token) {
  if (chosenOverride[token.index] !== undefined) {
    return { state: 'ok', text: chosenOverride[token.index] };
  }
  const key = token.text.toLowerCase();
  if (!synonymCache.has(key)) return { state: 'pending', text: '…' };
  const list = synonymCache.get(key);
  if (list && list.length) {
    return { state: 'ok', text: preserveCase(token.text, list[0]) };
  }
  return { state: 'none', text: token.text };
}

function renderOverlay() {
  let html = '';
  for (const t of tokens) {
    if (t.type === 'word') {
      html += `<span class="word" data-i="${t.index}">${escapeHtml(t.text)}</span>`;
    } else {
      html += escapeHtml(t.text);
    }
  }
  inputOverlay.innerHTML = html;
}

function renderOutput() {
  const hasWord = tokens.some(t => t.type === 'word');
  if (!hasWord) {
    output.classList.add('empty');
    output.textContent = eggActive ? outputEmptySwapped : EMPTY_OUTPUT_TEXT;
    return;
  }
  let html = '';
  for (const t of tokens) {
    if (t.type === 'word') {
      const e = effectiveFor(t);
      if (e.state === 'pending') {
        html += `<span class="word pending" data-i="${t.index}">…</span>`;
      } else if (e.state === 'none') {
        html += `<span class="word unchanged" data-i="${t.index}" title="No synonyms found">${escapeHtml(t.text)}</span>`;
      } else {
        const cls = e.text === t.text ? 'word kept' : 'word swapped';
        html += `<span class="${cls}" data-i="${t.index}">${escapeHtml(e.text)}</span>`;
      }
    } else {
      html += escapeHtml(t.text);
    }
  }
  output.classList.remove('empty');
  output.innerHTML = html;
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = input.scrollHeight + 'px';
}

// ============== URL state ==============
function updateURL(text) {
  const url = new URL(window.location);
  if (text) url.searchParams.set('text', text);
  else url.searchParams.delete('text');
  history.replaceState(null, '', url);
}

// ============== Main update ==============
let updateToken = 0;
async function update({ resetOverrides = true } = {}) {
  closeBubble();
  const myToken = ++updateToken;
  const text = input.value;
  updateURL(text);

  tokens = tokenize(text);
  if (resetOverrides) chosenOverride = [];

  renderOverlay();
  autosize();
  status.textContent = '';
  renderOutput(); // immediate render — pending words show "…"

  const words = tokens.filter(t => t.type === 'word');
  if (!words.length) return;

  const uniques = [...new Set(words.map(t => t.text.toLowerCase()))];

  // Fire both endpoints. rel_syn drives the output, so each completion re-renders.
  for (const w of uniques) {
    if (!synonymCache.has(w)) {
      fetchRelSyn(w).then(() => {
        if (myToken === updateToken) renderOutput();
      });
    }
    if (!mlCache.has(w)) {
      fetchMl(w); // background, popup-only
    }
  }
}

// ============== Cross-panel hover ==============
function setHover(index, on) {
  document.querySelectorAll(`.word[data-i="${index}"]`).forEach(el => {
    el.classList.toggle('word-link-hover', on);
  });
}
// Output side: native events work (pointer-events: auto by default).
document.addEventListener('mouseover', e => {
  const w = e.target.closest && e.target.closest('.word[data-i]');
  if (w && output.contains(w)) setHover(w.dataset.i, true);
});
document.addEventListener('mouseout', e => {
  const w = e.target.closest && e.target.closest('.word[data-i]');
  if (w && output.contains(w)) setHover(w.dataset.i, false);
});

// Input side: input-overlay words are pointer-events:none, so detect hover
// by checking which overlay word's bounding rect contains the cursor.
const inputPanelEl = document.querySelector('.input-panel');
let inputHoverIdx = null;
let inputHoverRaf = null;
let inputHoverCoords = null;

function checkInputHover() {
  inputHoverRaf = null;
  if (!inputHoverCoords) return;
  const { x, y } = inputHoverCoords;
  let hit = null;
  for (const span of inputOverlay.querySelectorAll('.word')) {
    const r = span.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { hit = span; break; }
  }
  const newIdx = hit ? hit.dataset.i : null;
  if (newIdx !== inputHoverIdx) {
    if (inputHoverIdx != null) setHover(inputHoverIdx, false);
    if (newIdx != null) setHover(newIdx, true);
    inputHoverIdx = newIdx;
  }
}
inputPanelEl.addEventListener('mousemove', e => {
  inputHoverCoords = { x: e.clientX, y: e.clientY };
  if (!inputHoverRaf) inputHoverRaf = requestAnimationFrame(checkInputHover);
});
inputPanelEl.addEventListener('mouseleave', () => {
  inputHoverCoords = null;
  if (inputHoverIdx != null) { setHover(inputHoverIdx, false); inputHoverIdx = null; }
});

// ============== Synonym chooser bubble ==============
let bubbleState = null;  // { wordIndex, originalText, page }

function closeBubble() {
  bubble.hidden = true;
  bubble.innerHTML = '';
  bubbleState = null;
}

function positionBubble(wordEl) {
  if (bubble.parentNode !== document.body) document.body.appendChild(bubble);
  const rect = wordEl.getBoundingClientRect();
  bubble.style.left = (rect.left + rect.width / 2 + window.scrollX) + 'px';
  bubble.style.top  = (rect.top + window.scrollY) + 'px';
}

// Combine rel_syn + ml, deduped against each other and against the original.
function getOptionsForWord(originalText) {
  const key = originalText.toLowerCase();
  const syns = synonymCache.get(key) || [];
  const ml   = mlCache.get(key) || [];
  const seen = new Set([key]);
  const out = [];
  for (const w of syns) {
    const k = w.toLowerCase();
    if (!seen.has(k)) { out.push(w); seen.add(k); }
  }
  for (const w of ml) {
    const k = w.toLowerCase();
    if (!seen.has(k)) { out.push(w); seen.add(k); }
  }
  return out;
}

function renderBubble() {
  if (!bubbleState) return;
  const { wordIndex, originalText, page } = bubbleState;

  // What's currently shown in the output for this word?
  const eff = effectiveFor({ type: 'word', text: originalText, index: wordIndex });
  const effText = (eff.state === 'ok' || eff.state === 'none') ? eff.text : null;

  bubble.innerHTML = '';

  // Original (always first)
  const origBtn = document.createElement('button');
  origBtn.type = 'button';
  origBtn.className = 'syn-btn original';
  origBtn.textContent = originalText;
  if (effText === originalText) origBtn.classList.add('current');
  origBtn.addEventListener('click', () => {
    chosenOverride[wordIndex] = originalText;
    renderOutput();
    closeBubble();
  });
  bubble.appendChild(origBtn);

  // Divider after original
  const options = getOptionsForWord(originalText);
  if (options.length) {
    const div = document.createElement('span');
    div.className = 'divider';
    bubble.appendChild(div);
  }

  // Pending state (data still loading)?
  const key = originalText.toLowerCase();
  const stillLoading = !synonymCache.has(key) || !mlCache.has(key);

  if (!options.length) {
    const msg = document.createElement('span');
    msg.className = 'bubble-msg';
    msg.textContent = stillLoading ? 'Loading…' : 'No alternatives';
    bubble.appendChild(msg);
    return;
  }

  const visibleCount = (page + 1) * BUBBLE_PAGE_SIZE;
  const visible = options.slice(0, visibleCount);
  for (const opt of visible) {
    const cased = preserveCase(originalText, opt);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'syn-btn';
    btn.textContent = cased;
    if (cased === effText) btn.classList.add('current');
    btn.addEventListener('click', () => {
      chosenOverride[wordIndex] = cased;
      renderOutput();
      closeBubble();
    });
    bubble.appendChild(btn);
  }

  if (options.length > visible.length || stillLoading) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more-btn';
    more.textContent = '+';
    more.title = 'Show more';
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      bubbleState.page += 1;
      renderBubble();
    });
    bubble.appendChild(more);
  }
}

function openBubbleForWord(wordEl) {
  const idx = parseInt(wordEl.dataset.i, 10);
  const token = tokens.find(t => t.type === 'word' && t.index === idx);
  if (!token) return;

  bubbleState = { wordIndex: idx, originalText: token.text, page: 0 };
  positionBubble(wordEl);
  bubble.hidden = false;
  renderBubble();

  const key = token.text.toLowerCase();
  const tasks = [];
  if (!synonymCache.has(key)) tasks.push(fetchRelSyn(key));
  if (!mlCache.has(key))      tasks.push(fetchMl(key));
  if (tasks.length) {
    Promise.all(tasks).then(() => {
      if (bubbleState && bubbleState.wordIndex === idx) renderBubble();
      renderOutput();
    });
  }
}

// Click a word in the OUTPUT panel -> open bubble.
// Input overlay words are pointer-events:none so clicks pass through to the textarea natively.
document.addEventListener('click', (e) => {
  const w = e.target.closest && e.target.closest('.word[data-i]');
  if (w && output.contains(w)) {
    e.preventDefault();
    openBubbleForWord(w);
    return;
  }
  if (!bubble.hidden && !bubble.contains(e.target)) closeBubble();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBubble(); });
window.addEventListener('resize', closeBubble);
window.addEventListener('scroll', closeBubble, true);

// ============== Use-as-input button ==============
useAsInputBtn.addEventListener('click', () => {
  if (!tokens.length) return;
  let out = '';
  for (const t of tokens) {
    if (t.type === 'word') {
      const e = effectiveFor(t);
      out += (e.state === 'ok' || e.state === 'none') ? e.text : t.text;
    } else {
      out += t.text;
    }
  }
  input.value = out;
  update();
  input.focus();
});

// ============== Debounced input ==============
let debounceTimer;
input.addEventListener('input', () => {
  autosize();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(update, 250);
});

// ============== Easter egg ==============
let eggActive = false;
let eggReady  = false;
let outputEmptySwapped = EMPTY_OUTPUT_TEXT;
const eggTexts = [];   // {el, original, swapped}
const eggAttrs = [];   // {el, attr, original, swapped}

function swapStringWithFirstSyn(text) {
  let result = '';
  for (const t of tokenize(text)) {
    if (t.type === 'word') {
      const list = synonymCache.get(t.text.toLowerCase());
      const first = list && list[0];
      result += first ? preserveCase(t.text, first) : t.text;
    } else {
      result += t.text;
    }
  }
  return result;
}

async function preloadEasterEgg() {
  const els = [...document.querySelectorAll('.translatable')];
  const texts = els.map(el => el.textContent);
  texts.push(input.placeholder);
  texts.push(EMPTY_OUTPUT_TEXT);

  const allWords = new Set();
  for (const text of texts) {
    for (const t of tokenize(text)) {
      if (t.type === 'word') allWords.add(t.text.toLowerCase());
    }
  }
  await Promise.all([...allWords].map(fetchRelSyn));

  for (const el of els) {
    const original = el.textContent;
    eggTexts.push({ el, original, swapped: swapStringWithFirstSyn(original) });
  }
  eggAttrs.push({
    el: input, attr: 'placeholder',
    original: input.placeholder,
    swapped: swapStringWithFirstSyn(input.placeholder)
  });
  outputEmptySwapped = swapStringWithFirstSyn(EMPTY_OUTPUT_TEXT);

  eggReady = true;
}

function applyEgg(on) {
  if (!eggReady) return;
  eggActive = on;
  for (const it of eggTexts) it.el.textContent = on ? it.swapped : it.original;
  for (const it of eggAttrs) it.el.setAttribute(it.attr, on ? it.swapped : it.original);
  if (output.classList.contains('empty')) {
    output.textContent = on ? outputEmptySwapped : EMPTY_OUTPUT_TEXT;
  }
}

titleEl.addEventListener('mouseenter', () => applyEgg(true));
titleEl.addEventListener('mouseleave', () => applyEgg(false));

// ============== Init ==============
function init() {
  const urlText = new URLSearchParams(window.location.search).get('text');
  if (urlText) input.value = urlText;
  autosize();
  update();
  preloadEasterEgg();
}
init();
