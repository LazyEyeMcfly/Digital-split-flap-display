'use strict';

// ============================================================
//  Config
// ============================================================
const CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#-.:&\'/()';
const NUM_ROWS  = 15;
const HALF_MS   = 50;  // ms per half-flip; full flip = 2 × HALF_MS
const STEP_GAP  = 0;   // ms between queued steps in a cycle (0 = back-to-back)

const FIELDS = [
  { key: 'id',        len: 4  },
  { key: 'type',      len: 5  },
  { key: 'title',     len: 26 },
  { key: 'status',    len: 11 },
  { key: 'requester', len: 13 },
];

// ============================================================
//  Audio — synthesised mechanical click
// ============================================================
let audioCtx   = null;
let lastSoundT = 0;

function initAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
  }
  // Chrome starts contexts suspended until a user gesture — resume immediately
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playFlap() {
  // Only play when context is fully running (avoids the silent-then-burst lag)
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  if (t - lastSoundT < 0.03) return;  // throttle: max ~33 clicks/sec
  lastSoundT = t;

  const dur = 0.042;
  const sr  = audioCtx.sampleRate;
  const len = Math.floor(sr * dur);
  const buf = audioCtx.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
  }

  const src  = audioCtx.createBufferSource();
  src.buffer = buf;

  const bpf = audioCtx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.setValueAtTime(1150, t);
  bpf.Q.setValueAtTime(0.65, t);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(2.2, t);
  gain.gain.exponentialRampToValueAtTime(0.01, t + dur);

  src.connect(bpf);
  bpf.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(t);
}

// ============================================================
//  Cell state + queues
// ============================================================
const cells  = [];
const queues = [];

const displayed = Array.from({ length: NUM_ROWS }, () =>
  Object.fromEntries(FIELDS.map(f => [f.key, ' '.repeat(f.len)]))
);

// Last real data received — used to restore after chaos
let lastRows = [];

// ============================================================
//  Text helpers
// ============================================================
function sanitize(s) {
  return String(s || '')
    .toUpperCase()
    .split('')
    .map(c => (CHARS.includes(c) ? c : ' '))
    .join('');
}

function padTo(s, len) {
  return sanitize(s).slice(0, len).padEnd(len, ' ');
}

function formatRequest(req) {
  const id     = padTo('#' + req.id, 4);
  const type   = padTo(req.type === 'TV' ? 'TV' : 'MOVIE', 5);
  let   title  = String(req.title || '').toUpperCase();
  if (req.type === 'TV' && req.season) title += ' S' + req.season;
  const status = padTo((req.status || '').replace(/_/g, ' '), 11);
  const req_   = padTo(req.requester || 'UNKNOWN', 13);
  return { id, type, title: padTo(title, 26), status, requester: req_ };
}

// ============================================================
//  DOM — build the board
// ============================================================
function buildBoard() {
  const container = document.getElementById('board-rows');

  for (let r = 0; r < NUM_ROWS; r++) {
    cells[r]  = {};
    queues[r] = {};

    const rowEl = document.createElement('div');
    rowEl.className = 'board-row';

    let first = true;
    for (const field of FIELDS) {
      if (!first) {
        const sep = document.createElement('div');
        sep.className = 'field-sep';
        rowEl.appendChild(sep);
      }
      first = false;

      cells[r][field.key]  = [];
      queues[r][field.key] = [];

      const fieldEl = document.createElement('div');
      fieldEl.className = `field field-${field.key}`;

      for (let p = 0; p < field.len; p++) {
        const cellEl = document.createElement('div');
        cellEl.className = 'flap-cell';

        const top   = document.createElement('div');  top.className   = 'cell-top';
        const topCh = document.createElement('span'); topCh.className = 'ch';
        topCh.textContent = ' ';
        top.appendChild(topCh);

        const bot   = document.createElement('div');  bot.className   = 'cell-bot';
        const botCh = document.createElement('span'); botCh.className = 'ch';
        botCh.textContent = ' ';
        bot.appendChild(botCh);

        cellEl.appendChild(top);
        cellEl.appendChild(bot);
        fieldEl.appendChild(cellEl);

        cells[r][field.key][p]  = { topEl: top, topChEl: topCh, botChEl: botCh, current: ' ', busy: false };
        queues[r][field.key][p] = [];
      }

      rowEl.appendChild(fieldEl);
    }

    container.appendChild(rowEl);
  }
}

// ============================================================
//  Flip animation for one cell
// ============================================================
function flipOne(cell, toChar, done) {
  cell.busy = true;
  playFlap();

  const { topEl, topChEl, botChEl } = cell;

  topEl.style.transition = `transform ${HALF_MS}ms ease-in`;
  topEl.style.transform  = 'rotateX(-90deg)';

  setTimeout(() => {
    botChEl.textContent    = toChar;
    topChEl.textContent    = toChar;
    topEl.style.transition = 'none';
    topEl.style.transform  = 'rotateX(90deg)';

    void topEl.offsetHeight;

    topEl.style.transition = `transform ${HALF_MS}ms ease-out`;
    topEl.style.transform  = 'rotateX(0deg)';

    setTimeout(() => {
      cell.current = toChar;
      cell.busy    = false;
      done();
    }, HALF_MS);
  }, HALF_MS);
}

// ============================================================
//  Queue drain
// ============================================================
function drain(r, fKey, p) {
  const cell  = cells[r][fKey][p];
  const queue = queues[r][fKey][p];
  if (cell.busy || queue.length === 0) return;

  const next = queue.shift();
  flipOne(cell, next, () => {
    if (queue.length > 0) {
      if (STEP_GAP > 0) setTimeout(() => drain(r, fKey, p), STEP_GAP);
      else drain(r, fKey, p);
    }
  });
}

// ============================================================
//  Character cycle path (shortest direction)
// ============================================================
function charIdx(c) {
  const i = CHARS.indexOf(c);
  return i === -1 ? 0 : i;
}

function buildPath(from, to) {
  const fi = charIdx(from);
  const ti = charIdx(to);
  if (fi === ti) return [];

  const n       = CHARS.length;
  const fwdDist = ((ti - fi) + n) % n;
  const bwdDist = n - fwdDist;

  const path = [];
  if (fwdDist <= bwdDist) {
    let i = (fi + 1) % n;
    while (i !== ti) { path.push(CHARS[i]); i = (i + 1) % n; }
  } else {
    let i = (fi - 1 + n) % n;
    while (i !== ti) { path.push(CHARS[i]); i = (i - 1 + n) % n; }
  }
  path.push(CHARS[ti]);
  return path;
}

function scheduleCell(r, fKey, p, targetChar) {
  const cell  = cells[r][fKey][p];
  const queue = queues[r][fKey][p];

  const effCurrent = queue.length > 0 ? queue[queue.length - 1] : cell.current;
  if (effCurrent === targetChar) return;

  const path = buildPath(effCurrent, targetChar);
  for (const ch of path) queue.push(ch);
  drain(r, fKey, p);
}

// ============================================================
//  Board update
// ============================================================
function updateBoard(rows) {
  for (let r = 0; r < NUM_ROWS; r++) {
    const formatted = rows[r] ? formatRequest(rows[r]) : null;

    for (const field of FIELDS) {
      const targetStr  = formatted ? formatted[field.key] : ' '.repeat(field.len);
      const currentStr = displayed[r][field.key];

      for (let p = 0; p < field.len; p++) {
        if (targetStr[p] !== currentStr[p]) {
          scheduleCell(r, field.key, p, targetStr[p]);
        }
      }
      displayed[r][field.key] = targetStr;
    }
  }
}

// ============================================================
//  Chaos mode
// ============================================================
let chaosRunning     = false;
let autoChaosEnabled = false;
let autoChaosTimer   = null;

function triggerChaos() {
  if (chaosRunning) return;
  chaosRunning = true;
  initAudio(); // prime audio immediately on button press

  const btnChaos = document.getElementById('btn-chaos');
  btnChaos.classList.add('btn-active');
  btnChaos.textContent = 'SCRAMBLING...';

  // Stagger each cell's scramble start for a cascading wave effect
  for (let r = 0; r < NUM_ROWS; r++) {
    for (const field of FIELDS) {
      for (let p = 0; p < field.len; p++) {
        const delay = Math.random() * 400; // up to 400ms stagger
        setTimeout(() => {
          // Push 8-18 random chars straight into the queue for frantic flipping
          const steps = 8 + Math.floor(Math.random() * 11);
          for (let s = 0; s < steps; s++) {
            // Skip index 0 (space) so we get visible characters
            const idx = 1 + Math.floor(Math.random() * (CHARS.length - 1));
            queues[r][field.key][p].push(CHARS[idx]);
          }
          drain(r, field.key, p);
        }, delay);
      }
    }
  }

  // Restore real data after chaos settles:
  // max stagger (400ms) + max steps (18) × flip time (100ms) + buffer = ~2700ms
  setTimeout(() => {
    updateBoard(lastRows);
    chaosRunning = false;
    btnChaos.classList.remove('btn-active');
    btnChaos.textContent = '◆ SCRAMBLE';
  }, 3000);
}

function toggleAutoChaos() {
  autoChaosEnabled = !autoChaosEnabled;
  const btn = document.getElementById('btn-auto');

  if (autoChaosEnabled) {
    btn.textContent = 'AUTO: ON';
    btn.classList.add('btn-active');
    autoChaosTimer = setInterval(triggerChaos, 60 * 60 * 1000); // every hour
  } else {
    btn.textContent = 'AUTO: OFF';
    btn.classList.remove('btn-active');
    clearInterval(autoChaosTimer);
    autoChaosTimer = null;
  }
}

// ============================================================
//  Clock
// ============================================================
function startClock() {
  const el = document.getElementById('header-clock');
  function tick() {
    const d = new Date();
    el.textContent = [
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0'),
    ].join(':');
  }
  tick();
  setInterval(tick, 1000);
}

// ============================================================
//  WebSocket with auto-reconnect
// ============================================================
function connect() {
  const proto    = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws       = new WebSocket(`${proto}//${location.host}`);
  const statusEl = document.getElementById('connection-status');
  const updateEl = document.getElementById('last-update');

  ws.onopen = () => {
    statusEl.textContent = 'LIVE';
    statusEl.className   = 'status-live';
  };

  ws.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'update') {
        lastRows = msg.rows; // save for chaos restore
        updateBoard(msg.rows);
        const d  = new Date();
        const ts = [
          String(d.getHours()).padStart(2, '0'),
          String(d.getMinutes()).padStart(2, '0'),
          String(d.getSeconds()).padStart(2, '0'),
        ].join(':');
        updateEl.textContent = `LAST UPDATE  ${ts}`;
      }
    } catch { /* ignore malformed message */ }
  };

  ws.onclose = () => {
    statusEl.textContent = 'OFFLINE';
    statusEl.className   = 'status-offline';
    setTimeout(connect, 3000);
  };

  ws.onerror = () => ws.close();
}

// ============================================================
//  Boot
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  buildBoard();
  startClock();
  connect();

  document.getElementById('btn-chaos').addEventListener('click', triggerChaos);
  document.getElementById('btn-auto').addEventListener('click', toggleAutoChaos);

  // Prime audio on any interaction — removes the silent-lag issue
  const primeAudio = () => initAudio();
  document.addEventListener('click',   primeAudio);
  document.addEventListener('keydown', primeAudio);
});
