// English Synonym Swapper
// Uses Datamuse rel_syn endpoint. Output uses the first synonym.
// Click a word to pick a different synonym from a paginated popup.

const $ = (id) => document.getElementById(id);
const input = $('input');
const inputOverlay = $('input-overlay');
const output = $('output');
const status = $('status');
const useAsInputBtn = $('use-as-input');
const bubble = $('word-bubble');
const titleEl = $('title');

// lowercase word -> array of synonym strings, or null
const synonymCache = new Map();
// in-flight fetches so we don't double-fire
const pendingFetches = new Map();

// Tokens for the current input. {type:'word', text, index} or {type:'gap', text}
let tokens = [];
// Per-word-index override (a chosen synonym, already case-matched). null/undefined = use first.
let chosenOverride = [];

const TOKEN_RE = /([A-Za-z]+(?:['-][A-Za-z]+)*)|([^A-Za-z]+)/g;
const BUBBLE_PAGE_SIZE = 5;

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

async function fetchSynonyms(word) {
  const key = word.toLowerCase();
  if (synonymCache.has(key)) return synonymCache.get(key);
  if (pendingFetches.has(key)) return pendingFetches.get(key);

  const p = (async () => {
    try {
      const r = await fetch(
        `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(key)}&max=100`
      );
      const data = await r.json();
      const syns = data
        .map(d => d.word)
        .filter(w =>
          w &&
          !w.includes(' ') &&
          /^[A-Za-z][A-Za-z'-]*$/.test(w) &&
          w.toLowerCase() !== key
        );
      synonymCache.set(key, syns.length ? syns : null);
      return synonymCache.get(key);
    } catch {
      synonymCache.set(key, null);
      return null;
    } finally {
      pendingFetches.delete(key);
    }
  })();
  pendingFetches.set(key, p);
  return p;
}

function chosenFor(token) {
  // returns case-matched synonym string, or null if none
  const ov = chosenOverride[token.index];
  if (ov) return ov;
  const list = synonymCache.get(token.text.toLowerCase());
  if (!list || !list.length) return null;
  return preserveCase(token.text, list[0]);
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
    output.textContent = 'Output will appear here.';
    return;
  }
  let html = '';
  for (const t of tokens) {
    if (t.type === 'word') {
      const c = chosenFor(t);
      if (c) {
        html += `<span class="word swapped" data-i="${t.index}">${escapeHtml(c)}</span>`;
      } else {
        html += `<span class="word unchanged" data-i="${t.index}" title="No synonyms found">${escapeHtml(t.text)}</span>`;
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

  const words = tokens.filter(t => t.type === 'word');
  if (!words.length) {
    renderOutput();
    status.textContent = '';
    return;
  }

  const uniques = [...new Set(words.map(t => t.text.toLowerCase()))];
  const needed = uniques.filter(w => !synonymCache.has(w));

  if (needed.length) {
    status.textContent = `Looking up synonyms (${needed.length})…`;
    await Promise.all(needed.map(fetchSynonyms));
    if (myToken !== updateToken) return;
  }

  status.textContent = '';
  renderOutput();
}

// ============== Cross-panel hover ==============
function setHover(index, on) {
  document.querySelectorAll(`.word[data-i="${index}"]`).forEach(el => {
    el.classList.toggle('word-link-hover', on);
  });
}
document.addEventListener('mouseover', e => {
  const w = e.target.closest && e.target.closest('.word[data-i]');
  if (w) setHover(w.dataset.i, true);
});
document.addEventListener('mouseout', e => {
  const w = e.target.closest && e.target.closest('.word[data-i]');
  if (w) setHover(w.dataset.i, false);
});

// ============== Synonym chooser bubble ==============
let bubbleState = null;
// { wordIndex, originalText, list, page }

function closeBubble() {
  bubble.hidden = true;
  bubble.innerHTML = '';
  bubbleState = null;
}

function positionBubble(wordEl) {
  // First, append to body so we can measure (also so it's not clipped by panel overflow).
  if (bubble.parentNode !== document.body) document.body.appendChild(bubble);
  const rect = wordEl.getBoundingClientRect();
  bubble.style.left = (rect.left + rect.width / 2 + window.scrollX) + 'px';
  bubble.style.top = (rect.top + window.scrollY) + 'px';
}

function renderBubble() {
  if (!bubbleState) return;
  const { list, page, originalText, wordIndex } = bubbleState;
  const currentChosen = chosenFor({ type: 'word', text: originalText, index: wordIndex });

  bubble.innerHTML = '';
  if (!list || !list.length) {
    const msg = document.createElement('span');
    msg.className = 'bubble-msg';
    msg.textContent = 'No synonyms found';
    bubble.appendChild(msg);
    return;
  }

  const start = page * BUBBLE_PAGE_SIZE;
  const slice = list.slice(0, start + BUBBLE_PAGE_SIZE);
  for (const syn of slice) {
    const cased = preserveCase(originalText, syn);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'syn-btn';
    btn.textContent = cased;
    if (cased === currentChosen) btn.classList.add('current');
    btn.addEventListener('click', () => {
      chosenOverride[wordIndex] = cased;
      renderOutput();
      closeBubble();
    });
    bubble.appendChild(btn);
  }
  if (list.length > slice.length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more-btn';
    more.textContent = '+';
    more.title = 'Show more synonyms';
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      bubbleState.page += 1;
      renderBubble();
    });
    bubble.appendChild(more);
  }
}

async function openBubbleForWord(wordEl) {
  const idx = parseInt(wordEl.dataset.i, 10);
  const token = tokens.find(t => t.type === 'word' && t.index === idx);
  if (!token) return;
  const originalText = token.text;

  // Ensure we have synonyms cached (usually we already do).
  if (!synonymCache.has(originalText.toLowerCase())) {
    await fetchSynonyms(originalText);
  }
  const list = synonymCache.get(originalText.toLowerCase());

  bubbleState = { wordIndex: idx, originalText, list, page: 0 };
  positionBubble(wordEl);
  bubble.hidden = false;
  renderBubble();
}

// Click a word -> open bubble
document.addEventListener('click', (e) => {
  const w = e.target.closest && e.target.closest('.word[data-i]');
  if (w && (output.contains(w) || inputOverlay.contains(w))) {
    e.preventDefault();
    openBubbleForWord(w);
    return;
  }
  // Click outside bubble (and not on a word) closes it
  if (!bubble.hidden && !bubble.contains(e.target)) {
    closeBubble();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBubble();
});
window.addEventListener('resize', closeBubble);
window.addEventListener('scroll', closeBubble, true);

// ============== Use-as-input button ==============
useAsInputBtn.addEventListener('click', () => {
  // Build the swapped text from current tokens + choices
  if (!tokens.length) return;
  let out = '';
  for (const t of tokens) {
    if (t.type === 'word') {
      const c = chosenFor(t);
      out += c || t.text;
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

// ============== Easter egg: hover title to swap all on-page English text ==============
const eggElements = []; // [{el, original, swapped}]

async function preloadEasterEgg() {
  const els = document.querySelectorAll('.translatable');
  // Collect unique words across all targeted elements (use innerText to get rendered text only).
  const allWords = new Set();
  els.forEach(el => {
    for (const t of tokenize(el.textContent)) {
      if (t.type === 'word') allWords.add(t.text.toLowerCase());
    }
  });
  await Promise.all([...allWords].map(fetchSynonyms));

  // Build swapped strings.
  els.forEach(el => {
    const original = el.textContent;
    const toks = tokenize(original);
    let swapped = '';
    for (const t of toks) {
      if (t.type === 'word') {
        const list = synonymCache.get(t.text.toLowerCase());
        const first = list && list[0];
        swapped += first ? preserveCase(t.text, first) : t.text;
      } else {
        swapped += t.text;
      }
    }
    eggElements.push({ el, original, swapped });
  });

  titleEl.classList.add('easter-ready');
  titleEl.title = 'Hover to swap';
}

function applyEgg(on) {
  for (const { el, original, swapped } of eggElements) {
    el.textContent = on ? swapped : original;
  }
}

titleEl.addEventListener('mouseenter', () => { if (titleEl.classList.contains('easter-ready')) applyEgg(true); });
titleEl.addEventListener('mouseleave', () => { if (titleEl.classList.contains('easter-ready')) applyEgg(false); });

// ============== Init ==============
function init() {
  // Read URL ?text=
  const urlText = new URLSearchParams(window.location.search).get('text');
  if (urlText) input.value = urlText;

  autosize();
  // Kick off main update (synonyms + render)
  update();
  // Pre-load easter egg in the background
  preloadEasterEgg();
}
init();
