const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

const CPU_DELAY_MS = 550;
const REPLAY_STEP_MS = 650;
const SVG_NS = 'http://www.w3.org/2000/svg';

const state = {
  board: Array(9).fill(null),
  current: 'X',
  over: false,
  winLine: null,
  mode: 'cpu', // 'cpu' | 'pvp'
  score: { X: 0, O: 0, draw: 0 },
  startingPlayer: 'X',
  cpuTimer: null,
  moves: [], // casillas jugadas en orden (se guardan en la base de datos)
  startedAt: null,
};

// Repetición en curso: { snapshot, mode, timer } o null.
let replay = null;

const els = {
  board: document.getElementById('board'),
  overlay: document.getElementById('win-overlay'),
  status: document.getElementById('status'),
  scoreX: document.getElementById('score-x'),
  scoreO: document.getElementById('score-o'),
  scoreDraw: document.getElementById('score-draw'),
  cardX: document.getElementById('card-x'),
  cardO: document.getElementById('card-o'),
  nameX: document.getElementById('name-x'),
  nameO: document.getElementById('name-o'),
  newGame: document.getElementById('new-game'),
  resetScore: document.getElementById('reset-score'),
  modesWrap: document.getElementById('modes'),
  modes: document.querySelectorAll('.mode'),
  confetti: document.getElementById('confetti'),
  replayBar: document.getElementById('replay-bar'),
  replayInfo: document.getElementById('replay-info'),
  exitReplay: document.getElementById('exit-replay'),
};

let cells = [];
let renderedScore = { X: 0, O: 0, draw: 0 };

// --- Lógica pura -----------------------------------------------------------

function getWinLine(board) {
  return WIN_LINES.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]) || null;
}

function isFull(board) {
  return board.every(Boolean);
}

// Minimax: devuelve la puntuación del tablero desde el punto de vista de 'O' (la máquina).
function minimax(board, player, depth) {
  const line = getWinLine(board);
  if (line) return board[line[0]] === 'O' ? 10 - depth : depth - 10;
  if (isFull(board)) return 0;

  const scores = [];
  board.forEach((cell, i) => {
    if (cell) return;
    board[i] = player;
    scores.push(minimax(board, player === 'O' ? 'X' : 'O', depth + 1));
    board[i] = null;
  });
  return player === 'O' ? Math.max(...scores) : Math.min(...scores);
}

function bestMove(board) {
  let best = -Infinity;
  let moves = [];
  board.forEach((cell, i) => {
    if (cell) return;
    board[i] = 'O';
    const score = minimax(board, 'X', 1);
    board[i] = null;
    if (score > best) { best = score; moves = [i]; }
    else if (score === best) moves.push(i);
  });
  return moves[Math.floor(Math.random() * moves.length)];
}

// --- Flujo de juego --------------------------------------------------------

function play(index) {
  if (replay || state.over || state.board[index]) return;

  if (state.moves.length === 0) state.startedAt = Date.now();
  state.moves.push(index);
  state.board[index] = state.current;
  const line = getWinLine(state.board);

  if (line) {
    state.over = true;
    state.winLine = line;
    state.score[state.current] += 1;
  } else if (isFull(state.board)) {
    state.over = true;
    state.score.draw += 1;
  } else {
    state.current = state.current === 'X' ? 'O' : 'X';
  }

  render();

  if (state.winLine) {
    const winner = state.board[state.winLine[0]];
    // Confeti cuando gana una persona (siempre en 2 jugadores; solo X contra la máquina).
    if (state.mode === 'pvp' || winner === 'X') setTimeout(launchConfetti, 650);
  }

  if (state.over) saveFinishedGame();

  maybeCpuTurn();
}

// Guarda la partida terminada sin bloquear el juego; si falla, no pasa nada.
function saveFinishedGame() {
  if (!db.configured) return;
  db.saveGame({
    mode: state.mode,
    startingPlayer: state.startingPlayer,
    cells: state.moves.slice(),
    durationMs: Date.now() - state.startedAt,
  }).then((id) => {
    if (id) window.dispatchEvent(new CustomEvent('game-saved'));
  });
}

function maybeCpuTurn() {
  if (replay || state.mode !== 'cpu' || state.over || state.current !== 'O') return;
  state.cpuTimer = setTimeout(() => {
    state.cpuTimer = null;
    play(bestMove(state.board));
  }, CPU_DELAY_MS);
}

function newGame() {
  endReplay();
  clearTimeout(state.cpuTimer);
  state.cpuTimer = null;
  state.board = Array(9).fill(null);
  state.over = false;
  state.winLine = null;
  state.moves = [];
  state.startedAt = null;
  // Alterna quién empieza para que la partida sea justa.
  state.startingPlayer = state.startingPlayer === 'X' ? 'O' : 'X';
  state.current = state.startingPlayer;
  stopConfetti();
  replayBoardIntro();
  render();
  maybeCpuTurn();
}

function setMode(mode) {
  endReplay(); // antes de tocar el estado: restaura la partida y no pisa lo de abajo
  state.mode = mode;
  state.score = { X: 0, O: 0, draw: 0 };
  state.startingPlayer = 'O'; // newGame() lo alterna a 'X'
  newGame();
}

function resetScore() {
  endReplay();
  state.score = { X: 0, O: 0, draw: 0 };
  render();
}

// --- Repetición de partidas guardadas -------------------------------------

// moves: [{ cell, mark }] en orden; game: { mode, starting_player }.
// Reproduce la partida sobre el tablero y, al salir, restaura la partida en curso.
function startReplay(game, moves) {
  if (!moves || moves.length === 0) return;
  endReplay();
  clearTimeout(state.cpuTimer);
  state.cpuTimer = null;

  replay = {
    mode: game.mode,
    timer: null,
    snapshot: {
      ...state,
      board: [...state.board],
      moves: [...state.moves],
      score: { ...state.score },
      winLine: state.winLine ? [...state.winLine] : null,
    },
  };

  stopConfetti();
  state.board = Array(9).fill(null);
  state.over = false;
  state.winLine = null;
  state.current = game.starting_player;

  els.replayInfo.textContent = game.mode === 'cpu' ? 'Repetición · contra la máquina' : 'Repetición · 2 jugadores';
  els.replayBar.hidden = false;
  replayBoardIntro();
  render();

  let i = 0;
  const step = () => {
    const { cell, mark } = moves[i++];
    state.board[cell] = mark;
    const line = getWinLine(state.board);
    if (line) {
      state.over = true;
      state.winLine = line;
    } else if (isFull(state.board)) {
      state.over = true;
    } else {
      state.current = mark === 'X' ? 'O' : 'X';
    }
    render();
    if (i < moves.length) replay.timer = setTimeout(step, REPLAY_STEP_MS);
  };
  replay.timer = setTimeout(step, REPLAY_STEP_MS);
}

function endReplay() {
  if (!replay) return;
  clearTimeout(replay.timer);
  Object.assign(state, replay.snapshot);
  replay = null;
  els.replayBar.hidden = true;
  render();
  maybeCpuTurn();
}

// --- Render ----------------------------------------------------------------

function buildBoard() {
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.dataset.index = i;
    cell.dataset.mark = '';
    cell.setAttribute('role', 'gridcell');
    cell.addEventListener('click', () => {
      if (state.mode === 'cpu' && state.current === 'O') return;
      play(i);
    });
    els.board.appendChild(cell);
    cells.push(cell);
  }
}

function replayBoardIntro() {
  els.board.classList.remove('enter');
  void els.board.offsetWidth; // fuerza reflow para reiniciar la animación
  els.board.classList.add('enter');
}

function markSvg(value) {
  return value === 'X'
    ? '<svg class="mark mark-x" viewBox="0 0 100 100" aria-hidden="true">' +
        '<path d="M15 15L85 85" pathLength="1"/><path d="M85 15L15 85" pathLength="1"/></svg>'
    : '<svg class="mark mark-o" viewBox="0 0 100 100" aria-hidden="true">' +
        '<circle cx="50" cy="50" r="35" pathLength="1"/></svg>';
}

function statusInfo() {
  const mode = replay ? replay.mode : state.mode;
  if (state.winLine) {
    const winner = state.board[state.winLine[0]];
    const text = mode === 'cpu'
      ? (winner === 'X' ? '🎉 ¡Has ganado!' : 'Ha ganado la máquina')
      : `🎉 ¡Gana ${winner}!`;
    return { text, state: `win-${winner.toLowerCase()}` };
  }
  if (state.over) return { text: 'Empate', state: 'draw' };
  if (replay) return { text: `Jugada de ${state.current}`, state: state.current.toLowerCase() };
  if (state.mode === 'cpu') {
    return state.current === 'X'
      ? { text: 'Tu turno', state: 'x' }
      : { text: 'La máquina piensa…', state: 'thinking' };
  }
  return { text: `Turno de ${state.current}`, state: state.current.toLowerCase() };
}

function drawWinLine(animate) {
  els.overlay.replaceChildren();
  els.overlay.dataset.line = '';
  if (!state.winLine) return;

  const first = cells[state.winLine[0]];
  const last = cells[state.winLine[2]];
  const center = (el) => [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2];
  const [x1, y1] = center(first);
  const [x2, y2] = center(last);

  els.overlay.setAttribute('viewBox', `0 0 ${els.board.offsetWidth} ${els.board.offsetHeight}`);
  const winner = state.board[state.winLine[0]].toLowerCase();
  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('d', `M${x1} ${y1}L${x2} ${y2}`);
  line.setAttribute('pathLength', '1');
  line.setAttribute('class', `win-line${animate ? '' : ' static'}`);
  els.overlay.dataset.winner = winner;
  els.overlay.appendChild(line);
  els.overlay.dataset.line = state.winLine.join('');
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function render() {
  const humanTurn = !replay && !state.over && !(state.mode === 'cpu' && state.current === 'O');
  els.board.dataset.turn = humanTurn ? state.current : '';

  cells.forEach((cell, i) => {
    const value = state.board[i] || '';
    if (cell.dataset.mark !== value) {
      cell.dataset.mark = value;
      cell.innerHTML = value ? markSvg(value) : '';
    }
    const inWin = Boolean(state.winLine && state.winLine.includes(i));
    cell.classList.toggle('x', value === 'X');
    cell.classList.toggle('o', value === 'O');
    cell.classList.toggle('win', inWin);
    cell.classList.toggle('dim', Boolean(state.winLine) && !inWin);
    cell.disabled = state.over || Boolean(value);
    cell.setAttribute(
      'aria-label',
      `Fila ${Math.floor(i / 3) + 1}, columna ${(i % 3) + 1}: ${value || 'vacía'}`
    );
  });

  const lineKey = state.winLine ? state.winLine.join('') : '';
  if (els.overlay.dataset.line !== lineKey) drawWinLine(true);

  const info = statusInfo();
  els.status.textContent = info.text;
  els.status.dataset.state = info.state;

  els.scoreX.textContent = state.score.X;
  els.scoreO.textContent = state.score.O;
  els.scoreDraw.textContent = state.score.draw;
  if (renderedScore.X !== state.score.X) bump(els.scoreX);
  if (renderedScore.O !== state.score.O) bump(els.scoreO);
  if (renderedScore.draw !== state.score.draw) bump(els.scoreDraw);
  renderedScore = { ...state.score };

  els.cardX.classList.toggle('active', !state.over && state.current === 'X');
  els.cardO.classList.toggle('active', !state.over && state.current === 'O');
  els.nameX.textContent = state.mode === 'cpu' ? 'Tú' : 'Jugador X';
  els.nameO.textContent = state.mode === 'cpu' ? 'Máquina' : 'Jugador O';

  els.modesWrap.dataset.active = state.mode;
  els.modes.forEach((btn) => {
    const active = btn.dataset.mode === state.mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// --- Confeti ---------------------------------------------------------------

let confettiFrame = null;

function stopConfetti() {
  if (confettiFrame) cancelAnimationFrame(confettiFrame);
  confettiFrame = null;
  const ctx = els.confetti.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, els.confetti.width, els.confetti.height);
}

function launchConfetti() {
  if (replay || !state.over || !state.winLine) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  stopConfetti();

  const canvas = els.confetti;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const colors = ['#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#fb7185', '#fde68a', '#ffffff'];
  const rand = (min, max) => min + Math.random() * (max - min);
  const particles = Array.from({ length: 150 }, () => ({
    x: w / 2 + rand(-40, 40),
    y: h * 0.5,
    vx: rand(-9, 9),
    vy: rand(-17, -5),
    size: rand(6, 11),
    rot: rand(0, Math.PI * 2),
    vr: rand(-0.3, 0.3),
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const start = performance.now();
  const DURATION = 3200;

  function frame(now) {
    const elapsed = now - start;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, (DURATION - elapsed) / 800);

    for (const p of particles) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }

    if (elapsed < DURATION) {
      confettiFrame = requestAnimationFrame(frame);
    } else {
      stopConfetti();
    }
  }

  confettiFrame = requestAnimationFrame(frame);
}

// --- Eventos / arranque ----------------------------------------------------

els.newGame.addEventListener('click', newGame);
els.resetScore.addEventListener('click', resetScore);
els.exitReplay.addEventListener('click', endReplay);
els.modes.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
window.addEventListener('resize', () => { if (state.winLine) drawWinLine(false); });

buildBoard();
replayBoardIntro();
render();
