
const FILES = ['a','b','c','d','e','f','g','h'];

const GLYPHS = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟',
};

const PROXY = 'https://api.allorigins.win/get?url=';
const API_URL = 'https://api.chess.com/pub/puzzle/random';
const STORAGE_KEY = 'infinite_puzzles_stats';

/*
  The chess.com puzzle API returns a PGN of the FULL game that led to the
  puzzle position, not just the solution moves. The FEN field is the puzzle
  start position. To get the solution we replay the full PGN in a temp Chess
  instance, then replay FROM the puzzle FEN and record every move that was
  played after that point — those are the solution moves the user must find.
*/

const FALLBACKS = [
  { title:'Back-Rank Mate', fen:'6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',   pgn:'1. Rd8#',           solution:['Rd8#'] },
  { title:'Knight Fork',    fen:'r2qkb1r/ppp2ppp/2n1bn2/3pp3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 7', pgn:'', solution:['Nxe5'] },
  { title:'Pin Tactic',     fen:'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', pgn:'', solution:['Ng5'] },
];

let chess, puzzle, solution, solIdx, selectedSq, lastFrom, lastTo;
let boardFlipped, hintUsed, wrongThisPuzzle, moveHistory;

let stats = { completed:0, streak:0, attempts:0, correctFirst:0 };

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

async function fetchPuzzle() {
  try {
    const res  = await fetch(PROXY + encodeURIComponent(API_URL));
    const data = await res.json();
    return JSON.parse(data.contents);
  } catch(e) {
    return null;
  }
}

/*
  The chess.com PGN includes the full game history. We need only the moves
  played AFTER the puzzle FEN. Strategy:
  1. Strip PGN headers (lines starting with [)
  2. Strip annotations, comments, result tokens
  3. Collect all SAN tokens
  4. Replay them on a fresh default board
  5. Once the board FEN matches the puzzle FEN, every subsequent token is a solution move
*/
function extractSolutionFromPGN(pgn, puzzleFen) {
  if (!pgn) return [];

  const stripped = pgn
    .replace(/\[.*?\]\s*/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\$\d+/g, '')
    .replace(/1-0|0-1|1\/2-1\/2|\*/g, '')
    .trim();

  const tokens = stripped
    .replace(/\d+\.\.\./g, '')
    .replace(/\d+\./g, '')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);

  const puzzleBoard = new Chess(puzzleFen);
  const puzzleFenNormalized = normalizeFen(puzzleFen);

  const temp = new Chess();
  let foundStart = false;
  const solutionMoves = [];

  for (const token of tokens) {
    if (foundStart) {
      const result = temp.move(token);
      if (result) solutionMoves.push(result.san);
      else break;
    } else {
      const fenNow = normalizeFen(temp.fen());
      if (fenNow === puzzleFenNormalized) {
        foundStart = true;
        const result = temp.move(token);
        if (result) solutionMoves.push(result.san);
      } else {
        const result = temp.move(token);
        if (!result) break;
        if (normalizeFen(temp.fen()) === puzzleFenNormalized) {
          foundStart = true;
        }
      }
    }
  }

  return solutionMoves;
}

function normalizeFen(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

function getPossibleDests() {
  if (!selectedSq) return [];
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
  updateTurnIndicator();
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

function handleClick(sq) {
  if (chess.game_over()) return;
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
  checkMove(result);
  renderBoard();
}

function checkMove(result) {
  if (solution.length === 0) {
    if      (chess.in_checkmate()) setStatus('Checkmate! ♟', 'correct');
    else if (chess.in_draw())      setStatus('Draw', '');
    else                           setStatus('Move played', '');
    return;
  }

  const expected = solution[solIdx];
  const correct  = result.san === expected;

  if (correct) {
    solIdx++;
    stats.attempts++;

    if (solIdx >= solution.length) {
      if (!wrongThisPuzzle && !hintUsed) { stats.correctFirst++; stats.streak++; }
      else stats.streak = 0;
      stats.completed++;
      updateStatsDisplay();
      saveStats();
      setStatus('Puzzle solved! 🎉', 'correct');
      document.getElementById('turn-dot').className = 'turn-dot white';
      document.getElementById('turn-text').textContent = 'Puzzle complete!';
    } else {
      setStatus('Correct! Keep going →', 'correct');
      setTimeout(playOpponentMove, 700);
    }
  } else {
    wrongThisPuzzle = true;
    stats.attempts++;
    stats.streak = 0;
    chess.undo();
    lastFrom = null; lastTo = null;
    moveHistory.pop();
    updateMoveHistory();
    renderBoard();
    updateStatsDisplay();
    saveStats();
    setStatus('Not the best move — try again', 'wrong');
    setTimeout(() => setStatus('Find the best move!', 'info'), 1800);
  }
}

function playOpponentMove() {
  if (solIdx >= solution.length || chess.game_over()) return;
  const result = chess.move(solution[solIdx]);
  if (result) {
    solIdx++;
    lastFrom = result.from; lastTo = result.to;
    moveHistory.push(result.san);
    updateMoveHistory();
    renderBoard();
    setStatus('Your turn', 'info');
  }
}

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

function showHint() {
  if (!solution.length || solIdx >= solution.length) {
    setStatus('No hint available', '');
    return;
  }
  hintUsed = true;

  const nextSAN = solution[solIdx];
  const temp    = new Chess(chess.fen());
  const result  = temp.move(nextSAN);
  if (result) {
    selectedSq = result.from;
    renderBoard();
    setStatus('Hint: move the highlighted piece', 'info');
  }
}

function undoMove() {
  if (!chess.undo()) return;
  moveHistory.pop();
  if (solIdx > 0) solIdx--;
  selectedSq = null; lastFrom = null; lastTo = null;
  updateMoveHistory();
  renderBoard();
  setStatus('Move undone', '');
}

async function loadNextPuzzle() {
  selectedSq = null; lastFrom = null; lastTo = null;
  hintUsed = false; wrongThisPuzzle = false;
  moveHistory = []; solIdx = 0;

  document.getElementById('move-history').innerHTML = '';
  setStatus('Fetching puzzle…', '');
  document.getElementById('chess-board').innerHTML =
    '<div class="board-loading">Loading…</div>';

  const raw = await fetchPuzzle();

  if (raw && raw.fen && raw.pgn) {
    puzzle   = raw;
    solution = extractSolutionFromPGN(raw.pgn, raw.fen);
  } else if (raw && raw.solution) {
    puzzle   = raw;
    solution = raw.solution;
  } else {
    const fb = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
    puzzle   = fb;
    solution = fb.solution;
  }

  chess        = new Chess(puzzle.fen);
  boardFlipped = chess.turn() === 'b';

  document.getElementById('puzzle-number').textContent = 'Puzzle #' + (stats.completed + 1);
  document.getElementById('puzzle-title').textContent  = puzzle.title || 'Untitled';
  document.getElementById('puzzle-id').textContent     =
    puzzle.publish_time ? new Date(puzzle.publish_time * 1000).toLocaleDateString() : '—';

  renderBoard();
  setStatus(solution.length ? 'Find the best move!' : 'Explore this position', 'info');
}

function init() {
  loadStats();
  updateStatsDisplay();
  document.getElementById('btn-hint').addEventListener('click', showHint);
  document.getElementById('btn-undo').addEventListener('click', undoMove);
  document.getElementById('btn-next').addEventListener('click', loadNextPuzzle);
  loadNextPuzzle();
}

document.addEventListener('DOMContentLoaded', init);
