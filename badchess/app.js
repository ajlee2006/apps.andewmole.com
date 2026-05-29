/* ----- Descriptions ----- */
const BOT_DESCS = {
  best:     "Plays the move Stockfish considers best at the chosen depth.",
  worst:    "Plays the move Stockfish considers worst.",
  random:   "Picks any legal move uniformly at random.",
  nocheck:  "Avoids giving check whenever possible.",
  priority: "Prioritises moves in this order: en passant, mate, check, promotion, capture, castle, non-stalemate.",
};

let game = new Chess();
let board = null;
let thinking = false;
let stopRequested = false;
let paused = false;
let botLoopGen = 0;
let selectedSquare = null;

/* ----- Analysis state ----- */
function getAnalysisDepth() {
  const el = document.getElementById("analysisDepthSel");
  return el ? (parseInt(el.value, 10) || 12) : 12;
}

let evalsByFen = new Map();
let liveAnalysisEnabled = true;
let liveAnalysisRunning = false;
let liveAnalysisGen = 0;
let evalsAtDepth = null;

let reviewMode = false;
let reviewPly = 0;
let savedFenBeforeReview = null;

/* ----- Stockfish engines ----- */
class Engine {
  constructor(label) {
    this.label = label;
    this.worker = null;
    this.ready = false;
    this.pendingResolver = null;
    this.pendingScore = null;
    this.pendingDepth = 0;
    this.queue = Promise.resolve();
    this._reqCounter = 0;
    this.activeReq = null;
    this.needsStop = false;
  }

  async init(workerUrl) {
    try {
      this.worker = new Worker(workerUrl);
    } catch (e) {
      console.error(`[${this.label}] Worker construction failed:`, e);
      throw e;
    }
    this.worker.onmessage = (e) => {
      const line = typeof e.data === "string" ? e.data : "";
      if (window.DEBUG_ENGINE) console.log(`[${this.label}] <- ${line}`);
      if (line === "uciok") {
        this.worker.postMessage("isready");
      } else if (line === "readyok") {
        if (!this.ready) {
          this.ready = true;
          onEngineReady(this);
        }
      } else if (line.startsWith("info ")) {
        if (this.activeReq === null) return;
        if (line.includes("lowerbound") || line.includes("upperbound")) return;
        const depthMatch = line.match(/\bdepth (\d+)/);
        const lineDepth = depthMatch ? parseInt(depthMatch[1], 10) : 0;
        if (lineDepth < this.pendingDepth) return;
        const mateMatch = line.match(/score mate (-?\d+)/);
        const cpMatch = line.match(/score cp (-?\d+)/);
        if (mateMatch) {
          const m = parseInt(mateMatch[1], 10);
          this.pendingScore = m > 0 ? 100000 - m : -100000 - m;
          this.pendingDepth = lineDepth;
        } else if (cpMatch) {
          this.pendingScore = parseInt(cpMatch[1], 10);
          this.pendingDepth = lineDepth;
        }
      } else if (line.startsWith("bestmove")) {
        if (this.activeReq !== null && this.pendingResolver) {
          this.pendingResolver(this.pendingScore !== null ? this.pendingScore : 0);
        }
      }
    };
    this.worker.onerror = (err) => {
      console.error(`[${this.label}] worker error:`, err);
    };
    this.worker.postMessage("uci");
  }

  evaluate(fen, depth) {
    const task = this.queue.then(() => new Promise((resolve) => {
      if (!this.ready) { resolve(0); return; }
      const reqId = ++this._reqCounter;
      this.activeReq = reqId;
      this.pendingScore = null;
      this.pendingDepth = 0;
      let settled = false;
      const finish = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeReq = null;
        this.pendingResolver = null;
        resolve(val);
      };
      this.pendingResolver = (val) => finish(val);
      const timeoutMs = Math.max(8000, depth * 5000);
      const timer = setTimeout(() => {
        console.warn(`[${this.label}] evaluate() timed out for fen=${fen} depth=${depth}`);
        this.needsStop = true;
        finish(this.pendingScore !== null ? this.pendingScore : 0);
      }, timeoutMs);
      if (this.needsStop) {
        if (window.DEBUG_ENGINE) console.log(`[${this.label}] -> stop`);
        this.worker.postMessage("stop");
        this.needsStop = false;
      }
      this.worker.postMessage("ucinewgame");
      if (window.DEBUG_ENGINE) console.log(`[${this.label}] -> position fen ${fen}; go depth ${depth}`);
      this.worker.postMessage("position fen " + fen);
      this.worker.postMessage("go depth " + depth);
    }));
    this.queue = task.catch(() => {});
    return task;
  }
}

const botEngine = new Engine("bot");
const analysisEngine = new Engine("analysis");

function onEngineReady(engine) {
  const note = document.getElementById("engineStatus");
  const states = [];
  if (botEngine.ready) states.push("bot engine ready");
  if (analysisEngine.ready) states.push("analysis engine ready");
  if (botEngine.ready && analysisEngine.ready) {
    note.textContent = "Both engines ready";
    note.className = "engine-status ready";
  } else {
    note.textContent = states.join(", ") + "…";
    note.className = "engine-status";
  }
  if (engine === analysisEngine || (engine === botEngine && !analysisEngine.worker)) {
    scheduleLiveAnalysis();
  }
}

async function initEngines() {
  const note = document.getElementById("engineStatus");
  note.textContent = "Downloading engine…";
  note.className = "engine-status";

  const sources = [
    "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js",
    "https://cdn.jsdelivr.net/gh/nmrugg/stockfish.js@v10.0.2/example/stockfish.js",
  ];

  let workerUrl = null, lastErr = null;
  for (const src of sources) {
    try {
      const resp = await fetch(src);
      if (!resp.ok) { lastErr = "HTTP " + resp.status + " from " + src; continue; }
      const code = await resp.text();
      const blob = new Blob([code], { type: "application/javascript" });
      workerUrl = URL.createObjectURL(blob);
      break;
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }

  if (!workerUrl) {
    console.error("Stockfish load failed:", lastErr);
    note.textContent = "Engine unavailable (Random/Prioritiser still work)";
    note.className = "engine-status error";
    return;
  }

  note.textContent = "Initialising engines…";
  const results = await Promise.allSettled([
    botEngine.init(workerUrl),
    analysisEngine.init(workerUrl),
  ]);
  results.forEach((r, i) => {
    const name = i === 0 ? "bot" : "analysis";
    if (r.status === "rejected") {
      console.error(`${name} engine failed to start:`, r.reason);
    }
  });
  if (!botEngine.worker && !analysisEngine.worker) {
    note.textContent = "Engine unavailable";
    note.className = "engine-status error";
  }
}

function evaluateForBot(fen, depth) {
  if (botEngine.ready) return botEngine.evaluate(fen, depth);
  if (analysisEngine.ready) return analysisEngine.evaluate(fen, depth);
  return Promise.resolve(0);
}
function evaluateForAnalysis(fen, depth) {
  if (analysisEngine.ready) return analysisEngine.evaluate(fen, depth);
  if (botEngine.ready) return botEngine.evaluate(fen, depth);
  return Promise.resolve(0);
}

async function evaluateWhitePOV(fen, depth) {
  const score = await evaluateForBot(fen, depth);
  const stm = fen.split(" ")[1];
  return stm === "w" ? score : -score;
}

function evaluate(fen, depth) { return evaluateForBot(fen, depth); }

Object.defineProperty(window, "stockfishReady", {
  get: () => botEngine.ready || analysisEngine.ready,
});

/* ===== Game analysis (live) ===== */
function buildAnalysisData() {
  const verbose = game.history({ verbose: true });
  if (verbose.length === 0) return null;
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const m of verbose) {
    replay.move(m);
    fens.push(replay.fen());
  }
  const evals = fens.map(f => evalsByFen.has(f) ? evalsByFen.get(f) : null);
  const classifications = new Array(fens.length).fill("");
  for (let i = 1; i < fens.length; i++) {
    if (evals[i] == null || evals[i - 1] == null) continue;
    const moverIsWhite = (i % 2 === 1);
    const before = moverIsWhite ? evals[i - 1] : -evals[i - 1];
    const after  = moverIsWhite ? evals[i]     : -evals[i];
    const drop = before - after;
    if      (drop >= 300) classifications[i] = "blunder";
    else if (drop >= 150) classifications[i] = "mistake";
    else if (drop >= 100) classifications[i] = "inaccuracy";
  }
  const complete = evals.every(e => e != null);
  return { evals, classifications, fens, complete };
}

function scheduleLiveAnalysis() {
  if (!liveAnalysisEnabled || !stockfishReady) {
    refreshAnalysisUI();
    return;
  }
  liveAnalysisGen++;
  refreshAnalysisUI();
  if (liveAnalysisRunning) return;
  liveAnalysisRunning = true;
  backgroundAnalyze().finally(() => { liveAnalysisRunning = false; });
}

async function backgroundAnalyze() {
  while (true) {
    const myGen = liveAnalysisGen;
    const verbose = game.history({ verbose: true });
    if (verbose.length === 0) return;

    const replay = new Chess();
    const fens = [replay.fen()];
    for (const m of verbose) {
      replay.move(m);
      fens.push(replay.fen());
    }
    let nextIdx = -1;
    for (let i = 0; i < fens.length; i++) {
      if (!evalsByFen.has(fens[i])) { nextIdx = i; break; }
    }
    if (nextIdx === -1) {
      refreshAnalysisUI();
      await new Promise(r => setTimeout(r, 200));
      if (liveAnalysisGen === myGen) return;
      continue;
    }

    if (!analysisEngine.ready && thinking) {
      await new Promise(r => setTimeout(r, 250));
      continue;
    }

    const targetFen = fens[nextIdx];
    const targetDepth = getAnalysisDepth();
    evalsAtDepth = targetDepth;
    const cp = await evaluateForAnalysis(targetFen, targetDepth);

    const stm = targetFen.split(" ")[1];
    evalsByFen.set(targetFen, stm === "w" ? cp : -cp);

    refreshAnalysisUI();
    await new Promise(r => setTimeout(r, 0));
  }
}

function refreshAnalysisUI() {
  const progress = document.getElementById("analysisProgress");
  const graphWrap = document.getElementById("evalGraph");
  const reviewCtrls = document.getElementById("reviewControls");

  if (!liveAnalysisEnabled) {
    progress.textContent = "Live analysis is off.";
    graphWrap.style.display = "none";
    reviewCtrls.style.display = "none";
    renderPgn();
    return;
  }

  const data = buildAnalysisData();
  if (!data) {
    progress.textContent = stockfishReady
      ? "Live analysis will start once a move is played."
      : "Waiting for engine to load…";
    graphWrap.style.display = "none";
    reviewCtrls.style.display = "none";
    renderPgn();
    return;
  }

  const totalPositions = data.fens.length;
  const analyzed = data.evals.filter(e => e != null).length;
  const depthNow = getAnalysisDepth();
  if (analyzed < totalPositions) {
    progress.textContent = `Analyzing… ${analyzed} / ${totalPositions} positions evaluated (depth ${depthNow}).`;
  } else {
    progress.textContent = `All ${totalPositions} positions evaluated at depth ${depthNow}. Click any move to review.`;
  }

  if (analyzed >= 2) {
    graphWrap.style.display = "";
    drawEvalGraph(data.evals);
    if (!graphWrap.dataset.clickWired) {
      graphWrap.addEventListener("click", (e) => {
        const cur = buildAnalysisData();
        if (!cur) return;
        const rect = graphWrap.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const ply = Math.round(frac * (cur.fens.length - 1));
        if (!reviewMode) enterReviewMode(ply); else jumpToPly(ply);
      });
      graphWrap.style.cursor = "pointer";
      graphWrap.dataset.clickWired = "1";
    }
  } else {
    graphWrap.style.display = "none";
  }

  reviewCtrls.style.display = reviewMode ? "" : "none";
  renderPgn();
}

function drawEvalGraph(evals) {
  const CLAMP = 1000;
  const svg = document.getElementById("evalSvg");
  const n = evals.length;
  if (n < 2) { svg.innerHTML = ""; return; }
  const toX = (i) => (i / (n - 1)) * 100;
  const toY = (cp) => {
    const v = Math.max(-CLAMP, Math.min(CLAMP, cp));
    return 40 - (v / CLAMP) * 40;
  };
  const pts = [];
  for (let i = 0; i < n; i++) {
    if (evals[i] != null) pts.push({ idx: i, x: toX(i), y: toY(evals[i]) });
  }
  if (pts.length < 2) { svg.innerHTML = ""; return; }
  let linePath = "M " + pts[0].x + " " + pts[0].y;
  for (let i = 1; i < pts.length; i++) linePath += " L " + pts[i].x + " " + pts[i].y;
  let areaPath = linePath + ` L ${pts[pts.length - 1].x} 80 L ${pts[0].x} 80 Z`;

  let marker = "";
  const dot = document.getElementById("evalMarkerDot");
  if (reviewMode && reviewPly >= 0 && reviewPly < n) {
    const mx = toX(reviewPly);
    marker += `<line x1="${mx}" y1="0" x2="${mx}" y2="80" stroke="#e8c060" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`;
    if (evals[reviewPly] != null) {
      dot.style.left = (mx) + "%";
      dot.style.top = ((toY(evals[reviewPly]) / 80) * 100) + "%";
      dot.style.display = "";
    } else {
      dot.style.display = "none";
    }
  } else if (dot) {
    dot.style.display = "none";
  }

  svg.innerHTML = `
    <path d="${areaPath}" fill="rgba(106,163,214,0.18)" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="#6ba3d6" stroke-width="0.8" vector-effect="non-scaling-stroke"/>
    ${marker}
  `;
}

/* ----- Review mode ----- */
function enterReviewMode(ply) {
  reviewMode = true;
  reviewPly = ply;
  jumpToPly(ply);
}

function jumpToPly(ply) {
  const data = buildAnalysisData();
  if (!data) return;
  reviewPly = Math.max(0, Math.min(data.fens.length - 1, ply));
  const replay = new Chess();
  const history = game.history({ verbose: true });
  for (let i = 0; i < reviewPly; i++) replay.move(history[i]);
  board.position(replay.fen());
  document.getElementById("reviewControls").style.display = "";
  drawEvalGraph(data.evals);
  renderPgn();
  updateReviewNavButtons();
}

function updateReviewNavButtons() {
  const data = buildAnalysisData();
  if (!data) return;
  document.getElementById("rvStart").disabled = (reviewPly === 0);
  document.getElementById("rvPrev").disabled  = (reviewPly === 0);
  document.getElementById("rvNext").disabled  = (reviewPly === data.fens.length - 1);
  document.getElementById("rvEnd").disabled   = (reviewPly === data.fens.length - 1);
}

function exitReviewMode() {
  reviewMode = false;
  board.position(game.fen());
  document.getElementById("reviewControls").style.display = "none";
  const data = buildAnalysisData();
  if (data) drawEvalGraph(data.evals);
  renderPgn();
  updateStatus();
  updatePlayButton();
  setTimeout(runBotsIfNeeded, 100);
}

let replayRunning = false;
let replayCancelled = false;

async function playReplay() {
  if (replayRunning) { replayCancelled = true; return; }
  const total = game.history().length;
  if (total === 0) return;
  replayRunning = true;
  replayCancelled = false;
  enterReviewMode(0);
  const btn = document.getElementById("replayBtn");
  btn.style.display = "";
  btn.textContent = "Stop replay";
  for (let p = 1; p <= total; p++) {
    if (replayCancelled) break;
    await new Promise(r => setTimeout(r, 700));
    if (replayCancelled) break;
    jumpToPly(p);
  }
  replayRunning = false;
  replayCancelled = false;
  btn.textContent = "Replay";
  updateStatus();
}

/* ----- The bots ----- */
async function botWorst(depth) {
  if (!stockfishReady) {
    const moves = game.moves({ verbose: true });
    if (moves.length === 0) return null;
    console.warn("Worst bot: engine not ready, falling back to random.");
    return moves[Math.floor(Math.random() * moves.length)];
  }
  const sandbox = new Chess(game.fen());
  const moves = sandbox.moves({ verbose: true });
  if (moves.length === 0) return null;
  const weAreWhite = (sandbox.turn() === "w");
  let chosen = moves[0];
  let chosenScoreForUs = Infinity;
  botProgress(0, moves.length);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    sandbox.move(m);
    let ourScore;
    if (sandbox.in_stalemate() || sandbox.in_draw()) {
      ourScore = 50000;
    } else {
      const whitePov = await evaluateWhitePOV(sandbox.fen(), depth);
      ourScore = weAreWhite ? whitePov : -whitePov;
    }
    sandbox.undo();
    if (ourScore < chosenScoreForUs) { chosenScoreForUs = ourScore; chosen = m; }
    botProgress(i + 1, moves.length);
    if (chosenScoreForUs <= -90000) break;
  }
  return chosen;
}

async function botBest(depth) {
  if (!stockfishReady) {
    const moves = game.moves({ verbose: true });
    if (moves.length === 0) return null;
    console.warn("Best bot: engine not ready, falling back to random.");
    return moves[Math.floor(Math.random() * moves.length)];
  }
  const sandbox = new Chess(game.fen());
  const moves = sandbox.moves({ verbose: true });
  if (moves.length === 0) return null;
  for (const m of moves) {
    sandbox.move(m);
    const isMate = sandbox.in_checkmate();
    sandbox.undo();
    if (isMate) return m;
  }
  const weAreWhite = (sandbox.turn() === "w");
  let chosen = moves[0];
  let chosenScoreForUs = -Infinity;
  botProgress(0, moves.length);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    sandbox.move(m);
    const whitePov = await evaluateWhitePOV(sandbox.fen(), depth);
    sandbox.undo();
    const ourScore = weAreWhite ? whitePov : -whitePov;
    if (ourScore > chosenScoreForUs) { chosenScoreForUs = ourScore; chosen = m; }
    botProgress(i + 1, moves.length);
    if (chosenScoreForUs >= 90000) break;
  }
  return chosen;
}

function botRandom() {
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

async function botNoCheck(depth) {
  const sandbox = new Chess(game.fen());
  const moves = sandbox.moves({ verbose: true });
  if (moves.length === 0) return null;

  const nonChecking = moves.filter(m => {
    sandbox.move(m);
    const c = sandbox.in_check();
    sandbox.undo();
    return !c;
  });

  if (nonChecking.length === 0) {
    return moves[Math.floor(Math.random() * moves.length)];
  }
  if (!stockfishReady) {
    console.warn("No-check bot: engine not ready, picking random non-checking move.");
    return nonChecking[Math.floor(Math.random() * nonChecking.length)];
  }

  const weAreWhite = (sandbox.turn() === "w");
  let chosen = nonChecking[0];
  let chosenScoreForUs = Infinity;
  botProgress(0, nonChecking.length);
  for (let i = 0; i < nonChecking.length; i++) {
    const m = nonChecking[i];
    sandbox.move(m);
    const whitePov = await evaluateWhitePOV(sandbox.fen(), depth);
    sandbox.undo();
    const ourScore = weAreWhite ? whitePov : -whitePov;
    if (ourScore < chosenScoreForUs) { chosenScoreForUs = ourScore; chosen = m; }
    botProgress(i + 1, nonChecking.length);
  }
  return chosen;
}

function botPriority() {
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;

  const nonStale = moves.filter(m => {
    game.move(m);
    const s = game.in_stalemate();
    game.undo();
    return !s;
  });

  const pool = nonStale.length > 0 ? nonStale : moves;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let move = pick(pool);

  const castles = pool.filter(m => m.flags.includes("k") || m.flags.includes("q"));
  if (castles.length) move = pick(castles);

  const captures = pool.filter(m => m.flags.includes("c") || m.flags.includes("e"));
  if (captures.length) move = pick(captures);

  const promos = pool.filter(m => m.promotion === "q");
  if (promos.length) move = pick(promos);

  const checks = pool.filter(m => {
    game.move(m);
    const c = game.in_check();
    game.undo();
    return c;
  });
  if (checks.length) move = pick(checks);

  const mates = pool.filter(m => {
    game.move(m);
    const c = game.in_checkmate();
    game.undo();
    return c;
  });
  if (mates.length) move = pick(mates);

  const eps = pool.filter(m => m.flags.includes("e"));
  if (eps.length) move = pick(eps);

  return move;
}

async function botMove(botKind) {
  const side = game.turn() === "w" ? "white" : "black";
  const depthEl = document.getElementById(side === "white" ? "whiteDepthSel" : "blackDepthSel");
  const depth = parseInt(depthEl.value, 10) || 3;
  switch (botKind) {
    case "best":     return await botBest(depth);
    case "worst":    return await botWorst(depth);
    case "random":   return botRandom();
    case "nocheck":  return await botNoCheck(depth);
    case "priority": return botPriority();
  }
  return null;
}

/* ----- Player roles ----- */
function whitePlayer() { return document.getElementById("whiteSel").value; }
function blackPlayer() { return document.getElementById("blackSel").value; }
function currentPlayer() {
  return game.turn() === "w" ? whitePlayer() : blackPlayer();
}
function bothBots() {
  return whitePlayer() !== "human" && blackPlayer() !== "human";
}

/* ----- Game loop ----- */
function botProgress(done, total) {
  if (!thinking) return;
  setStatus(`Bot is thinking… (${done}/${total})`, "thinking");
}

async function runBotsIfNeeded() {
  if (paused) { updatePlayButton(); return; }
  const myGen = botLoopGen;
  const stillActive = () => botLoopGen === myGen;
  try {
    while (!game.game_over() && currentPlayer() !== "human" && !stopRequested && !paused) {
      if (!stillActive()) return;
      thinking = true;
      updatePlayButton();
      setStatus("Bot is thinking…", "thinking");
      await new Promise(r => setTimeout(r, 30));
      if (!stillActive()) return;

      const move = await botMove(currentPlayer());
      if (!stillActive()) return;
      if (stopRequested || paused) break;
      if (!move) break;

      game.move(move);
      board.position(game.fen());
      renderPgn();
      updateStatus();
      scheduleLiveAnalysis();

      if (bothBots() && !game.game_over()) {
        await new Promise(r => setTimeout(r, 400));
        if (!stillActive()) return;
      }
    }
  } finally {
    if (stillActive()) {
      thinking = false;
      stopRequested = false;
      updateStatus();
      updatePlayButton();
    }
  }
}

/* ----- Click-to-move + drag highlights ----- */
function clearHighlights() {
  document.querySelectorAll(".square-55d63").forEach(sq => {
    sq.classList.remove("highlight-selected", "highlight-legal", "highlight-capture");
  });
}

function showLegalMoves(square) {
  const moves = game.moves({ square: square, verbose: true });
  if (moves.length === 0) return;
  const sqEl = document.querySelector('.square-' + square);
  if (sqEl) sqEl.classList.add("highlight-selected");
  for (const m of moves) {
    const target = document.querySelector('.square-' + m.to);
    if (!target) continue;
    target.classList.add("highlight-legal");
    if (m.flags.includes("c") || m.flags.includes("e")) {
      target.classList.add("highlight-capture");
    }
  }
}

function pieceBelongsToTurn(piece) {
  if (!piece) return false;
  return (game.turn() === "w" && piece[0] === "w") ||
         (game.turn() === "b" && piece[0] === "b");
}

function onDragStart(source, piece) {
  if (thinking) return false;
  if (reviewMode) return false;
  if (game.game_over()) return false;
  if (currentPlayer() !== "human") return false;
  if (!pieceBelongsToTurn(piece)) return false;
  clearHighlights();
  showLegalMoves(source);
}

function onDrop(source, target) {
  clearHighlights();
  const move = game.move({ from: source, to: target, promotion: "q" });
  if (move === null) return "snapback";
  selectedSquare = null;
  updateStatus();
  renderPgn();
  scheduleLiveAnalysis();
  setTimeout(runBotsIfNeeded, 60);
}

function onSnapEnd() {
  board.position(game.fen());
  if (selectedSquare) showLegalMoves(selectedSquare);
}

function installHighlightWatcher() {
  const boardEl = document.getElementById("board");
  if (!boardEl) return;
  const obs = new MutationObserver(() => {
    if (selectedSquare) {
      const sqEl = document.querySelector('.square-' + selectedSquare);
      if (sqEl && !sqEl.classList.contains("highlight-selected")) {
        showLegalMoves(selectedSquare);
      }
    }
  });
  obs.observe(boardEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
}

function squareAtPoint(x, y) {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    if (el.classList && el.classList.contains("square-55d63")) {
      const sq = el.getAttribute("data-square");
      if (sq) return sq;
    }
  }
  return null;
}

let tapStart = null;

function onBoardPointerDown(e) {
  if (thinking || game.game_over() || reviewMode) { tapStart = null; return; }
  if (currentPlayer() !== "human") { tapStart = null; return; }
  const pt = e.touches ? e.touches[0] : e;
  const square = squareAtPoint(pt.clientX, pt.clientY);
  if (!square) { tapStart = null; return; }
  tapStart = { x: pt.clientX, y: pt.clientY, square, t: Date.now() };
}

function onBoardPointerUp(e) {
  if (!tapStart) return;
  const pt = (e.changedTouches && e.changedTouches[0]) || e;
  const dx = pt.clientX - tapStart.x;
  const dy = pt.clientY - tapStart.y;
  const moved = Math.hypot(dx, dy);
  const elapsed = Date.now() - tapStart.t;
  const startSquare = tapStart.square;
  tapStart = null;
  if (moved > 6) return;
  if (elapsed > 600) return;
  if (thinking || game.game_over() || reviewMode) return;
  if (currentPlayer() !== "human") return;
  handleTap(startSquare);
}

function handleTap(square) {
  const piece = game.get(square);

  if (selectedSquare) {
    const legalTargets = game.moves({ square: selectedSquare, verbose: true });
    const match = legalTargets.find(m => m.to === square);
    if (match) {
      game.move({ from: selectedSquare, to: square, promotion: "q" });
      selectedSquare = null;
      clearHighlights();
      board.position(game.fen());
      updateStatus();
      renderPgn();
      scheduleLiveAnalysis();
      setTimeout(runBotsIfNeeded, 60);
      return;
    }
    selectedSquare = null;
    clearHighlights();
    if (piece && ((game.turn() === "w" && piece.color === "w") ||
                  (game.turn() === "b" && piece.color === "b"))) {
      selectedSquare = square;
      showLegalMoves(square);
    }
    return;
  }

  if (piece && ((game.turn() === "w" && piece.color === "w") ||
                (game.turn() === "b" && piece.color === "b"))) {
    selectedSquare = square;
    clearHighlights();
    showLegalMoves(square);
  }
}

/* ----- UI helpers ----- */
function setStatus(text, cls = "") {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = cls;
}

function updateStatus() {
  const color = game.turn() === "w" ? "White" : "Black";
  if (game.in_checkmate()) {
    setStatus("Game over, " + color + " is in checkmate.", "gameover");
  } else if (game.in_stalemate()) {
    setStatus("Game over, stalemate.", "gameover");
  } else if (game.in_draw()) {
    setStatus("Game over, drawn position.", "gameover");
  } else if (game.in_check()) {
    setStatus(color + " to move, " + color + " is in check");
  } else {
    setStatus(color + " to move");
  }
  const replayBtn = document.getElementById("replayBtn");
  if (replayBtn) {
    replayBtn.style.display = (game.game_over() && game.history().length > 0 && !replayRunning) ? "" : "none";
  }
}

function renderPgn() {
  const tbody = document.querySelector("#pgn tbody");
  const history = game.history();
  const data = buildAnalysisData();
  let html = "";
  for (let i = 0; i < history.length; i += 2) {
    const num = Math.floor(i / 2) + 1;
    const wPly = i, bPly = i + 1;
    const w = history[i] || "";
    const b = history[i + 1] || "";
    const wTag = annotationTag(data, wPly + 1);
    const bTag = annotationTag(data, bPly + 1);
    const wActive = (reviewMode && reviewPly === wPly + 1) ? "active" : "";
    const bActive = (reviewMode && reviewPly === bPly + 1) ? "active" : "";
    html += `<tr class="move-row">`;
    html += `<td>${num}</td>`;
    html += `<td class="${wActive}" data-ply="${wPly + 1}">${w}${wTag}</td>`;
    html += `<td class="${bActive}" data-ply="${b ? bPly + 1 : ""}">${b}${bTag}</td>`;
    html += `</tr>`;
  }
  tbody.innerHTML = html;
  const wrap = document.querySelector(".move-table-wrap");
  if (!reviewMode) wrap.scrollTop = wrap.scrollHeight;
}

function annotationTag(data, plyIdx) {
  if (!data || !data.classifications) return "";
  const cls = data.classifications[plyIdx];
  if (!cls) return "";
  if (cls === "blunder")    return ` <span class="move-tag blunder">??</span>`;
  if (cls === "mistake")    return ` <span class="move-tag mistake">?</span>`;
  if (cls === "inaccuracy") return ` <span class="move-tag inaccuracy">?!</span>`;
  return "";
}

function updateBotDesc() {
  const w = whitePlayer(), b = blackPlayer();
  const parts = [];
  if (w !== "human") parts.push("White: " + BOT_DESCS[w]);
  if (b !== "human") parts.push("Black: " + BOT_DESCS[b]);
  document.getElementById("bot-desc").textContent = parts.join("  ·  ");
  const engineBots = ["best", "worst", "nocheck"];
  document.getElementById("whiteDepthSel").style.display = engineBots.includes(w) ? "" : "none";
  document.getElementById("blackDepthSel").style.display = engineBots.includes(b) ? "" : "none";
}

function updatePlayButton() {
  const btn = document.getElementById("playBtn");
  const botToMove = !game.game_over() && currentPlayer() !== "human";
  if (!botToMove) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  if (thinking) {
    btn.textContent = "Pause";
    btn.classList.remove("danger");
  } else if (paused) {
    btn.textContent = game.history().length === 0 ? "Start" : "Resume";
    btn.classList.remove("danger");
  } else {
    btn.textContent = "Pause";
  }
}

function newGame() {
  botLoopGen++;
  thinking = false;
  stopRequested = false;
  evalsByFen.clear();
  liveAnalysisGen++;
  reviewMode = false;
  reviewPly = 0;
  savedFenBeforeReview = null;
  game.reset();
  board.start();
  selectedSquare = null;
  clearHighlights();
  if (window.location.search) {
    history.replaceState(null, "", window.location.pathname);
  }
  paused = bothBots();
  updateStatus();
  refreshAnalysisUI();
  updatePlayButton();
  setTimeout(runBotsIfNeeded, 100);
}

function takeBack() {
  if (thinking) return;
  if (reviewMode) exitReviewMode();
  let undid = 0;
  while (game.history().length > 0) {
    game.undo();
    undid++;
    if (currentPlayer() === "human") break;
    if (undid >= 2) break;
  }
  selectedSquare = null;
  clearHighlights();
  board.position(game.fen());
  updateStatus();
  updatePlayButton();
  liveAnalysisGen++;
  refreshAnalysisUI();
}

/* ===== Share / load state via URL ===== */
function buildShareUrl() {
  const params = new URLSearchParams();
  params.set("w",  whitePlayer());
  params.set("b",  blackPlayer());
  params.set("wd", document.getElementById("whiteDepthSel").value);
  params.set("bd", document.getElementById("blackDepthSel").value);
  params.set("ad", document.getElementById("analysisDepthSel").value);
  const history = game.history({ verbose: true });
  if (history.length > 0) {
    const uci = history.map(m => m.from + m.to + (m.promotion || "")).join(",");
    params.set("m", uci);
  }
  const base = window.location.origin + window.location.pathname;
  return base + "?" + params.toString();
}

async function shareGame() {
  const url = buildShareUrl();
  const toast = document.getElementById("shareToast");
  let copied = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch (e) {}
  }
  if (copied) {
    toast.className = "share-toast";
    toast.innerHTML = `<span>✓ Link copied to clipboard</span>`;
    toast.style.display = "";
    setTimeout(() => { toast.style.display = "none"; }, 3500);
  } else {
    toast.className = "share-toast";
    toast.innerHTML = `<span>Copy link:</span><input type="text" readonly>`;
    const input = toast.querySelector("input");
    input.value = url;
    toast.style.display = "";
    input.focus();
    input.select();
  }
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (![...params.keys()].length) return false;

  const validPlayers = new Set(["human", "best", "worst", "random", "nocheck", "priority"]);
  const w = params.get("w");
  const b = params.get("b");
  if (w && validPlayers.has(w)) document.getElementById("whiteSel").value = w;
  if (b && validPlayers.has(b)) document.getElementById("blackSel").value = b;

  const setDepthIfValid = (selId, val) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 1 || n > 20) return;
    const sel = document.getElementById(selId);
    sel.value = String(n);
  };
  setDepthIfValid("whiteDepthSel", params.get("wd"));
  setDepthIfValid("blackDepthSel", params.get("bd"));
  setDepthIfValid("analysisDepthSel", params.get("ad"));

  const movesStr = params.get("m") || "";
  if (movesStr) {
    const moves = movesStr.split(",");
    for (const u of moves) {
      if (!u || u.length < 4) continue;
      const move = { from: u.slice(0, 2), to: u.slice(2, 4) };
      if (u.length >= 5) move.promotion = u[4];
      const result = game.move(move);
      if (result === null) {
        console.warn("Shared link contained an illegal move; halting replay at this point:", u);
        break;
      }
    }
  }
  return true;
}

/* ----- Boot ----- */
window.addEventListener("DOMContentLoaded", () => {
  board = Chessboard("board", {
    draggable: true,
    position: "start",
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
  });

  const boardEl = document.getElementById("board");
  document.addEventListener("mousedown", (e) => {
    if (boardEl.contains(e.target)) onBoardPointerDown(e);
  }, true);
  document.addEventListener("touchstart", (e) => {
    if (boardEl.contains(e.target)) onBoardPointerDown(e);
  }, { capture: true, passive: true });
  document.addEventListener("mouseup", onBoardPointerUp, true);
  document.addEventListener("touchend", onBoardPointerUp, true);

  const DEPTHS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
  function populateDepthSel(id, defaultDepth) {
    const sel = document.getElementById(id);
    sel.innerHTML = DEPTHS.map(d =>
      `<option value="${d}"${d === defaultDepth ? " selected" : ""}>Depth ${d}</option>`
    ).join("");
  }
  populateDepthSel("whiteDepthSel", 3);
  populateDepthSel("blackDepthSel", 3);
  populateDepthSel("analysisDepthSel", 12);

  document.getElementById("analysisDepthSel").addEventListener("change", () => {
    evalsByFen.clear();
    liveAnalysisGen++;
    refreshAnalysisUI();
    if (liveAnalysisEnabled) scheduleLiveAnalysis();
  });

  document.getElementById("whiteSel").addEventListener("change", () => {
    updateBotDesc();
    if (bothBots()) { paused = true; } else { paused = false; }
    updatePlayButton();
    if (!thinking && !paused) setTimeout(runBotsIfNeeded, 50);
  });
  document.getElementById("blackSel").addEventListener("change", () => {
    updateBotDesc();
    if (bothBots()) { paused = true; } else { paused = false; }
    updatePlayButton();
    if (!thinking && !paused) setTimeout(runBotsIfNeeded, 50);
  });

  document.getElementById("resetBtn").addEventListener("click", newGame);
  document.getElementById("backBtn").addEventListener("click", takeBack);
  document.getElementById("playBtn").addEventListener("click", () => {
    if (thinking) {
      paused = true;
      stopRequested = true;
      botLoopGen++;
      thinking = false;
      updateStatus();
      updatePlayButton();
    } else {
      paused = false;
      stopRequested = false;
      updatePlayButton();
      setTimeout(runBotsIfNeeded, 30);
    }
  });
  document.getElementById("liveAnalysisToggle").addEventListener("change", (e) => {
    liveAnalysisEnabled = e.target.checked;
    if (liveAnalysisEnabled) {
      scheduleLiveAnalysis();
    } else {
      liveAnalysisGen++;
      refreshAnalysisUI();
    }
  });

  document.getElementById("rvStart").addEventListener("click", () => jumpToPly(0));
  document.getElementById("rvPrev").addEventListener("click",  () => jumpToPly(reviewPly - 1));
  document.getElementById("rvNext").addEventListener("click",  () => jumpToPly(reviewPly + 1));
  document.getElementById("rvEnd").addEventListener("click",   () => {
    const data = buildAnalysisData();
    jumpToPly(data ? data.fens.length - 1 : 0);
  });
  document.getElementById("rvResume").addEventListener("click", exitReviewMode);

  document.querySelector("#pgn").addEventListener("click", (e) => {
    if (!buildAnalysisData()) return;
    const td = e.target.closest("td[data-ply]");
    if (!td) return;
    const ply = parseInt(td.getAttribute("data-ply"), 10);
    if (Number.isFinite(ply)) {
      if (!reviewMode) enterReviewMode(ply); else jumpToPly(ply);
    }
  });

  document.getElementById("shareBtn").addEventListener("click", shareGame);
  document.getElementById("replayBtn").addEventListener("click", playReplay);

  const loadedFromUrl = loadStateFromUrl();
  if (loadedFromUrl) {
    board.position(game.fen());
    renderPgn();
  }

  updateBotDesc();
  updateStatus();
  paused = bothBots() || loadedFromUrl;
  updatePlayButton();
  initEngines();
  installHighlightWatcher();

  window.addEventListener("resize", () => board.resize());
  setTimeout(runBotsIfNeeded, 100);
});
