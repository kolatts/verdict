/**
 * Verdict — frontend app
 *
 * Identity: playerGuid + roomCode live in the URL hash (#/room/CODE/GUID)
 * and are backed up in localStorage keyed by roomCode.
 *
 * State sync: polling every POLL_MS ms via GET /api/rooms/{code}/state
 *
 * Rendering: only rebuild DOM when phase:round changes to avoid flicker.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:7071/api'
  : 'https://verdict-backend.azurewebsites.net/api';
const POLL_MS  = 2500;
const MAX_ARG_CHARS = 280; // mirrors GameService.MaxArgChars

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let me = { roomCode: null, playerGuid: null };
let pollTimer = null;
let lastPhaseKey = '';
let selectedArgId = null;
let selectedStance = null;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
window.addEventListener('load', () => {
  parseHashIdentity();
  bindHomeEvents();
  bindLobbyEvents();
  bindPlayEvents();
  bindRevealEvents();
  bindFinalEvents();
  initParallax();

  if (me.roomCode && me.playerGuid) {
    startPolling();
  } else if (me.roomCode && !me.playerGuid) {
    // Join link: show the join form with code pre-filled, focused on name
    show('form-join'); hide('form-create');
    el('join-code').value = me.roomCode;
    el('join-name').focus();
  }
});

window.addEventListener('hashchange', () => {
  parseHashIdentity();
  if (me.roomCode && me.playerGuid) startPolling();
});

function parseHashIdentity() {
  const parts = location.hash.replace('#', '').split('/').filter(Boolean);
  if (parts[0] === 'room' && parts[1] && parts[2]) {
    me.roomCode   = parts[1].toUpperCase();
    me.playerGuid = parts[2];
    localStorage.setItem(`verdict_guid_${me.roomCode}`, me.playerGuid);
  } else if (parts[0] === 'room' && parts[1]) {
    me.roomCode   = parts[1].toUpperCase();
    me.playerGuid = localStorage.getItem(`verdict_guid_${me.roomCode}`) || null;
  }
}

function setIdentity(roomCode, playerGuid) {
  me.roomCode   = roomCode;
  me.playerGuid = playerGuid;
  localStorage.setItem(`verdict_guid_${roomCode}`, playerGuid);
  location.hash = `/room/${roomCode}/${playerGuid}`;
}

// ---------------------------------------------------------------------------
// Parallax
// ---------------------------------------------------------------------------
function initParallax() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const layers = [
    { el: document.getElementById('parallax-bg'),      speed: 0.15 },
    { el: document.getElementById('parallax-bench'),   speed: 0.35 },
    { el: document.getElementById('parallax-columns'), speed: 0.60 },
  ].filter(l => l.el);

  if (!layers.length) return;

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    layers.forEach(({ el: layer, speed }) => {
      layer.style.transform = `translateY(${y * speed}px)`;
    });
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------
function startPolling() {
  stopPolling();
  showConnecting(true);
  poll();
  pollTimer = setInterval(poll, POLL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function poll() {
  if (!me.roomCode || !me.playerGuid) return;
  try {
    const s = await apiFetch(`GET /rooms/${me.roomCode}/state?playerGuid=${me.playerGuid}`);
    showConnecting(false);
    render(s);
  } catch (err) {
    console.warn('poll error', err);
  }
}

// ---------------------------------------------------------------------------
// Render — dispatch by phase
// ---------------------------------------------------------------------------
function render(s) {
  const key = `${s.phase}:${s.currentRound ?? ''}`;
  switch (s.phase) {
    case 'LOBBY':    showScreen('lobby');  renderLobby(s); break;
    case 'ARGUMENT': showScreen('play');   renderArgument(s, key !== lastPhaseKey); break;
    case 'VOTE':     showScreen('play');   renderVote(s, key !== lastPhaseKey); break;
    case 'REVEAL':   showScreen('reveal'); renderReveal(s, key !== lastPhaseKey); break;
    case 'FINAL':    showScreen('final');  renderFinal(s, key !== lastPhaseKey); break;
  }
  lastPhaseKey = key;
}

// ---------------------------------------------------------------------------
// LOBBY
// ---------------------------------------------------------------------------
function renderLobby(s) {
  el('lobby-room-code').textContent = s.roomCode || me.roomCode;

  const link = `${location.origin}${location.pathname}#/room/${s.roomCode || me.roomCode}`;
  el('lobby-join-link').textContent = link;

  const playerHtml = (s.players || []).map(p =>
    `<div class="player-row">${escHtml(p.name)}${p.isHost ? ' 👑' : ''}</div>`
  ).join('');
  el('lobby-players').innerHTML = playerHtml;

  const n = (s.players || []).length;
  if (s.you?.isHost) {
    const startBtn = el('btn-start');
    if (s.canStart) {
      startBtn.classList.remove('hidden');
      el('lobby-status').textContent = 'Room locked. Ready to start!';
    } else {
      startBtn.classList.add('hidden');
      el('lobby-status').textContent =
        n < 3 ? `Waiting for players… (${n}/3 minimum)` : 'Waiting for first player to join to lock room…';
    }
  } else {
    el('btn-start').classList.add('hidden');
    el('lobby-status').textContent = 'Waiting for the host to start…';
  }
}

// ---------------------------------------------------------------------------
// ARGUMENT
// ---------------------------------------------------------------------------
function renderArgument(s, phaseChanged) {
  el('play-round').textContent = (s.currentRound ?? 0) + 1;
  el('play-total').textContent = s.totalRounds;
  el('play-take').textContent  = s.take || '';

  show('play-argument');
  hide('play-vote');

  if (phaseChanged) {
    el('arg-text').value = '';
    selectedArgId   = null;
    selectedStance  = null;
    updateCharCounter();
  }

  const side = s.you?.side || '';
  const sideBadge = el('side-badge');
  const charImg   = side === 'PROSECUTION' ? 'char-fox' : 'char-bear';
  const sideText  = side === 'PROSECUTION'
    ? 'PROSECUTION — argue FOR the take'
    : 'DEFENSE — argue AGAINST the take';

  sideBadge.innerHTML = `
    <div class="side-avatar-wrap">
      <img src="/images/${charImg}.png" class="side-avatar" alt="" />
    </div>
    <span>${escHtml(sideText)}</span>
  `;
  sideBadge.dataset.side = side;

  if (s.you?.hasSubmitted) {
    el('arg-text').disabled = true;
    el('btn-submit-arg').disabled = true;
    show('arg-submitted-notice');
    el('arg-waiting-count').textContent =
      `(${s.submittedCount}/${s.totalPlayers} submitted)`;
  } else {
    el('arg-text').disabled = false;
    hide('arg-submitted-notice');
    updateSubmitArgBtn();
  }
}

// ---------------------------------------------------------------------------
// VOTE
// ---------------------------------------------------------------------------
function renderVote(s, phaseChanged) {
  el('play-round').textContent = (s.currentRound ?? 0) + 1;
  el('play-total').textContent = s.totalRounds;
  el('play-take').textContent  = s.take || '';

  hide('play-argument');
  show('play-vote');

  if (phaseChanged) {
    selectedArgId  = null;
    selectedStance = null;
  }

  if (s.you?.hasVoted) {
    hide('vote-form');
    show('vote-submitted-notice');
    el('vote-waiting-count').textContent =
      `(${s.votedCount}/${s.totalPlayers} voted)`;
    el('vote-args').innerHTML = buildArgCards(s.arguments || [], null, true);
    return;
  }

  hide('vote-submitted-notice');
  show('vote-form');
  el('vote-args').innerHTML = buildArgCards(s.arguments || [], selectedArgId, false);

  el('vote-args').querySelectorAll('.arg-card[data-arg-id]').forEach(card => {
    card.addEventListener('click', () => {
      selectedArgId = card.dataset.argId;
      renderVoteCardSelection();
      updateCastVoteBtn();
    });
  });

  updateStanceBtns();
  updateCastVoteBtn();
}

function buildArgCards(args, selectedId, readonly) {
  return args.map(a => {
    const selected = a.argId === selectedId ? ' selected' : '';
    const roClass  = readonly ? ' readonly' : '';
    return `<div class="arg-card${selected}${roClass}" data-arg-id="${escAttr(a.argId)}">
      <span class="arg-side-label ${a.side.toLowerCase()}">${a.side}</span>
      <p>${escHtml(a.text)}</p>
    </div>`;
  }).join('');
}

function renderVoteCardSelection() {
  el('vote-args').querySelectorAll('.arg-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.argId === selectedArgId);
  });
}

// ---------------------------------------------------------------------------
// REVEAL
// ---------------------------------------------------------------------------
function renderReveal(s, phaseChanged) {
  el('reveal-round').textContent = (s.currentRound ?? 0) + 1;
  el('reveal-total').textContent = s.totalRounds;
  el('reveal-take').textContent  = s.take || '';

  // Arguments with authors
  const argsHtml = (s.arguments || []).map(a => {
    const contempt = (s.contemptGuids || []).includes(a.authorGuid);
    return `<div class="arg-card reveal-card">
      <span class="arg-side-label ${a.side.toLowerCase()}">${a.side}</span>
      <p>${escHtml(a.text)}</p>
      <div class="reveal-author">
        <strong>${escHtml(a.authorName)}</strong>
        — argued ${a.side}, actually
        <strong>${a.realStance ?? '?'}</strong>
        · ${a.bestArgVotes} best-arg vote${a.bestArgVotes !== 1 ? 's' : ''}
        ${contempt ? '<span class="contempt-badge">🔨 Held in Contempt</span>' : ''}
      </div>
    </div>`;
  }).join('');
  el('reveal-args').innerHTML = `<h2>Arguments</h2>${argsHtml}`;

  // Staggered card-flip animation
  el('reveal-args').querySelectorAll('.arg-card').forEach((card, i) => {
    card.style.animationDelay = `${i * 80}ms`;
    card.classList.add('flip-in');
  });

  // Contempt card
  const contemptPlayers = (s.players || []).filter(p =>
    (s.contemptGuids || []).includes(p.guid));
  if (contemptPlayers.length) {
    el('reveal-contempt').innerHTML =
      `<h2><img src="/images/gavel-slam.png" class="contempt-gavel" alt="" /> Held in Contempt</h2>` +
      `<p class="contempt-rule">No one voted for their argument as the most convincing this round. Zero best-arg votes = contempt of court.</p>` +
      contemptPlayers.map(p => `<div class="player-row">${escHtml(p.name)}</div>`).join('');
    show('reveal-contempt');
  } else {
    hide('reveal-contempt');
  }

  // Scores — rendered with animated count-up
  const sortedPlayers = (s.players || []).slice().sort((a, b) => b.score - a.score);
  const scoresHtml = sortedPlayers.map(p =>
    `<div class="score-row">
      <span class="score-name">${escHtml(p.name)}</span>
      <span class="score-pts" data-target="${p.score}">0 pts</span>
    </div>`
  ).join('');
  el('reveal-scores').innerHTML = `<h2>Scores so far</h2>${scoresHtml}`;
  animateScores('reveal-scores');

  // Host navigation buttons
  if (s.you?.isHost) {
    if (s.isLastRound) {
      hide('btn-next-round'); show('btn-final');
    } else {
      show('btn-next-round'); hide('btn-final');
    }
  } else {
    hide('btn-next-round'); hide('btn-final');
  }
}

// ---------------------------------------------------------------------------
// FINAL
// ---------------------------------------------------------------------------
function renderFinal(s, phaseChanged) {
  if (!phaseChanged) return;

  const rows = (s.leaderboard || []).map(p => {
    const contemptText = p.contemptRounds.length
      ? ` <span class="contempt-badge">🔨 ×${p.contemptRounds.length}</span>` : '';
    const medal = p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `#${p.rank}`;
    const isYou = p.guid === me.playerGuid ? ' <em>(you)</em>' : '';
    return `<div class="score-row rank-row">
      <span class="rank-medal">${medal}</span>
      <span class="score-name">${escHtml(p.name)}${isYou}</span>
      <span class="score-pts" data-target="${p.score}">0 pts${contemptText}</span>
    </div>`;
  }).join('');
  el('final-leaderboard').innerHTML = `<h2>🏆 Final Leaderboard</h2>${rows}`;
  animateScores('final-leaderboard');
}

// ---------------------------------------------------------------------------
// Score count-up animation
// ---------------------------------------------------------------------------
function animateScores(containerId) {
  const container = el(containerId);
  container.querySelectorAll('.score-pts[data-target]').forEach(span => {
    const target = parseInt(span.dataset.target, 10);
    const suffix = target !== 1 ? 's' : '';
    const extra  = span.innerHTML.includes('contempt-badge')
      ? ' ' + span.innerHTML.split('</span>').slice(1).join('</span>')  // preserve badge HTML after count
      : '';
    countUp(span, target, v => `${v} pt${v !== 1 ? 's' : ''}${extra}`);
  });
}

function countUp(span, target, render) {
  if (target === 0) { span.textContent = render(0); return; }
  const start    = performance.now();
  const duration = 600;
  (function tick(now) {
    const t    = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out
    span.innerHTML = render(Math.round(ease * target));
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

// ---------------------------------------------------------------------------
// Home screen events
// ---------------------------------------------------------------------------
function bindHomeEvents() {
  el('btn-show-create').addEventListener('click', () => {
    show('form-create'); hide('form-join');
    populateTakesForm();
  });

  el('btn-show-join').addEventListener('click', () => {
    show('form-join'); hide('form-create');
  });

  el('total-rounds').addEventListener('change', populateTakesForm);
  el('btn-add-take').addEventListener('click', addCustomTakeInput);

  el('btn-create').addEventListener('click', handleCreate);
  el('btn-join').addEventListener('click', handleJoin);
}

async function handleCreate() {
  const hostName    = el('host-name').value.trim();
  const totalRounds = parseInt(el('total-rounds').value, 10);
  const takes       = collectTakes();

  clearError('create-error');

  if (!hostName)          return showError('create-error', 'Enter your name.');
  if (takes.length === 0) return showError('create-error', 'Add at least one take.');
  if (takes.length < totalRounds)
    return showError('create-error', `Add at least ${totalRounds} takes (one per round).`);

  el('btn-create').disabled = true;
  try {
    const data = await apiFetch('POST /rooms', { hostName, totalRounds, takes });
    setIdentity(data.roomCode, data.playerGuid);
    startPolling();
  } catch (err) {
    showError('create-error', err.message);
  } finally {
    el('btn-create').disabled = false;
  }
}

async function handleJoin() {
  const code = el('join-code').value.trim().toUpperCase();
  const name = el('join-name').value.trim();

  clearError('join-error');
  if (!code) return showError('join-error', 'Enter the room code.');
  if (!name) return showError('join-error', 'Enter your name.');

  el('btn-join').disabled = true;
  try {
    const data = await apiFetch(`POST /rooms/${code}/players`, { name });
    setIdentity(code, data.playerGuid);
    startPolling();
  } catch (err) {
    showError('join-error', err.message);
  } finally {
    el('btn-join').disabled = false;
  }
}

// Takes form
const PRELOADED_TAKES = [
  'Open offices were a war crime',
  'Lunch meetings should be illegal',
  'Remote work killed company culture',
  'Morning people are insufferable',
  'Networking events are purely performative',
  'Reply-all should be a fireable offense',
  'Standing desks are a personality, not a tool',
  'Group chats do more harm than good',
  'Unlimited PTO means zero PTO',
  'The office kitchen is a lawless zone',
];

function populateTakesForm() {
  const n   = parseInt(el('total-rounds').value, 10);
  const con = el('takes-container');
  const existing = Array.from(con.querySelectorAll('.take-input'))
    .map(i => i.value).filter(Boolean);
  con.innerHTML = '';
  for (let i = 0; i < n; i++) {
    addTakeInput(existing[i] || PRELOADED_TAKES[i] || '', i + 1);
  }
}

function addTakeInput(value, index) {
  const con = el('takes-container');
  const row = document.createElement('div');
  row.className = 'take-row';
  row.innerHTML = `<input class="take-input" type="text" maxlength="160"
      placeholder="Take ${index}" value="${escAttr(value)}" />`;
  con.appendChild(row);
}

function addCustomTakeInput() {
  const con = el('takes-container');
  const n   = con.querySelectorAll('.take-input').length + 1;
  addTakeInput('', n);
}

function collectTakes() {
  return Array.from(el('takes-container').querySelectorAll('.take-input'))
    .map(i => i.value.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Lobby events
// ---------------------------------------------------------------------------
function bindLobbyEvents() {
  el('btn-copy-link').addEventListener('click', () => {
    const link = el('lobby-join-link').textContent;
    navigator.clipboard.writeText(link).then(() => {
      el('btn-copy-link').textContent = 'Copied!';
      setTimeout(() => el('btn-copy-link').textContent = 'Copy join link', 2000);
    });
  });

  el('btn-start').addEventListener('click', async () => {
    el('btn-start').disabled = true;
    try {
      await apiFetch(`POST /rooms/${me.roomCode}/advance`, { playerGuid: me.playerGuid });
    } catch (err) {
      console.error('start error', err);
    } finally {
      el('btn-start').disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Play events
// ---------------------------------------------------------------------------
function bindPlayEvents() {
  el('arg-text').addEventListener('input', updateCharCounter);

  el('btn-submit-arg').addEventListener('click', async () => {
    const text = el('arg-text').value;
    clearError('arg-error');
    el('btn-submit-arg').disabled = true;
    try {
      await apiFetch(`POST /rooms/${me.roomCode}/actions`, {
        playerGuid: me.playerGuid,
        type: 'SUBMIT_ARGUMENT',
        payload: { text },
      });
      show('arg-submitted-notice');
    } catch (err) {
      showError('arg-error', err.message);
      updateSubmitArgBtn();
    }
  });

  document.querySelectorAll('.stance-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedStance = btn.dataset.stance;
      updateStanceBtns();
      updateCastVoteBtn();
    });
  });

  el('btn-cast-vote').addEventListener('click', async () => {
    if (!selectedArgId || !selectedStance) return;

    clearError('vote-error');
    el('btn-cast-vote').disabled = true;
    try {
      await apiFetch(`POST /rooms/${me.roomCode}/actions`, {
        playerGuid: me.playerGuid,
        type: 'CAST_VOTE',
        payload: { bestArgId: selectedArgId, stance: selectedStance },
      });
      show('vote-submitted-notice');
      hide('vote-form');
    } catch (err) {
      showError('vote-error', err.message);
      el('btn-cast-vote').disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Reveal events
// ---------------------------------------------------------------------------
function bindRevealEvents() {
  el('btn-next-round').addEventListener('click', async () => {
    el('btn-next-round').disabled = true;
    try {
      await apiFetch(`POST /rooms/${me.roomCode}/advance`, { playerGuid: me.playerGuid });
    } catch (err) {
      console.error('advance error', err);
    } finally {
      el('btn-next-round').disabled = false;
    }
  });

  el('btn-final').addEventListener('click', async () => {
    el('btn-final').disabled = true;
    try {
      await apiFetch(`POST /rooms/${me.roomCode}/advance`, { playerGuid: me.playerGuid });
    } catch (err) {
      console.error('advance error', err);
    } finally {
      el('btn-final').disabled = false;
    }
  });
}

function bindFinalEvents() {
  el('btn-new-room').addEventListener('click', () => {
    stopPolling();
    me = { roomCode: null, playerGuid: null };
    location.hash = '';
    showScreen('home');
  });
}

// ---------------------------------------------------------------------------
// Character counter
// ---------------------------------------------------------------------------
function updateCharCounter() {
  const len     = el('arg-text').value.length;
  const counter = el('arg-char-count');
  counter.textContent = `${len} / ${MAX_ARG_CHARS}`;
  counter.classList.toggle('warn', len >= 260 && len <= MAX_ARG_CHARS);
  counter.classList.toggle('over', len > MAX_ARG_CHARS);
  updateSubmitArgBtn();
}

function updateSubmitArgBtn() {
  const len = el('arg-text').value.trim().length;
  el('btn-submit-arg').disabled = len === 0 || len > MAX_ARG_CHARS;
}

function updateStanceBtns() {
  document.querySelectorAll('.stance-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.stance === selectedStance);
  });
}

function updateCastVoteBtn() {
  el('btn-cast-vote').disabled = !selectedArgId || !selectedStance;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
async function apiFetch(endpoint, body) {
  const [method, path] = endpoint.split(' ');
  const url  = `${API_BASE}${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(url, opts);
  const json = await res.json();

  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    const active = s.id === `screen-${name}`;
    s.classList.toggle('active', active);
    s.classList.toggle('hidden', !active);

    if (active) {
      const header = s.querySelector('.court-header');
      if (header) {
        header.classList.remove('phase-enter');
        void header.offsetWidth; // force reflow to restart animation
        header.classList.add('phase-enter');
      }
    }
  });
}

function showConnecting(visible) {
  el('connecting-overlay').classList.toggle('hidden', !visible);
}

function el(id) { return document.getElementById(id); }
function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }

function showError(id, msg) {
  const e = el(id);
  e.textContent = msg;
  e.classList.remove('hidden');
}

function clearError(id) {
  const e = el(id);
  e.textContent = '';
  e.classList.add('hidden');
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escAttr(s) { return escHtml(s); }
