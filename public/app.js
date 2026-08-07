/* Blind Scenario Auction — client.
   The server owns all game state; this file is a renderer plus an input pad. */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const store = {
  get playerId() { return localStorage.getItem('bsa.playerId') || ''; },
  set playerId(v) { localStorage.setItem('bsa.playerId', v); },
  get name() { return localStorage.getItem('bsa.name') || ''; },
  set name(v) { localStorage.setItem('bsa.name', v); },
  get room() { return localStorage.getItem('bsa.room') || ''; },
  set room(v) { v ? localStorage.setItem('bsa.room', v) : localStorage.removeItem('bsa.room'); },
};

let ws = null;
let state = null;          // last full state from the server
let serverOffset = 0;      // serverNow - Date.now(), for a shared clock
let reconnectDelay = 500;
let intentionallyClosed = false;
let chatOpen = false;
let unread = 0;
let lastChatId = null;
let pitchRoundLoaded = -1;

/* ------------------------------------------------------------- transport */

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('open', () => {
    reconnectDelay = 500;
    // Reclaim our seat after a refresh or a dropped connection.
    if (store.room && store.playerId) {
      send({ type: 'join', roomCode: store.room, playerId: store.playerId, name: store.name });
    }
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  });

  ws.addEventListener('close', () => {
    if (intentionallyClosed) return;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  });
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return toast('Reconnecting…');
  ws.send(JSON.stringify(payload));
}

function handle(msg) {
  switch (msg.type) {
    case 'joined':
      store.playerId = msg.playerId;
      store.room = msg.roomCode;
      history.replaceState(null, '', `?room=${msg.roomCode}`);
      $('view-home').classList.add('hidden');
      $('view-game').classList.remove('hidden');
      break;
    case 'state':
      serverOffset = msg.room.serverNow - Date.now();
      state = msg;
      render();
      break;
    case 'left':
      goHome();
      break;
    case 'error':
      toast(msg.message);
      // A stale seat should not trap us on a dead screen.
      if (/no longer|already under way|No room|full/i.test(msg.message) && !state) goHome();
      break;
  }
}

/* ---------------------------------------------------------------- toasts */

function toast(message, good = false) {
  const el = document.createElement('div');
  el.className = `toast${good ? ' is-good' : ''}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ----------------------------------------------------------------- clock */

function remainingMs() {
  if (!state || !state.room.deadline) return null;
  return state.room.deadline - (Date.now() + serverOffset);
}

setInterval(() => {
  const clock = $('clock');
  const ms = remainingMs();
  if (ms == null) return clock.classList.add('hidden');
  const secs = Math.max(0, Math.ceil(ms / 1000));
  clock.classList.remove('hidden');
  $('clock-value').textContent = secs;
  clock.classList.toggle('is-urgent', secs <= 5 && state.room.phase === 'auction');
}, 100);

/* ---------------------------------------------------------------- render */

const PHASE_LABEL = {
  lobby: 'Lobby', auction: 'Auction', reveal: 'Reveal',
  pitch: 'Pitch', vote: 'Voting', results: 'Results',
};

function render() {
  const { room, you } = state;

  $('room-code').textContent = room.code;
  $('phase-pill').textContent = PHASE_LABEL[room.phase] || room.phase;
  $('round-pill').classList.toggle('hidden', room.round === 0);
  $('round-pill').textContent = `Round ${room.round}`;

  for (const p of ['lobby', 'auction', 'reveal', 'pitch', 'vote', 'results']) {
    $(`panel-${p}`).classList.toggle('hidden', p !== room.phase);
  }

  $('host-tools').classList.toggle('hidden', !you || !you.isHost || room.phase === 'lobby' || room.phase === 'results');

  if (room.phase === 'lobby') renderLobby();
  if (room.phase === 'auction') renderAuction();
  if (room.phase === 'reveal') renderReveal();
  if (room.phase === 'pitch') renderPitch();
  if (room.phase === 'vote') renderVote();
  if (room.phase === 'results') renderResults();

  renderChat();
}

/** A catalogue row: name on the left, dotted leader, figure on the right. */
function playerRow(p, extra = '') {
  const you = state.you && p.id === state.you.id;
  const classes = ['player-row'];
  if (you) classes.push('is-you');
  if (!p.connected) classes.push('is-out');
  if (p.isHighBidder) classes.push('is-high');
  return `<li class="${classes.join(' ')}">
    <span class="player-row__dot"></span>
    <span class="player-row__name">${esc(p.name)}</span>
    ${p.isHost ? '<span class="crown" title="Host">★</span>' : ''}
    <span class="leader"></span>
    <span class="player-row__meta">${extra}</span>
  </li>`;
}

/* ----------------------------------------------------------------- lobby */

function renderLobby() {
  const { room, players, you } = state;
  $('lobby-count').textContent = `${players.length}/${room.maxPlayers}`;
  $('lobby-players').innerHTML = players
    .map((p) => playerRow(p, p.score ? `${p.score} pts` : ''))
    .join('');

  for (const input of document.querySelectorAll('[data-setting]')) {
    if (document.activeElement !== input) input.value = room.settings[input.dataset.setting];
    input.disabled = !you.isHost;
  }
  $('settings-note').classList.toggle('hidden', you.isHost);

  const ready = room.canStart;
  $('btn-start').disabled = !you.isHost || !ready;
  $('btn-start').textContent = room.round > 0 ? 'Start another round' : 'Open the bidding';
  $('start-hint').textContent = !ready
    ? 'Waiting for at least one more player…'
    : (you.isHost ? '' : 'Waiting for the host to start.');
}

/* --------------------------------------------------------------- auction */

function renderAuction() {
  const { room, players, you, lot } = state;

  $('lot-counter').textContent = `Lot ${room.lotNumber} of ${room.lotTotal}`;
  const statusEl = $('lot-status');
  const card = $('lot-card');
  card.classList.remove('is-sold', 'is-passed');

  if (lot) {
    // The card element is reused, so the deal animation has to be retriggered
    // whenever a new lot comes up.
    if (card.dataset.lotId !== `${room.lotNumber}:${lot.character.id}`) {
      card.dataset.lotId = `${room.lotNumber}:${lot.character.id}`;
      card.style.animation = 'none';
      void card.offsetWidth;
      card.style.animation = '';
    }
    $('lot-no').textContent = `NO. ${String(room.lotNumber).padStart(2, '0')}`;
    $('lot-emoji').textContent = lot.character.emoji;
    $('lot-tag').textContent = lot.character.tag;
    $('lot-name').textContent = lot.character.name;
    $('lot-role').textContent = lot.character.role;
    $('lot-traits').innerHTML = lot.character.traits.map((t) => `<li>${esc(t)}</li>`).join('');

    // The stamp is a one-shot element so its slam animation replays per lot.
    const old = card.querySelector('.stamp');
    if (old) old.remove();
    if (lot.status !== 'bidding') {
      const stamp = document.createElement('div');
      stamp.className = 'stamp' + (lot.status === 'passed' ? ' stamp--passed' : '');
      stamp.textContent = lot.status === 'sold' ? 'Sold' : 'No bid';
      card.appendChild(stamp);
    }

    if (lot.status === 'sold') {
      statusEl.textContent = `Knocked down to ${lot.bidderName} — ${lot.bid}`;
      statusEl.className = 'lot-status is-sold';
      card.classList.add('is-sold');
    } else if (lot.status === 'passed') {
      statusEl.textContent = 'Passed — into the bargain bin';
      statusEl.className = 'lot-status is-passed';
      card.classList.add('is-passed');
    } else {
      statusEl.textContent = 'On the block';
      statusEl.className = 'lot-status is-live';
    }

    $('current-bid').textContent = lot.bid > 0 ? lot.bid : '––';
    $('current-bid').classList.toggle('is-empty', !lot.bid);
    $('current-bidder').innerHTML = lot.bidderName ? `held by <b>${esc(lot.bidderName)}</b>` : 'no bids yet';
  }

  $('my-budget').textContent = you.budget;
  $('my-maxbid').textContent = Math.max(0, you.maxBid);
  $('my-roster').innerHTML = rosterItems(you.roster, room.settings.rosterSize);

  $('auction-players').innerHTML = players
    .map((p) => playerRow(p, `${p.budget}c · ${p.rosterCount}/${room.settings.rosterSize}`))
    .join('');

  $('sold-log').innerHTML = room.soldLog.length
    ? room.soldLog.map((s) => `<li>${s.emoji} <b>${esc(s.character)}</b> → ${esc(s.winnerName)} <span class="price">${s.price}c</span></li>`).join('')
    : '<li class="muted">Nothing yet.</li>';

  // Bid controls
  const full = you.roster.length >= room.settings.rosterSize;
  const live = lot && lot.status === 'bidding';
  const holding = lot && lot.bidderId === you.id;
  const canBid = live && !full && you.maxBid >= you.minBid && !holding;

  for (const btn of document.querySelectorAll('[data-bid-step]')) {
    const amount = bidAmountFor(Number(btn.dataset.bidStep));
    btn.disabled = !canBid || amount > you.maxBid;
    btn.textContent = `${amount}`;
  }
  $('input-bid').disabled = !canBid;
  $('form-bid').querySelector('button').disabled = !canBid;
  $('input-bid').min = you.minBid;
  $('input-bid').placeholder = `${you.minBid}–${Math.max(you.minBid, you.maxBid)}`;

  const emptyAfter = room.settings.rosterSize - you.roster.length - 1;
  $('bid-hint').textContent = full
    ? 'Roster full — sit back and watch the others panic.'
    : holding
      ? 'You hold the high bid.'
      : you.maxBid < you.minBid
        ? 'You cannot cover this one. Save it for a cheaper lot.'
        : emptyAfter > 0
          ? `Max ${you.maxBid} — ${emptyAfter} credit${emptyAfter === 1 ? '' : 's'} held back for your empty slots.`
          : `Max ${you.maxBid} — this is your last slot.`;
}

function bidAmountFor(step) {
  const lot = state.lot;
  const base = lot ? lot.bid : 0;
  return Math.max(state.you.minBid, base + step);
}

function rosterItems(roster, size) {
  const rows = roster.map((c) => `<li class="roster-item">
      <span class="roster-item__emoji">${c.emoji}</span>
      <span class="roster-item__name">${esc(c.name)}</span>
      <span class="leader"></span>
      <span class="roster-item__price${c.free ? ' is-free' : ''}">${c.free ? 'unsold' : c.price}</span>
    </li>`);

  for (let i = roster.length; i < size; i++) {
    rows.push('<li class="roster-item roster-item--empty">empty slot</li>');
  }
  return rows.join('');
}

/* ---------------------------------------------------------------- reveal */

function renderReveal() {
  const s = state.room.scenario;
  if (!s) return;
  $('reveal-emoji').textContent = s.emoji;
  $('reveal-title').textContent = s.title;
  $('reveal-setup').textContent = s.setup;
  $('reveal-stakes').innerHTML = s.stakes.map((t) => `<li>${esc(t)}</li>`).join('');
}

/* ----------------------------------------------------------------- pitch */

function scenarioStrip(s) {
  return `<span class="scenario-strip__emoji">${s.emoji}</span>
    <div>
      <h2>${esc(s.title)}</h2>
      <p>${esc(s.setup)}</p>
    </div>
    <ul class="scenario-strip__stakes">${s.stakes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function renderPitch() {
  const { room, players, you } = state;
  $('pitch-scenario').innerHTML = scenarioStrip(room.scenario);

  // Rebuild only when the hand itself changes. Re-rendering on every state
  // update (someone readies up, someone chats) would restart the deal
  // animation and make the cards flicker.
  const grid = $('mvp-grid');
  const signature = `${room.round}:${you.roster.map((c) => c.id).join(',')}`;
  if (grid.dataset.signature !== signature) {
    grid.dataset.signature = signature;
    grid.innerHTML = you.roster.map((c) => `
      <button class="mvp-card" data-mvp="${c.id}">
        <span class="mvp-card__emoji">${c.emoji}</span>
        <span class="mvp-card__name">${esc(c.name)}</span>
        <span class="mvp-card__role">${esc(c.role)}</span>
        <span class="mvp-card__star">★</span>
      </button>`).join('');
  }
  for (const btn of grid.children) {
    btn.classList.toggle('is-picked', btn.dataset.mvp === you.mvpId);
    btn.disabled = you.pitchSubmitted;
  }

  const box = $('input-line');
  if (pitchRoundLoaded !== room.round) {
    box.value = you.line || '';
    pitchRoundLoaded = room.round;
  }
  box.disabled = you.pitchSubmitted;
  $('btn-pitch').disabled = you.pitchSubmitted || !you.mvpId;
  $('btn-pitch').textContent = you.pitchSubmitted ? 'Ready ✓' : 'Ready';

  $('pitch-status').innerHTML = players
    .map((p) => playerRow(p, p.pitchSubmitted ? '✓' : '…'))
    .join('');
}

/* ------------------------------------------------------------------ vote */

/** Five names as a catalogue list, MVP starred, price on the right. */
function crewList(player) {
  return `<ul class="crew-list">${player.roster.map((c) => `
    <li class="${c.id === player.mvpId ? 'is-mvp' : ''}">
      <span>${c.emoji}</span><span class="nm">${esc(c.name)}</span>
      <span class="leader"></span>
      <span class="amt${c.free ? ' is-free' : ''}">${c.free ? 'unsold' : c.price}</span>
    </li>`).join('')}</ul>`;
}

function renderVote() {
  const { room, players, you } = state;
  $('vote-scenario').innerHTML = scenarioStrip(room.scenario);

  $('vote-list').innerHTML = players.map((p) => {
    const isSelf = p.id === you.id;
    const picked = you.vote === p.id;
    return `<article class="vote-card${picked ? ' is-picked' : ''}${isSelf ? ' is-self' : ''}">
      <div class="vote-card__head">
        <h4>${esc(p.name)}</h4>
        <span class="label">${p.budget} unspent</span>
      </div>
      ${crewList(p)}
      ${p.line ? `<p class="vote-card__line">${esc(p.line)}</p>` : ''}
      ${isSelf
        ? '<span class="label">Your crew</span>'
        : `<button class="btn ${picked ? 'btn--primary' : ''}" data-vote="${p.id}">${picked ? 'Voted ✓' : 'Vote for this crew'}</button>`}
    </article>`;
  }).join('');
}

/* --------------------------------------------------------------- results */

function renderResults() {
  const { room, players } = state;
  const r = room.results;
  if (!r) return;

  const byId = new Map(players.map((p) => [p.id, p]));
  const champion = r.scored[0];

  $('results-headline').textContent = r.tie
    ? 'A split decision'
    : (champion && champion.votes > 0 ? `${champion.name} takes the round` : 'Nobody convinced anybody');
  $('results-sub').textContent = `${r.scenario.title} · round ${r.round}`;
  $('results-sub').className = 'label';

  $('results-list').innerHTML = r.scored.map((s, i) => {
    const p = byId.get(s.id) || {};
    const won = r.winnerIds.includes(s.id);
    return `<div class="result-row${won ? ' is-winner' : ''}">
      <div class="result-row__rank">${i + 1}</div>
      <div>
        <div class="result-row__name">${esc(s.name)}</div>
        <div class="result-row__sub">${s.votes} vote${s.votes === 1 ? '' : 's'} · spent ${s.spent}</div>
        ${p.roster ? crewList(p) : ''}
        ${p.line ? `<p class="result-row__pitch">${esc(p.line)}</p>` : ''}
      </div>
      <div class="result-row__score">
        <strong>+${s.points}</strong>
        <div class="result-row__sub">${p.score || 0} total</div>
      </div>
    </div>`;
  }).join('');

  const isHost = state.you && state.you.isHost;
  $('btn-next-round').disabled = !isHost;
  $('btn-to-lobby').disabled = !isHost;
}

/* ------------------------------------------------------------------ chat */

function renderChat() {
  const log = $('chat-log');
  const chat = state.chat || [];
  const newest = chat.length ? chat[chat.length - 1].id : null;
  if (newest === lastChatId) return;

  if (lastChatId && !chatOpen) {
    unread += 1;
    $('chat-badge').textContent = unread > 9 ? '9+' : unread;
    $('chat-badge').classList.remove('hidden');
  }
  lastChatId = newest;

  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.innerHTML = chat.map((m) => (m.system
    ? `<li class="is-system">${esc(m.text)}</li>`
    : `<li><b>${esc(m.name)}</b> ${esc(m.text)}</li>`)).join('');
  if (atBottom) log.scrollTop = log.scrollHeight;
}

/* ---------------------------------------------------------------- events */

function goHome() {
  store.room = '';
  state = null;
  history.replaceState(null, '', location.pathname);
  $('view-game').classList.add('hidden');
  $('view-home').classList.remove('hidden');
}

$('btn-create').addEventListener('click', () => {
  const name = $('input-name').value.trim();
  if (!name) return toast('Put a name in first.');
  store.name = name;
  send({ type: 'create', playerId: store.playerId || undefined, name });
});

$('form-join').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('input-name').value.trim();
  const code = $('input-code').value.trim().toUpperCase();
  if (!name) return toast('Put a name in first.');
  if (!code) return toast('Room code?');
  store.name = name;
  send({ type: 'join', roomCode: code, playerId: store.playerId || undefined, name });
});

$('btn-roomcode').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${state ? state.room.code : ''}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied.', true);
  } catch {
    toast(url);
  }
});

$('btn-leave').addEventListener('click', () => {
  if (!confirm('Leave the room?')) return;
  send({ type: 'leave' });
  goHome();
});

$('btn-start').addEventListener('click', () => send({ type: 'start' }));
$('btn-next-round').addEventListener('click', () => send({ type: 'start' }));
$('btn-to-lobby').addEventListener('click', () => send({ type: 'lobby' }));
$('btn-advance').addEventListener('click', () => send({ type: 'advance' }));

for (const input of document.querySelectorAll('[data-setting]')) {
  input.addEventListener('change', () => {
    send({ type: 'settings', settings: { [input.dataset.setting]: Number(input.value) } });
  });
}

for (const btn of document.querySelectorAll('[data-bid-step]')) {
  btn.addEventListener('click', () => send({ type: 'bid', amount: bidAmountFor(Number(btn.dataset.bidStep)) }));
}

$('form-bid').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Number($('input-bid').value);
  if (!amount) return;
  send({ type: 'bid', amount });
  $('input-bid').value = '';
});

$('mvp-grid').addEventListener('click', (e) => {
  const card = e.target.closest('[data-mvp]');
  if (card) send({ type: 'mvp', mvpId: card.dataset.mvp });
});

$('btn-pitch').addEventListener('click', () => {
  send({ type: 'pitch', mvpId: state.you.mvpId, line: $('input-line').value });
});

$('input-line').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state && state.you.mvpId && !state.you.pitchSubmitted) {
    send({ type: 'pitch', mvpId: state.you.mvpId, line: $('input-line').value });
  }
});

$('vote-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-vote]');
  if (btn) send({ type: 'vote', targetId: btn.dataset.vote });
});

function setChat(open) {
  chatOpen = open;
  $('chat').classList.toggle('hidden', !open);
  if (open) {
    unread = 0;
    $('chat-badge').classList.add('hidden');
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
    $('input-chat').focus();
  }
}
$('btn-chat-toggle').addEventListener('click', () => setChat(!chatOpen));
$('btn-chat-close').addEventListener('click', () => setChat(false));

$('form-chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('input-chat').value.trim();
  if (!text) return;
  send({ type: 'chat', text });
  $('input-chat').value = '';
});

// Keyboard: B raises by 1 during the auction, as long as you are not typing.
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (!state || state.room.phase !== 'auction') return;
  if (e.key === 'b' || e.key === 'B') send({ type: 'bid', amount: bidAmountFor(1) });
});

/* ------------------------------------------------------------------ boot */

$('input-name').value = store.name;
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('input-code').value = urlRoom.toUpperCase();
connect();
