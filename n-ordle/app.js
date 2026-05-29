// n-ordle — Wordle-like game generalised to n boards.
// Logic faithfully ports the Python implementation.

const LENGTH = 5;
let ANSWERS = [];
let ALLOWED = [];
let VALID_SET = null;
let COMBINED = [];           // ANSWERS first, then ALLOWED. Used for share-link indices.

// --- DOM shortcuts ---
const $ = (id) => document.getElementById(id);
const setupEl = () => $('setup');
const sharedPromptEl = () => $('shared-prompt');
const loadingEl = () => $('loading');
const gameEl = () => $('game');
const boardsEl = () => $('boards');
const keyboardEl = () => $('keyboard');
const endEl = () => $('endscreen');
const toastEl = () => $('toast');
const headerN = () => $('header-n');
const headerInfo = () => $('header-info');

// --- Game state ---
let state = null;
// Pending shared-link payload (decoded but not yet started).
let pendingShared = null;

// =====================================================
// Word list loading
// =====================================================
async function loadWordLists() {
  const [a, b] = await Promise.all([
    fetch('answers.txt').then(r => {
      if (!r.ok) throw new Error('answers.txt failed: ' + r.status);
      return r.text();
    }),
    fetch('guesses.txt').then(r => {
      if (!r.ok) throw new Error('guesses.txt failed: ' + r.status);
      return r.text();
    }),
  ]);
  // Files are Python-list literals, but with double-quoted strings, so JSON parses fine.
  ANSWERS = JSON.parse(a.trim());
  ALLOWED = JSON.parse(b.trim());
  VALID_SET = new Set([...ANSWERS, ...ALLOWED]);
  COMBINED = [...ANSWERS, ...ALLOWED];
  $('n-input').max = COMBINED.length;
}

// =====================================================
// Wordle scoring — exact port of Python logic.
// Green pass first, consuming target letters; then yellow pass, also consuming.
// =====================================================
function scoreGuess(guess, target) {
  const g = guess.split('');
  const t = target.split('');
  const result = new Array(LENGTH).fill('x');
  for (let i = 0; i < LENGTH; i++) {
    if (g[i] === t[i]) {
      result[i] = 'g';
      t[i] = ' ';
    }
  }
  for (let i = 0; i < LENGTH; i++) {
    if (result[i] === 'g') continue;
    const idx = t.indexOf(g[i]);
    if (idx !== -1) {
      result[i] = 'y';
      t[idx] = ' ';
    }
  }
  return result.join('');
}

function isValidGuess(word) {
  if (!word || word.length !== LENGTH) return false;
  if (VALID_SET.has(word)) return true;
  // Targets themselves are always allowed (matches Python's answers+allowed+words check).
  if (state && state.words.includes(word)) return true;
  return false;
}

// =====================================================
// Game setup
// =====================================================
function pickWordsForN(n) {
  // Mirrors the Python: shuffle answers, take from there;
  // if n > answers, pop the rest from a shuffled allowed list.
  const pool = [...ANSWERS];
  shuffle(pool);
  let words;
  if (n <= pool.length) {
    words = pool.slice(0, n);
  } else {
    const extra = [...ALLOWED];
    shuffle(extra);
    words = [...pool, ...extra.slice(0, n - pool.length)];
  }
  shuffle(words);
  return words;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function newGame(n, predefinedWords = null) {
  const words = predefinedWords || pickWordsForN(n);
  state = {
    n,
    maxGuesses: n + 5,
    words,
    guesses: [],
    patterns: Array.from({ length: n }, () => []), // patterns[boardIdx][guessIdx]
    solved: new Array(n).fill(false),
    scores: new Array(n).fill('X'),
    current: '',
    finished: false,
  };
}

// =====================================================
// Layout: number of columns for the boards grid.
// The keyboard cell grid mirrors this layout exactly.
// =====================================================
function computeColumns(n) {
  if (n <= 1) return 1;
  // Measured board footprint, must match CSS:
  //   tile width + 4 inter-tile gaps  +  inter-board gap
  // Desktop: 38*5 + 4*4 = 206;  Mobile: 30*5 + 4*4 = 166.
  // Inter-board horizontal gap (--cols gap): 18 desktop, 12 mobile.
  const isMobile = window.innerWidth < 600;
  const boardWidth = isMobile ? 166 : 206;
  const gap = isMobile ? 12 : 18;
  // main has 16px (8 mobile) horizontal padding on each side; account for that
  // plus a small safety margin.
  const sidePadding = isMobile ? 8 : 16;
  const available = window.innerWidth - 2 * sidePadding - 4;
  // How many boards fit horizontally?
  const maxByWidth = Math.max(1, Math.floor((available + gap) / (boardWidth + gap)));

  // If the whole game fits in one row at this viewport, use one row.
  if (n <= maxByWidth) return n;

  // Otherwise: each row of boards is fairly tall (board height ≈ 7+ tiles for n=2,
  // up to dozens of tiles for large n), so vertical space disappears fast. Use as
  // many columns as fit horizontally — this minimises rows and reduces scrolling.
  // For very large n at narrow widths, also keep a sane lower bound via sqrt so we
  // don't make absurdly tall column-strips when wider would be fine. (maxByWidth
  // already enforces the upper bound, so this is a no-op when maxByWidth is small.)
  const idealSquareish = Math.ceil(Math.sqrt(n * 1.4));
  return Math.max(1, Math.min(maxByWidth, Math.max(idealSquareish, 1)));
}

// Rows in the keyboard grid given n boards and columns.
function computeRows(n, cols) {
  return Math.ceil(n / cols);
}

// =====================================================
// DOM building
// =====================================================
function buildBoards() {
  const el = boardsEl();
  el.innerHTML = '';
  const cols = computeColumns(state.n);
  el.style.setProperty('--cols', cols);
  for (let b = 0; b < state.n; b++) {
    const board = document.createElement('div');
    board.className = 'board';
    board.style.setProperty('--rows', state.maxGuesses);
    board.dataset.idx = b;
    for (let r = 0; r < state.maxGuesses; r++) {
      const row = document.createElement('div');
      row.className = 'row';
      for (let c = 0; c < LENGTH; c++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        row.appendChild(tile);
      }
      board.appendChild(row);
    }
    el.appendChild(board);
  }
}

function buildKeyboard() {
  const kb = keyboardEl();
  kb.innerHTML = '';
  // Each entry: array of slots. A slot is either a string (key label / action)
  // or 'SPACER' for a half-width gap that keeps letters at uniform width.
  const rows = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['SPACER','a','s','d','f','g','h','j','k','l','SPACER'],
    ['ENTER','z','x','c','v','b','n','m','BACK'],
  ];
  const cols = computeColumns(state.n);
  for (const r of rows) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'kbd-row';
    for (const k of r) {
      if (k === 'SPACER') {
        const spacer = document.createElement('div');
        spacer.className = 'kbd-spacer';
        rowDiv.appendChild(spacer);
        continue;
      }
      const key = document.createElement('div');
      key.className = 'key unguessed';
      if (k === 'ENTER' || k === 'BACK') {
        key.classList.add('wide');
        const lbl = document.createElement('span');
        lbl.className = 'label';
        lbl.textContent = k === 'BACK' ? '⌫' : 'enter';
        key.appendChild(lbl);
        key.dataset.action = k;
      } else {
        // Build the per-board cells container
        const cells = document.createElement('div');
        cells.className = 'cells';
        cells.style.setProperty('--key-cols', cols);
        for (let i = 0; i < state.n; i++) {
          const cell = document.createElement('div');
          cell.className = 'cell';
          cell.dataset.boardIdx = i;
          cells.appendChild(cell);
        }
        key.appendChild(cells);
        const lbl = document.createElement('span');
        lbl.className = 'label';
        lbl.textContent = k;
        key.appendChild(lbl);
        key.dataset.letter = k;
      }
      key.addEventListener('click', () => handleKey(key.dataset.action || key.dataset.letter));
      rowDiv.appendChild(key);
    }
    kb.appendChild(rowDiv);
  }
}

// Update the keyboard grid columns when layout changes (e.g. window resize).
function relayoutKeyboard() {
  const cols = computeColumns(state.n);
  for (const cells of keyboardEl().querySelectorAll('.cells')) {
    cells.style.setProperty('--key-cols', cols);
  }
}

function relayoutBoards() {
  boardsEl().style.setProperty('--cols', computeColumns(state.n));
}

// =====================================================
// Header
// =====================================================
function updateHeader() {
  headerN().textContent = `· n=${state.n}`;
  const remaining = state.maxGuesses - state.guesses.length;
  const solved = state.solved.filter(x => x).length;
  headerInfo().innerHTML = `
    <span>Solved <b>${solved}/${state.n}</b></span>
    <span>Guesses <b>${remaining}</b></span>
  `;
}

// =====================================================
// Rendering
// =====================================================
function renderCurrent() {
  const r = state.guesses.length;
  for (let b = 0; b < state.n; b++) {
    if (state.solved[b]) continue;
    const board = boardsEl().children[b];
    const row = board.children[r];
    if (!row) continue;
    for (let c = 0; c < LENGTH; c++) {
      const tile = row.children[c];
      const ch = state.current[c] || '';
      tile.textContent = ch;
      tile.className = 'tile' + (ch ? ' filled' : '');
    }
  }
}

function applyPatternsToRow(rowIdx) {
  for (let b = 0; b < state.n; b++) {
    const board = boardsEl().children[b];
    const row = board.children[rowIdx];
    if (!row) continue;
    const pattern = state.patterns[b][rowIdx];
    if (!pattern) continue;
    const guess = state.guesses[rowIdx];
    if (pattern === 's') {
      for (let c = 0; c < LENGTH; c++) {
        const tile = row.children[c];
        tile.textContent = '';
        tile.className = 'tile solved';
      }
      continue;
    }
    for (let c = 0; c < LENGTH; c++) {
      const tile = row.children[c];
      tile.textContent = guess[c];
      const map = { g: 'green', y: 'yellow', x: 'gray' };
      const cls = map[pattern[c]];
      setTimeout(() => {
        tile.classList.add('flip');
        setTimeout(() => {
          tile.className = 'tile ' + cls;
        }, 275);
      }, c * 90);
    }
  }
  // Fade newly solved boards after the flip is done
  setTimeout(() => {
    for (let b = 0; b < state.n; b++) {
      if (state.solved[b]) {
        boardsEl().children[b].classList.add('solved');
      }
    }
  }, LENGTH * 90 + 350);
}

// =====================================================
// Keyboard cell colouring — one cell per board, mirroring the boards layout.
// Status priority for each (letter, board) pair:
//   solved-board > green > yellow > gray > none
// =====================================================
function updateKeyboard() {
  // Build per-letter, per-board status from pattern history.
  const status = {}; // status[letter][b] = 'g'|'y'|'x'|'solved'|undefined
  const rank = (s) => s === 'g' ? 4 : s === 'y' ? 3 : s === 'x' ? 2 : 0;

  for (let r = 0; r < state.guesses.length; r++) {
    const guess = state.guesses[r];
    for (let b = 0; b < state.n; b++) {
      const pat = state.patterns[b][r];
      if (pat === 's') continue;
      for (let c = 0; c < LENGTH; c++) {
        const ch = guess[c];
        const p = pat[c];
        if (!status[ch]) status[ch] = {};
        if (rank(p) > rank(status[ch][b])) {
          status[ch][b] = p;
        }
      }
    }
  }

  // Mark solved boards: every guessed letter on a solved board collapses to 'solved'
  // visual (a dim cell), so the user's attention is on remaining boards.
  // We still want to show what unsolved boards say. So: for each (letter, board),
  // if board is solved => render 'solved' cell, otherwise render its actual status.

  for (const key of keyboardEl().querySelectorAll('.key[data-letter]')) {
    const letter = key.dataset.letter;
    const letterStatus = status[letter];
    if (!letterStatus) {
      key.classList.add('unguessed');
      continue;
    }
    key.classList.remove('unguessed');
    const cells = key.querySelectorAll('.cell');
    for (let b = 0; b < state.n; b++) {
      const cell = cells[b];
      if (!cell) continue;
      cell.className = 'cell';
      if (state.solved[b]) {
        // Board is done — show subdued cell so it doesn't distract.
        cell.classList.add('solved');
        continue;
      }
      const s = letterStatus[b];
      if (s === 'g') cell.classList.add('green');
      else if (s === 'y') cell.classList.add('yellow');
      else if (s === 'x') cell.classList.add('gray');
      // else: leave transparent (letter not yet tried for this board)
    }
  }
}

// =====================================================
// Guess submission
// =====================================================
function shakeAllUnsolved() {
  for (let b = 0; b < state.n; b++) {
    if (state.solved[b]) continue;
    const board = boardsEl().children[b];
    board.classList.remove('shake');
    void board.offsetWidth;
    board.classList.add('shake');
  }
}

function submitGuess() {
  if (state.finished) return;
  if (state.current.length !== LENGTH) {
    showToast('Not enough letters', 'danger');
    shakeAllUnsolved();
    return;
  }
  if (!isValidGuess(state.current)) {
    showToast('Not in word list', 'danger');
    shakeAllUnsolved();
    return;
  }
  const guess = state.current;
  const rowIdx = state.guesses.length;
  state.guesses.push(guess);
  for (let b = 0; b < state.n; b++) {
    if (state.solved[b]) {
      state.patterns[b].push('s');
      continue;
    }
    const pat = scoreGuess(guess, state.words[b]);
    state.patterns[b].push(pat);
    if (pat === 'g'.repeat(LENGTH)) {
      state.solved[b] = true;
      state.scores[b] = String(rowIdx + 1);
    }
  }
  state.current = '';
  renderCurrent();
  applyPatternsToRow(rowIdx);
  setTimeout(() => {
    updateKeyboard();
    updateHeader();
    const allSolved = state.solved.every(Boolean);
    const noMore = state.guesses.length >= state.maxGuesses;
    if (allSolved || noMore) {
      state.finished = true;
      setTimeout(() => showEndscreen(allSolved), 400);
    }
  }, LENGTH * 90 + 320);
}

function handleKey(k) {
  if (!state || state.finished) return;
  if (k === 'ENTER') return submitGuess();
  if (k === 'BACK') {
    state.current = state.current.slice(0, -1);
    renderCurrent();
    return;
  }
  if (/^[a-z]$/.test(k) && state.current.length < LENGTH) {
    state.current += k;
    renderCurrent();
  }
}

document.addEventListener('keydown', (e) => {
  // Allow Enter inside the n-input to submit; otherwise let inputs handle their own keys.
  if (e.target.tagName === 'INPUT') {
    if (e.target.id === 'n-input' && e.key === 'Enter') {
      e.preventDefault();
      startGameFromInput();
    }
    return;
  }
  // If a modal is open, don't route keys into the game.
  if (!$('info-modal').classList.contains('hidden')) return;
  if (state && !state.finished && !gameEl().classList.contains('hidden')) {
    if (e.key === 'Enter') { e.preventDefault(); handleKey('ENTER'); return; }
    if (e.key === 'Backspace') { e.preventDefault(); handleKey('BACK'); return; }
    if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toLowerCase());
  } else if (!setupEl().classList.contains('hidden') && e.key === 'Enter') {
    startGameFromInput();
  } else if (!sharedPromptEl().classList.contains('hidden') && e.key === 'Enter') {
    acceptShared();
  }
});

// =====================================================
// Toast
// =====================================================
let toastTimer = null;
function showToast(msg, kind = '') {
  const t = toastEl();
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 1800);
}

// =====================================================
// End screen
// =====================================================
function showEndscreen(won) {
  gameEl().classList.add('hidden');
  keyboardEl().classList.add('hidden');
  const end = endEl();
  end.classList.remove('hidden');

  // Plain-text summary, mirroring the Python output format. The space before
  // \n means single-line paste (where newlines are stripped) still separates
  // the score from the URL with a space rather than jamming them.
  const scoreLine = `n-ordle n=${state.n} ` +
    state.scores.join('&') + `/${state.maxGuesses}`;
  const gameUrl = 'https://apps.andewmole.com/n-ordle';
  // "Result" copy: score + game URL (no puzzle-specific link).
  const resultText = `${scoreLine} \n${gameUrl}`;

  // Coloured HTML version of the score line for the copy-box display.
  const scoreLineHtml = `n-ordle n=${state.n} ` +
    state.scores.map(s => {
      const isWin = s !== 'X';
      return `<span class="${isWin ? 'g' : 'r'}">${s}</span>`;
    }).join('&') + `/${state.maxGuesses}`;

  const items = state.words.map((w, i) => {
    const isWin = state.solved[i];
    return `
      <div class="result-item ${isWin ? 'win' : 'lose'}">
        <div class="word">${w}</div>
        <div class="score">${isWin ? `${state.scores[i]}/${state.maxGuesses}` : 'unsolved'}</div>
      </div>`;
  }).join('');

  const shareUrl = buildShareUrl();
  // "Share" copy: score + share-link URL (recipient plays the same words).
  const shareText = `${scoreLine} \n${shareUrl}`;

  end.innerHTML = `
    <h2 class="${won ? 'win' : 'lose'}">${won ? 'Solved.' : 'So close.'}</h2>
    <div class="subtitle">${won
      ? `All ${state.n} word${state.n === 1 ? '' : 's'} found in ${state.guesses.length} guess${state.guesses.length === 1 ? '' : 'es'}.`
      : `${state.solved.filter(Boolean).length}/${state.n} solved in ${state.guesses.length} guesses.`}</div>
    <div class="results">${items}</div>

    <div class="share-block">
      <label>Copy your result</label>
      <div class="share-row">
        <div class="copy-field" id="result-text">${scoreLineHtml}<br>${escapeHtml(gameUrl)}</div>
        <button id="copy-result">Copy</button>
      </div>
    </div>

    <div class="actions">
      <button id="again-same">Play again (n=${state.n})</button>
      <button id="again-new">New n</button>
    </div>

    <div class="divider"></div>

    <div class="share-block">
      <label>Challenge a friend with these same words</label>
      <div class="share-row">
        <div class="copy-field" id="share-link">${scoreLineHtml}<br>${escapeHtml(shareUrl)}</div>
        <button id="copy-link">Copy</button>
      </div>
      <div class="share-help">The link encodes the puzzle, not the words. Your friend won't see the answers in the URL — they'll just play the same game.</div>
    </div>
  `;

  $('copy-result').addEventListener('click', async () => {
    const ok = await copyToClipboard(resultText);
    showToast(ok ? 'Result copied' : 'Copy failed', ok ? 'success' : 'danger');
  });
  $('copy-link').addEventListener('click', async () => {
    const ok = await copyToClipboard(shareText);
    showToast(ok ? 'Link copied' : 'Copy failed', ok ? 'success' : 'danger');
  });
  $('again-same').addEventListener('click', () => startNewGame(state.n));
  $('again-new').addEventListener('click', () => goToSetup());
}

// Escape a string for use as HTML text content.
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Escape a string for use as an HTML attribute value.
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for non-secure contexts (e.g. file://)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// =====================================================
// Share-link encoding
// =====================================================
// Format: <base url>#play=<base64(json({n, idx, v}))>
//   - n: number of boards
//   - idx: array of indices into COMBINED (ANSWERS + ALLOWED), one per target word
//   - v: format version
// We obfuscate the JSON bytes by XOR-ing with a fixed key before base64,
// so casually inspecting the URL doesn't reveal the words. (It's not secure
// against a determined inspector, but it keeps friends honest.)

const SHARE_XOR_KEY = [0x4e, 0x6f, 0x72, 0x64, 0x6c, 0x65, 0x21]; // "Nordle!"

function xorBytes(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ SHARE_XOR_KEY[i % SHARE_XOR_KEY.length];
  }
  return out;
}

function bytesToBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function buildShareUrl() {
  const idx = state.words.map(w => COMBINED.indexOf(w));
  // If somehow a word isn't found (shouldn't happen), drop the share link.
  if (idx.some(i => i < 0)) return location.href;
  const payload = JSON.stringify({ v: 1, n: state.n, idx });
  const bytes = new TextEncoder().encode(payload);
  const obf = xorBytes(bytes);
  const b64 = bytesToBase64Url(obf);
  const base = location.href.split('#')[0];
  return base + '#play=' + b64;
}

function tryDecodeShareFromHash() {
  const hash = location.hash || '';
  const m = hash.match(/[#&]play=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const obf = base64UrlToBytes(m[1]);
    const bytes = xorBytes(obf);
    const json = new TextDecoder().decode(bytes);
    const data = JSON.parse(json);
    if (data.v !== 1) return null;
    if (typeof data.n !== 'number') return null;
    if (!Array.isArray(data.idx)) return null;
    if (data.idx.length !== data.n) return null;
    if (!data.idx.every(i => Number.isInteger(i) && i >= 0 && i < COMBINED.length)) return null;
    return data;
  } catch {
    return null;
  }
}

// =====================================================
// Flow control
// =====================================================
// History API: we push a single 'in-app' history entry when leaving the home
// screen, so the browser back button returns to home instead of the previous
// page. While in the in-app entry, transitions between game and end screen
// don't push more entries — they replace, keeping the history shallow.

function isInAppEntry() {
  return !!(history.state && history.state.app === 'n-ordle');
}

function pushInAppState() {
  if (!isInAppEntry()) {
    history.pushState({ app: 'n-ordle' }, '', location.href);
  }
}

function hideAllSections() {
  setupEl().classList.add('hidden');
  sharedPromptEl().classList.add('hidden');
  loadingEl().classList.add('hidden');
  gameEl().classList.add('hidden');
  endEl().classList.add('hidden');
  keyboardEl().classList.add('hidden');
}

function goToSetup() {
  // If we're on the in-app history entry, navigate back so URL/history match
  // what the user sees. The popstate handler will display the home screen.
  if (isInAppEntry()) {
    state = null;
    history.back();
    return;
  }
  hideAllSections();
  setupEl().classList.remove('hidden');
  headerN().textContent = '';
  headerInfo().innerHTML = '';
  // Clear share hash if present so refreshing doesn't re-prompt
  if (location.hash.includes('play=')) {
    history.replaceState(history.state, '', location.pathname + location.search);
  }
}

function startNewGame(n, predefinedWords = null) {
  hideAllSections();
  newGame(n, predefinedWords);
  // Clear share hash from URL once the game starts so it doesn't loop on refresh
  if (location.hash.includes('play=') && !predefinedWords) {
    history.replaceState(history.state, '', location.pathname + location.search);
  }
  gameEl().classList.remove('hidden');
  keyboardEl().classList.remove('hidden');
  buildBoards();
  buildKeyboard();
  updateHeader();
  renderCurrent();
  // Add a history entry so the browser back button returns to the home screen.
  pushInAppState();
}

function startGameFromInput() {
  const n = parseInt($('n-input').value, 10);
  if (isNaN(n) || n < 1) {
    showToast('Enter a positive integer', 'danger');
    return;
  }
  if (n > COMBINED.length) {
    showToast(`Max is ${COMBINED.length}`, 'danger');
    return;
  }
  startNewGame(n);
}

function acceptShared() {
  if (!pendingShared) return;
  const words = pendingShared.idx.map(i => COMBINED[i]);
  startNewGame(pendingShared.n, words);
  pendingShared = null;
}

// Browser back/forward button: toggle between home and in-app views based on
// which history entry the browser landed on. We keep `state` alive so going
// forward restores the game in progress.
window.addEventListener('popstate', () => {
  if (isInAppEntry()) {
    // Forward navigation back into the in-app entry — restore whichever
    // in-app view applies.
    if (!state) {
      // No game to restore (e.g. opened tab directly at this entry). Show home.
      hideAllSections();
      setupEl().classList.remove('hidden');
      return;
    }
    hideAllSections();
    if (state.finished) {
      // End screen will already be in the DOM from the last render.
      endEl().classList.remove('hidden');
    } else {
      gameEl().classList.remove('hidden');
      keyboardEl().classList.remove('hidden');
    }
    return;
  }
  // We're on the home entry — show home. Keep `state` alive in case the user
  // hits forward to return to the game.
  pendingShared = null;
  hideAllSections();
  setupEl().classList.remove('hidden');
  headerN().textContent = '';
  headerInfo().innerHTML = '';
});

// =====================================================
// Initial wiring
// =====================================================
async function init() {
  // Wire setup buttons
  $('start-btn').addEventListener('click', startGameFromInput);
  document.querySelectorAll('.quick-picks button').forEach(b => {
    b.addEventListener('click', () => { $('n-input').value = b.dataset.n; });
  });
  $('shared-start-btn').addEventListener('click', acceptShared);
  $('shared-decline-btn').addEventListener('click', () => {
    pendingShared = null;
    history.replaceState(null, '', location.pathname + location.search);
    hideAllSections();
    setupEl().classList.remove('hidden');
  });
  $('title-link').addEventListener('click', () => {
    if (state && !state.finished) {
      if (!confirm('Quit current game and return to the home screen?')) return;
    }
    pendingShared = null;
    goToSetup();
  });

  // Info modal
  const infoModal = $('info-modal');
  const openInfo = () => infoModal.classList.remove('hidden');
  const closeInfo = () => infoModal.classList.add('hidden');
  $('info-btn').addEventListener('click', openInfo);
  $('info-close').addEventListener('click', closeInfo);
  // Close on backdrop click (but not when clicking inside the modal itself)
  infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) closeInfo();
  });
  // ESC closes the modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !infoModal.classList.contains('hidden')) {
      e.stopPropagation();
      closeInfo();
    }
  }, true);

  // Resize handler — relayout boards & keyboard so columns stay in sync.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!state) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      relayoutBoards();
      relayoutKeyboard();
    }, 80);
  });

  try {
    await loadWordLists();
  } catch (err) {
    loadingEl().innerHTML = `<div class="loading-inner" style="color: var(--danger)">
      Couldn't load word lists.<br>
      <span style="font-size: 13px; color: var(--fg-dim); font-family: 'JetBrains Mono', monospace; font-style: normal;">
        Make sure <code>answers.txt</code> and <code>guesses.txt</code> sit next to this HTML file,
        and that you're opening it via a local server (not <code>file://</code>) so the browser allows fetch.
      </span>
    </div>`;
    console.error(err);
    return;
  }

  // Check for share link in hash
  const shared = tryDecodeShareFromHash();
  hideAllSections();
  if (shared) {
    pendingShared = shared;
    $('shared-n').textContent = shared.n;
    $('shared-s').textContent = shared.n === 1 ? '' : 's';
    $('shared-guesses').textContent = shared.n + 5;
    sharedPromptEl().classList.remove('hidden');
  } else {
    setupEl().classList.remove('hidden');
  }
}

init();
