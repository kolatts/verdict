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
// Config — swap API_BASE for the cloud endpoint after Phase 7
// ---------------------------------------------------------------------------
const API_BASE = 'http://localhost:7071/api';
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

  if (me.roomCode && me.playerGuid) {
    startPolling();
  }
});

window.addEventListener('hashchange', () => {
  parseHashIdentity();
  if (me.roomCode && me.playerGuid) startPolling();
});

function parseHashIdentity() {
  // Hash format: #/room/ABCD/guid
  const parts = location.hash.replace('#', '').split('/').filter(Boolean);
  if (parts[0] === 'room' && parts[1] && parts[2]) {
    me.roomCode   = parts[1].toUpperCase();
    me.playerGuid = parts[2];
    localStorage.setItem(`verdict_guid_${me.roomCode}`, me.playerGuid);
  } else if (parts[0] === 'room' && parts[1]) {
    // Code only (join link) — guid from localStorage if available
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
    const s = await apiFetch(
      `GET /rooms/${me.roomCode}/state?playerGuid=${me.playerGuid}`);
    showConnecting(false);
    render(s);
  } catch (err) {
    // Stay on connecting overlay until we get a response
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
    // Reset form on new round
    el('arg-text').value = '';
    selectedArgId   = null;
    selectedStance  = null;
    updateCharCounter();
  }

  const sideBadge = el('side-badge');
  sideBadge.textContent = s.you?.side === 'PROSECUTION'
    ? '⚖️ You are PROSECUTION — argue FOR the take'
    : '🛡️ You are DEFENSE — argue AGAINST the take';
  sideBadge.dataset.side = s.you?.side || '';

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

  // Rebind click handlers (cards rebuilt each poll if phaseChanged)
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

  // Contempt card
  const contemptPlayers = (s.players || []).filter(p =>
    (s.contemptGuids || []).includes(p.guid));
  if (contemptPlayers.length) {
    el('reveal-contempt').innerHTML =
      `<h2>🔨 Held in Contempt</h2>` +
      contemptPlayers.map(p => `<div class="player-row">${escHtml(p.name)}</div>`).join('');
    show('reveal-contempt');
  } else {
    hide('reveal-contempt');
  }

  // Scores so far
  const scoresHtml = (s.players || [])
    .slice().sort((a, b) => b.score - a.score)
    .map(p => `<div class="score-row">
      <span class="score-name">${escHtml(p.name)}</span>
      <span class="score-pts">${p.score} pt${p.score !== 1 ? 's' : ''}</span>
    </div>`).join('');
  el('reveal-scores').innerHTML = `<h2>Scores so far</h2>${scoresHtml}`;

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
      <span class="score-pts">${p.score} pt${p.score !== 1 ? 's' : ''}${contemptText}</span>
    </div>`;
  }).join('');
  el('final-leaderboard').innerHTML = `<h2>🏆 Final Leaderboard</h2>${rows}`;
}

// ---------------------------------------------------------------------------
// Home screen events (create / join)
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
  // Preserve any existing custom entries then fill with preloaded defaults
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
  // Char counter
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

  // Stance buttons
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
        // bestArgId is the opaque ID from get-state; the server resolves it to a playerGuid
        // so the client never learns who wrote which argument during the VOTE phase
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
  const url = `${API_BASE}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const json = await res.json();

  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === `screen-${name}`);
    s.classList.toggle('hidden', s.id !== `screen-${name}`);
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
