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
  const sideLabel = side === 'PROSECUTION' ? 'PROSECUTION — argue FOR' : 'DEFENSE — argue AGAINST';
  sideBadge.innerHTML = `
    <img src="images/${charImg}.png" class="side-character" alt="" />
    <span class="side-badge-label">${escHtml(sideLabel)}</span>
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
function buildReactionBar(a, round) {
  const buttons = ['🔥', '💀', '😂'].map(e => {
    const count  = a.reactions?.[e] ?? 0;
    const active = a.myReaction === e ? ' my-reaction' : '';
    const label  = count > 0 ? `${e}<span class="reaction-count">${count}</span>` : e;
    return `<button class="reaction-btn${active}" data-author-guid="${escAttr(a.authorGuid)}" data-round="${round}" data-emoji="${e}" aria-label="React ${e}">${label}</button>`;
  }).join('');
  return `<div class="reaction-bar">${buttons}</div>`;
}

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
      ${buildReactionBar(a, s.currentRound)}
    </div>`;
  }).join('');
  el('reveal-args').innerHTML = `<h2>Arguments</h2>${argsHtml}`;

  // Staggered card-flip animation — only on first entry to avoid re-flipping on reaction updates
  if (phaseChanged) {
    el('reveal-args').querySelectorAll('.arg-card').forEach((card, i) => {
      card.style.animationDelay = `${i * 80}ms`;
      card.classList.add('flip-in');
    });
  }

  // Contempt card
  const contemptPlayers = (s.players || []).filter(p =>
    (s.contemptGuids || []).includes(p.guid));
  if (contemptPlayers.length) {
    el('reveal-contempt').innerHTML =
      `<h2><img src="images/gavel-slam.png" class="contempt-gavel" alt="" /> Held in Contempt</h2>` +
      `<p class="contempt-rule">No one voted for their argument as the most convincing this round. Zero best-arg votes = contempt of court.</p>` +
      contemptPlayers.map(p => `<div class="player-row">${escHtml(p.name)}</div>`).join('');
    show('reveal-contempt');
  } else {
    hide('reveal-contempt');
  }

  // Scores — rendered with animated count-up, once per phase entry
  if (phaseChanged) {
    const sortedPlayers = (s.players || []).slice().sort((a, b) => b.score - a.score);
    const scoresHtml = sortedPlayers.map(p =>
      `<div class="score-row">
        <span class="score-name">${escHtml(p.name)}</span>
        <span class="score-pts" data-target="${p.score}">0 pts</span>
      </div>`
    ).join('');
    el('reveal-scores').innerHTML = `<h2>Scores so far</h2>${scoresHtml}`;
    animateScores('reveal-scores');
  }

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
const TAKES_POOL = [
  // RTO
  "Mandating RTO to justify real estate spend is a real estate decision dressed up as a culture argument.",
  "Proximity to your manager is not a productivity metric.",
  "The people who thrived in the office before COVID are the ones most excited about coming back.",
  '"Collaboration happens in person" is true — so is "interruptions happen in person."',
  "Your RTO policy is a retention filter, and it's not keeping the people you think it is.",
  'If the work got done remotely for three years, "we need to see each other" is a preference, not a business case.',
  "Hybrid means different things to every manager, and that ambiguity is intentional.",
  "The first thing companies track when they mandate RTO is badge swipes, not output.",
  "Open floor plans were already failing before the pandemic — RTO didn't fix that.",
  "Senior leaders who say culture requires presence usually have a private office.",
  // Governance & Audit
  "Most compliance processes are designed to produce evidence for auditors, not to actually reduce risk.",
  "If your security review takes longer than your sprint, your governance process is the vulnerability.",
  "A policy nobody reads isn't governance — it's legal cover.",
  "The audit trail your team maintains is fine until the auditor asks a question nobody anticipated.",
  "Governance frameworks get adopted after the incident, not before.",
  '"We need to document that" is how teams avoid actually fixing the problem.',
  "The difference between a mature security posture and security theater is whether anyone reviews what gets flagged.",
  "Change advisory boards slow down deployments more than they prevent incidents.",
  "Compliance certifications tell you what a company does on paper — not what it does at 3am during an outage.",
  "Every enterprise \"approval workflow\" has at least one person in it who just clicks approve without reading.",
  // Sprint / Scrum / Kanban
  "Standups exist to give managers visibility, not to help engineers get unblocked.",
  "A two-week sprint that always slips isn't a planning problem — it's a scope problem that planning is covering for.",
  "Story points are a unit of feeling, not a unit of time, and pretending otherwise is how you get bad forecasts.",
  "Velocity as a performance metric is how you get teams that game velocity.",
  "The sprint retrospective where nothing changes is a ceremony, not a process improvement.",
  'If your "definition of done" needs a meeting to interpret, it\'s not done being defined.',
  "Kanban works until someone starts asking why the WIP limit keeps getting raised.",
  '"We follow agile principles" usually means we do sprints and ignore the rest of the manifesto.',
  "Every backlog older than six months is an archaeology project, not a product roadmap.",
  "The sprint demo that impresses stakeholders and the sprint that ships real value are not always the same sprint.",
  // Enterprise & Microservices
  "You don't have microservices — you have a distributed monolith with network latency and no shared types.",
  "Every cross-team dependency is a negotiation, and whoever has the less urgent roadmap wins.",
  "The team that owns the shared platform is everyone's bottleneck and nobody's priority.",
  '"We\'ll coordinate in the next PI planning" means it won\'t happen this quarter.',
  "Service ownership means nothing without on-call accountability attached to it.",
  "The reason your internal API is undocumented is that the team that built it didn't expect anyone else to use it.",
  "Enterprise architecture diagrams describe the system as it was designed, not as it actually runs.",
  'The "platform team" tax is real — every abstraction they add is a learning curve every other team pays.',
  "Microservices solved deployment coupling and created organizational coupling instead.",
  "Any integration that requires a Confluence page, a JIRA ticket, and a meeting to initiate is not an integration — it's a project.",
  // Corporate Slowness
  "The reason nothing ships in Q4 is not the holidays — it's that everyone stops committing to things in October.",
  '"We need to loop in stakeholders" is how a two-day decision becomes a two-month one.',
  "A committee that can approve but not reject is not a decision-making body — it's a delay mechanism.",
  "The bigger the company, the longer the gap between the person with the problem and the person with the authority to fix it.",
  "Most enterprise software tools are selected by people who will never have to use them daily.",
  "Headcount approval processes are designed to slow hiring — not to ensure quality hires.",
  "The vendor evaluation that runs for six months and ends with the safe incumbent choice wasn't really an evaluation.",
  '"We\'re aligned" and "we agree on what to build" are not the same thing, and teams find out which one they meant in sprint three.',
  "Nothing reveals your org chart faster than a production incident.",
  "The company that takes nine months to onboard a new tool will never move faster than the company that ships its own.",
];

function shuffled(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Randomly selected takes for this page load — stable across round-count changes
// so the takes don't reshuffle every time the dropdown changes.
const SESSION_TAKES = shuffled(TAKES_POOL);

function populateTakesForm() {
  const n   = parseInt(el('total-rounds').value, 10);
  const con = el('takes-container');
  const existing = Array.from(con.querySelectorAll('.take-input'))
    .map(i => i.value).filter(Boolean);
  con.innerHTML = '';
  for (let i = 0; i < n; i++) {
    addTakeInput(existing[i] || SESSION_TAKES[i] || '', i + 1);
  }
}

function addTakeInput(value, index) {
  const con = el('takes-container');
  const row = document.createElement('div');
  row.className = 'take-row';
  row.innerHTML = `<textarea class="take-input" maxlength="160" rows="2"
      placeholder="Take ${index}">${escHtml(value)}</textarea>`;
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

  el('reveal-args').addEventListener('click', async e => {
    const btn = e.target.closest('.reaction-btn');
    if (!btn || !me.playerGuid) return;
    try {
      await apiFetch(`POST /rooms/${me.roomCode}/reactions`, {
        playerGuid:    me.playerGuid,
        round:         parseInt(btn.dataset.round, 10),
        argAuthorGuid: btn.dataset.authorGuid,
        emoji:         btn.dataset.emoji,
      });
    } catch (err) {
      console.warn('reaction error', err);
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
