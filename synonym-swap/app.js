// English Synonym Swapper
// Uses Datamuse API (no key required), ml= ("means like") endpoint.
// Each word is replaced by the top-ranked related word.

const $ = (id) => document.getElementById(id);
const input = $('input');
const inputOverlay = $('input-overlay');
const output = $('output');
const status = $('status');

// word(lowercase) -> chosen replacement string, or null if none found
const synonymCache = new Map();
// in-flight fetches so we don't double-fire
const pendingFetches = new Map();

// Tokens for the current input. Each is {type:'word', text, index} or {type:'gap', text}
let tokens = [];

// Words (letters + internal apostrophes/hyphens) vs everything else.
const TOKEN_RE = /([A-Za-z]+(?:['-][A-Za-z]+)*)|([^A-Za-z]+)/g;

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

async function fetchSynonym(word) {
  const key = word.toLowerCase();
  if (synonymCache.has(key)) return synonymCache.get(key);
  if (pendingFetches.has(key)) return pendingFetches.get(key);

  const p = (async () => {
    try {
      const r = await fetch(
        `https://api.datamuse.com/words?ml=${encodeURIComponent(key)}&max=10`
      );
      const data = await r.json();
      const first = data.find(d =>
        d.word &&
        !d.word.includes(' ') &&
        /^[A-Za-z][A-Za-z'-]*$/.test(d.word) &&
        d.word.toLowerCase() !== key
      );
      synonymCache.set(key, first ? first.word : null);
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
      const syn = synonymCache.get(t.text.toLowerCase());
      if (syn) {
        const cased = preserveCase(t.text, syn);
        html += `<span class="word swapped" data-i="${t.index}">${escapeHtml(cased)}</span>`;
      } else {
        html += `<span class="word unchanged" data-i="${t.index}" title="No related word found — original kept.">${escapeHtml(t.text)}</span>`;
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

let updateToken = 0;
async function update() {
  const myToken = ++updateToken;
  tokens = tokenize(input.value);
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
    status.textContent = `Looking up words (${needed.length})…`;
    await Promise.all(needed.map(fetchSynonym));
    if (myToken !== updateToken) return; // a newer update has superseded us
  }

  status.textContent = '';
  renderOutput();
}

// Cross-panel hover highlighting
function setHover(index, on) {
  document.querySelectorAll(`.word[data-i="${index}"]`).forEach(el => {
    el.classList.toggle('word-link-hover', on);
  });
}
document.addEventListener('mouseover', e => {
  const w = e.target.closest && e.target.closest('.word');
  if (w && w.dataset.i != null) setHover(w.dataset.i, true);
});
document.addEventListener('mouseout', e => {
  const w = e.target.closest && e.target.closest('.word');
  if (w && w.dataset.i != null) setHover(w.dataset.i, false);
});

// Debounced input
let debounceTimer;
input.addEventListener('input', () => {
  autosize();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(update, 250);
});

// Init
autosize();
