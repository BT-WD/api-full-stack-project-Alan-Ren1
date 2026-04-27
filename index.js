/* ═══════════════════════════════════════════════════
   Infinite Chess Puzzles — Lichess Puzzle API
   Endpoint: https://lichess.org/api/puzzle/next
   Returns: { puzzle: { id, rating, themes, solution (UCI) }, game: { pgn, ... } }
   ═══════════════════════════════════════════════════ */

const FILES = ['a','b','c','d','e','f','g','h'];
const GLYPHS = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟',
};

const STORAGE_KEY = 'infinite_puzzles_v2';

/* Fallbacks if network unavailable */
const FALLBACKS = [
  { id:'fb1', title:'Back-Rank Mate', rating:1200, themes:['backRankMate','mateIn1'],
    fen:'6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    solution:['d1d8'] },
  { id:'fb2', title:'Knight Fork', rating:1400, themes:['fork'],
    fen:'r2qkb1r/ppp2ppp/2n1bn2/3pp3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 7',
    solution:['f3e5'] },
  { id:'fb3', title:'Pin Tactic', rating:1300, themes:['pin'],
    fen:'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    solution:['f3g5'] },
];

let chess, puzzle, solution, solIdx, selectedSq, lastFrom, lastTo;
let boardFlipped, wrongThisPuzzle, moveHistory;
let puzzleDone = false;
let hintUsed   = false;

let stats = { completed:0, streak:0, attempts:0, correctFirst:0 };

/* ── Stats persistence ── */
function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    stats.completed    = s.completed    || 0;
    stats.streak       = s.streak       || 0;
    stats.attempts     = s.attempts     || 0;
    stats.correctFirst = s.correctFirst || 0;
  } catch(e) {}
}

function saveStats() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch(e) {}
}

function updateStatsDisplay() {
  document.getElementById('stat-completed').textContent = stats.completed;
  document.getElementById('stat-streak').textContent    = stats.streak;
  document.getElementById('stat-attempts').textContent  = stats.attempts;
  document.getElementById('stat-accuracy').textContent  =
    stats.attempts > 0 ? Math.round(stats.correctFirst / stats.attempts * 100) + '%' : '—';
}

/* ── UI helpers ── */
function setStatus(msg, type) {
  const el = document.getElementById('status-bar');
  el.textContent = msg;
  el.className = 'status-bar' + (type ? ' ' + type : '');
}

function updateTurnIndicator() {
  const c = chess.turn();
  document.getElementById('turn-dot').className = 'turn-dot ' + (c === 'w' ? 'white' : 'black');
  document.getElementById('turn-text').textContent = c === 'w' ? 'White to move' : 'Black to move';
}

function updateMoveHistory() {
  const el = document.getElementById('move-history');
  let html = '';
  for (let i = 0; i < moveHistory.length; i += 2) {
    const n = Math.floor(i / 2) + 1;
    const w = moveHistory[i]   ? `<span class="move-san">${moveHistory[i]}</span>`   : '';
    const b = moveHistory[i+1] ? `<span class="move-san">${moveHistory[i+1]}</span>` : '';
    html += `<span class="move-num">${n}.</span> ${w} ${b} `;
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

/* ── Lichess Puzzle API ──
   GET https://lichess.org/api/puzzle/next
   Returns JSON with puzzle.solution as UCI move array and game.pgn for position reconstruction. */
async function fetchLichessPuzzle() {
  const r = await fetch('https://lichess.org/api/puzzle/next', {
    headers: { 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

/* ── Board rendering ── */
function getPossibleDests() {
  if (!selectedSq || puzzleDone) return [];
  return chess.moves({ square: selectedSq, verbose: true }).map(m => m.to);
}

function findKing(color) {
  const board = chess.board();
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p && p.type === 'k' && p.color === color) return FILES[f] + (8 - r);
    }
  return null;
}

function renderBoard() {
  const el    = document.getElementById('chess-board');
  el.innerHTML = '';
  const pos   = chess.board();
  const dests = getPossibleDests();
  const king  = chess.in_check() ? findKing(chess.turn()) : null;

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = boardFlipped ? row     : 7 - row;
      const file = boardFlipped ? 7 - col : col;
      const sq   = FILES[file] + (rank + 1);
      const cell = pos[7 - rank][file];
      const isLight = (rank + file) % 2 === 0;

      const div = document.createElement('div');
      div.className = 'square ' + (isLight ? 'light' : 'dark');
      div.dataset.square = sq;

      if (sq === selectedSq)                div.classList.add('selected');
      if (sq === lastFrom || sq === lastTo) div.classList.add('last-from');
      if (sq === king)                      div.classList.add('in-check');
      if (dests.includes(sq))               div.classList.add('possible');
      if (dests.includes(sq) && cell)       div.classList.add('occupied');

      if (cell) {
        const span = document.createElement('span');
        span.className   = 'piece';
        span.textContent = GLYPHS[cell.color + cell.type.toUpperCase()] || '?';
        div.appendChild(span);
      }
      div.addEventListener('click', () => handleClick(sq));
      el.appendChild(div);
    }
  }
  renderCoords();
  if (!puzzleDone) updateTurnIndicator();
}

function renderCoords() {
  const filesArr = boardFlipped ? [...FILES].reverse() : FILES;
  const ranksArr = boardFlipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  ['coord-files-top','coord-files-bottom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = filesArr.map(f => `<div class="coord-file">${f}</div>`).join('');
  });
  ['coord-ranks-left','coord-ranks-right'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = ranksArr.map(r => `<div class="coord-rank">${r}</div>`).join('');
  });
}

/* ── Click handling ── */
function handleClick(sq) {
  if (puzzleDone || chess.game_over()) return;
  const piece = chess.get(sq);

  if (selectedSq) {
    if (sq === selectedSq) { selectedSq = null; renderBoard(); return; }
    const moves  = chess.moves({ square: selectedSq, verbose: true });
    const target = moves.find(m => m.to === sq);
    if (target) {
      if (target.flags.includes('p')) { showPromoDialog(selectedSq, sq); return; }
      doMove(selectedSq, sq);
      return;
    }
    if (piece && piece.color === chess.turn()) { selectedSq = sq; renderBoard(); return; }
    selectedSq = null; renderBoard(); return;
  }
  if (piece && piece.color === chess.turn()) { selectedSq = sq; renderBoard(); }
}

function doMove(from, to, promo) {
  promo = promo || 'q';
  const result = chess.move({ from, to, promotion: promo });
  if (!result) return;
  selectedSq = null;
  lastFrom   = from;
  lastTo     = to;
  moveHistory.push(result.san);
  updateMoveHistory();
  checkMove(result, from, to, promo);
  renderBoard();
}

/* ── Core puzzle checker — compares player UCI vs solution UCI ── */
function checkMove(result, from, to, promo) {
  if (!solution || solution.length === 0) {
    if      (chess.in_checkmate()) setStatus('Checkmate! ♟', 'correct');
    else if (chess.in_draw())      setStatus('Draw', '');
    else                           setStatus('Move played', '');
    return;
  }

  const expectedUci  = solution[solIdx];
  const expectedFrom = expectedUci.slice(0, 2);
  const expectedTo   = expectedUci.slice(2, 4);
  const expectedPromo = expectedUci.length === 5 ? expectedUci[4] : null;
  const correct = from === expectedFrom && to === expectedTo &&
    (!expectedPromo || expectedPromo === (promo || 'q'));

  if (correct) {
    solIdx++;
    if (solIdx >= solution.length) {
      // Puzzle solved!
      stats.attempts++;
      if (!wrongThisPuzzle && !hintUsed) { stats.correctFirst++; stats.streak++; }
      else stats.streak = 0;
      stats.completed++;
      puzzleDone = true;
      updateStatsDisplay(); saveStats();
      setStatus('Puzzle solved! 🎉', 'correct');
      document.getElementById('turn-dot').className = 'turn-dot white';
      document.getElementById('turn-text').textContent = 'Puzzle complete!';
    } else {
      setStatus('Correct! Keep going →', 'correct');
      setTimeout(playOpponentMove, 700);
    }
  } else {
    // Wrong move
    wrongThisPuzzle = true;
    stats.attempts++;
    stats.streak = 0;
    chess.undo();
    lastFrom = null; lastTo = null;
    moveHistory.pop();
    updateMoveHistory();
    updateStatsDisplay(); saveStats();
    setStatus('Not the best move — try again', 'wrong');
    renderBoard();
    setTimeout(() => { if (!puzzleDone) setStatus('Find the best move!', 'info'); }, 1800);
  }
}

function playOpponentMove() {
  if (solIdx >= solution.length || chess.game_over() || puzzleDone) return;
  const uci = solution[solIdx];
  const result = chess.move({
    from: uci.slice(0, 2), to: uci.slice(2, 4),
    promotion: uci.length === 5 ? uci[4] : 'q'
  });
  if (!result) return;
  solIdx++;
  lastFrom = result.from; lastTo = result.to;
  moveHistory.push(result.san);
  updateMoveHistory();
  renderBoard();
  if (solIdx >= solution.length) {
    puzzleDone = true;
    stats.completed++;
    if (!wrongThisPuzzle && !hintUsed) { stats.correctFirst++; stats.streak++; }
    else stats.streak = 0;
    updateStatsDisplay(); saveStats();
    setStatus('Puzzle solved! 🎉', 'correct');
  } else {
    setStatus('Your turn', 'info');
  }
}

/* ── Hint: highlight the from-square of the expected move ── */
function giveHint() {
  if (puzzleDone || !solution || solution.length === 0) return;
  hintUsed = true;
  wrongThisPuzzle = true; // hint counts as imperfect
  const uci = solution[solIdx];
  selectedSq = uci.slice(0, 2);
  renderBoard();
  setStatus('Hint: move the highlighted piece', 'info');
}

/* ── Promotion dialog ── */
function showPromoDialog(from, to) {
  const color  = chess.turn();
  const pieces = ['Q','R','B','N'].map(t => ({ v: t.toLowerCase(), g: GLYPHS[color + t] }));
  const overlay = document.createElement('div');
  overlay.className = 'promo-overlay';
  overlay.innerHTML = `
    <div class="promo-dialog">
      <h3>Promote pawn</h3>
      <div class="promo-choices">
        ${pieces.map(p => `<button class="promo-btn" data-v="${p.v}">${p.g}</button>`).join('')}
      </div>
    </div>`;
  overlay.querySelectorAll('.promo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      selectedSq = null;
      doMove(from, to, btn.dataset.v);
    });
  });
  document.body.appendChild(overlay);
}

/* ── Undo ── */
function undoMove() {
  if (puzzleDone) return;
  if (!chess.undo()) return;
  moveHistory.pop();
  if (solIdx > 0) solIdx--;
  selectedSq = null; lastFrom = null; lastTo = null;
  updateMoveHistory(); renderBoard();
  setStatus('Move undone — try again', 'info');
}

/* ── Load next puzzle from Lichess ── */
async function loadNextPuzzle() {
  selectedSq = null; lastFrom = null; lastTo = null;
  wrongThisPuzzle = false; hintUsed = false;
  puzzleDone = false; moveHistory = []; solIdx = 0;

  document.getElementById('move-history').innerHTML = '';
  document.getElementById('puzzle-themes').innerHTML = '<span style="color:var(--text-muted);font-size:11px">—</span>';
  document.getElementById('puzzle-rating').innerHTML = '';
  document.getElementById('lichess-card').style.display = 'none';
  document.getElementById('btn-next').disabled = true;
  document.getElementById('btn-undo').disabled = true;
  document.getElementById('btn-hint').disabled = true;

  setStatus('Fetching puzzle…', '');
  document.getElementById('chess-board').innerHTML =
    '<div class="board-loading"><div class="spinner"></div><span>Loading puzzle…</span></div>';

  let fen, sol, puzzleId, rating, themes;

  try {
    const data = await fetchLichessPuzzle();
    /*
      Lichess API response shape:
      {
        puzzle: { id, rating, themes, solution: string[] (UCI), initialPly: number },
        game:   { pgn: string, ... }
      }
      We replay the game PGN to initialPly to get the puzzle starting position.
    */
    puzzleId = data.puzzle.id;
    rating   = data.puzzle.rating;
    themes   = data.puzzle.themes || [];
    sol      = data.puzzle.solution; // UCI array

    // Build FEN by replaying game PGN to initialPly
    const initialPly = data.puzzle.initialPly;
    const temp = new Chess();
    temp.load_pgn(data.game.pgn);
    const history = temp.history({ verbose: true });
    temp.reset();
    for (let i = 0; i <= initialPly && i < history.length; i++) {
      temp.move(history[i]);
    }
    fen = temp.fen();

  } catch(e) {
    console.warn('Lichess API error, using fallback:', e);
    const fb = FALLBACKS[stats.completed % FALLBACKS.length];
    puzzleId = fb.id; rating = fb.rating; themes = fb.themes;
    fen = fb.fen; sol = fb.solution;
  }

  chess        = new Chess(fen);
  solution     = sol;
  boardFlipped = chess.turn() === 'b';

  document.getElementById('puzzle-number').textContent = 'Puzzle #' + (stats.completed + 1);
  document.getElementById('puzzle-title').textContent  = 'Find the best move';

  // Rating pill
  if (rating) {
    document.getElementById('puzzle-rating').innerHTML =
      `<span class="rating-pill">★ ${rating}</span>`;
  }

  // Theme tags (max 4, prettified)
  if (themes.length) {
    const pretty = t => t.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    document.getElementById('puzzle-themes').innerHTML =
      themes.slice(0, 4).map(t => `<span class="theme-tag">${pretty(t)}</span>`).join('');
  }

  // Lichess link
  if (puzzleId && !puzzleId.startsWith('fb')) {
    const card = document.getElementById('lichess-card');
    const link = document.getElementById('lichess-link');
    link.href = `https://lichess.org/training/${puzzleId}`;
    card.style.display = '';
  }

  document.getElementById('btn-next').disabled = false;
  document.getElementById('btn-undo').disabled = false;
  document.getElementById('btn-hint').disabled = false;

  renderBoard();
  setStatus('Find the best move!', 'info');
}

/* ── Init ── */
function init() {
  loadStats();
  updateStatsDisplay();
  document.getElementById('btn-undo').addEventListener('click', undoMove);
  document.getElementById('btn-hint').addEventListener('click', giveHint);
  document.getElementById('btn-next').addEventListener('click', loadNextPuzzle);
  loadNextPuzzle();
}

document.addEventListener('DOMContentLoaded', init);