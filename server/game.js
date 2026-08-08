'use strict';

const { CHARACTERS } = require('./data/characters');
const { SCENARIOS } = require('./data/scenarios');

/* ------------------------------------------------------------------ utils */

// Ambiguous characters (0/O, 1/I/L) are left out so codes survive being read
// aloud over a call, which is how most of these rooms actually get shared.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode(len = 4) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nowMs() {
  return Date.now();
}

const PHASES = ['lobby', 'auction', 'reveal', 'pitch', 'vote', 'results'];

const DEFAULT_SETTINGS = {
  budget: 100,
  rosterSize: 5,
  bidSeconds: 10,      // clock after each bid
  openSeconds: 14,     // clock when a lot first hits the block
  pitchSeconds: 60,    // one tap and an optional line -- no essays
  voteSeconds: 45,
};

const LIMITS = {
  budget: [20, 500],
  rosterSize: [3, 7],
  bidSeconds: [5, 30],
  openSeconds: [6, 40],
  pitchSeconds: [20, 600],
  voteSeconds: [15, 300],
};

// The defence is what everybody reads and votes on. Capped at roughly two
// lines -- long enough to make a case, short enough that nobody is typing an
// essay while four people wait.
const LINE_MAX = 160;

const MAX_PLAYERS = 8;
const SOLD_PAUSE_MS = 2600;
const PASSED_PAUSE_MS = 1800;
const REVEAL_MS = 9000;
const CHAT_HISTORY = 60;

/* ------------------------------------------------------------------- room */

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();       // playerId -> player
    this.order = [];                // playerIds, stable seating order
    this.hostId = null;
    this.phase = 'lobby';
    this.settings = { ...DEFAULT_SETTINGS };
    this.round = 0;
    this.deadline = null;           // epoch ms for the current phase/lot clock
    this.chat = [];
    this.createdAt = nowMs();
    this.lastActivity = nowMs();
    this.dirty = false;

    // auction state
    this.lots = [];
    this.lotIndex = -1;
    this.lot = null;                // { character, bid, bidderId, status, history }
    this.unsold = [];
    this.soldLog = [];

    // scenario state
    this.scenario = null;
    this.usedScenarioIds = [];
    this.lastResults = null;
  }

  touch() {
    this.lastActivity = nowMs();
    this.dirty = true;
  }

  /* ------------------------------------------------------------- players */

  addPlayer(playerId, name) {
    const player = {
      id: playerId,
      name,
      connected: true,
      budget: this.settings.budget,
      roster: [],
      mvpId: null,
      line: '',
      pitchSubmitted: false,
      vote: null,
      score: 0,
      roundVotes: 0,
      wins: 0,
      joinedAt: nowMs(),
    };
    this.players.set(playerId, player);
    this.order.push(playerId);
    if (!this.hostId) this.hostId = playerId;
    this.touch();
    return player;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    this.order = this.order.filter((id) => id !== playerId);
    if (this.hostId === playerId) this.hostId = this.order[0] || null;
    this.touch();
  }

  activePlayers() {
    return this.order.map((id) => this.players.get(id)).filter(Boolean);
  }

  connectedPlayers() {
    return this.activePlayers().filter((p) => p.connected);
  }

  /** Everyone still able to raise a hand on the current lot. */
  eligibleBidders() {
    return this.activePlayers().filter(
      (p) => p.roster.length < this.settings.rosterSize && this.maxBidFor(p) >= this.minNextBid(),
    );
  }

  /**
   * A player must keep one credit in reserve for every roster slot they still
   * have to fill after this lot, otherwise late slots become unfillable and the
   * auction stops being a real budget decision.
   */
  maxBidFor(player) {
    const empty = this.settings.rosterSize - player.roster.length;
    if (empty <= 0) return 0;
    return player.budget - (empty - 1);
  }

  minNextBid() {
    return this.lot ? this.lot.bid + 1 : 1;
  }

  /* ------------------------------------------------------------ settings */

  updateSettings(patch) {
    if (this.phase !== 'lobby') return;
    for (const [key, range] of Object.entries(LIMITS)) {
      if (!(key in patch)) continue;
      const raw = Number(patch[key]);
      if (!Number.isFinite(raw)) continue;
      const value = Math.round(raw);
      this.settings[key] = Math.min(range[1], Math.max(range[0], value));
    }
    if (this.settings.openSeconds < this.settings.bidSeconds) {
      this.settings.openSeconds = this.settings.bidSeconds;
    }
    for (const p of this.players.values()) {
      if (p.roster.length === 0) p.budget = this.settings.budget;
    }
    this.touch();
  }

  /* ------------------------------------------------------------- auction */

  canStart() {
    return this.connectedPlayers().length >= 2;
  }

  startRound() {
    const players = this.activePlayers();
    if (players.length < 2) return { error: 'You need at least two players.' };

    this.round += 1;
    for (const p of players) {
      p.budget = this.settings.budget;
      p.roster = [];
      p.mvpId = null;
      p.line = '';
      p.pitchSubmitted = false;
      p.vote = null;
      p.roundVotes = 0;
    }

    this.lots = this.buildLotOrder(players.length);
    this.lotIndex = -1;
    this.lot = null;
    this.unsold = [];
    this.soldLog = [];
    this.scenario = null;
    this.lastResults = null;
    this.phase = 'auction';
    this.pushSystemChat(`Round ${this.round}: the block is open. Nobody knows the scenario yet.`);
    this.nextLot();
    return { ok: true };
  }

  /**
   * Lot list is a stratified shuffle: the loud cards get spread through the
   * running order so the first five lots are not all obvious bargains (or all
   * obvious stars, which turns the opening into a budget bloodbath).
   */
  buildLotOrder(playerCount) {
    const needed = playerCount * this.settings.rosterSize;
    const extras = Math.max(4, Math.round(needed * 0.5));
    const target = Math.min(CHARACTERS.length, needed + extras);

    const byTier = new Map();
    for (const c of shuffle(CHARACTERS)) {
      const tier = c.tier || 1;
      if (!byTier.has(tier)) byTier.set(tier, []);
      byTier.get(tier).push(c);
    }
    const buckets = [...byTier.keys()].sort((a, b) => b - a).map((t) => byTier.get(t));

    const picked = [];
    let i = 0;
    while (picked.length < target) {
      const bucket = buckets[i % buckets.length];
      if (bucket.length) picked.push(bucket.pop());
      i++;
      if (buckets.every((b) => b.length === 0)) break;
    }
    return shuffle(picked).slice(0, target);
  }

  nextLot() {
    const rosterSize = this.settings.rosterSize;
    const everyoneFull = this.activePlayers().every((p) => p.roster.length >= rosterSize);
    if (everyoneFull || this.lotIndex + 1 >= this.lots.length) {
      this.endAuction();
      return;
    }
    this.lotIndex += 1;
    this.lot = {
      character: this.lots[this.lotIndex],
      bid: 0,
      bidderId: null,
      status: 'bidding',
      history: [],
    };
    this.deadline = nowMs() + this.settings.openSeconds * 1000;
    this.touch();
  }

  placeBid(playerId, amount) {
    if (this.phase !== 'auction' || !this.lot || this.lot.status !== 'bidding') {
      return { error: 'Bidding is closed.' };
    }
    const player = this.players.get(playerId);
    if (!player) return { error: 'You are not in this room.' };
    if (player.roster.length >= this.settings.rosterSize) {
      return { error: 'Your roster is full.' };
    }
    const value = Math.round(Number(amount));
    if (!Number.isFinite(value)) return { error: 'That is not a bid.' };
    if (value < this.minNextBid()) {
      return { error: `Bid must be at least ${this.minNextBid()}.` };
    }
    const max = this.maxBidFor(player);
    if (value > max) {
      const empty = this.settings.rosterSize - player.roster.length;
      return {
        error: empty > 1
          ? `Max ${max} — you must keep ${empty - 1} credit${empty - 1 === 1 ? '' : 's'} for your empty slots.`
          : `Max ${max} — that is everything you have.`,
      };
    }
    if (this.lot.bidderId === playerId) return { error: 'You are already the high bid.' };

    this.lot.bid = value;
    this.lot.bidderId = playerId;
    this.lot.history.push({ playerId, name: player.name, amount: value, at: nowMs() });
    // Every bid resets the clock, so a bidding war extends itself.
    this.deadline = nowMs() + this.settings.bidSeconds * 1000;
    this.touch();
    return { ok: true };
  }

  resolveLot() {
    const lot = this.lot;
    if (!lot || lot.status !== 'bidding') return;

    if (lot.bidderId) {
      const winner = this.players.get(lot.bidderId);
      if (winner) {
        winner.budget -= lot.bid;
        winner.roster.push({ ...lot.character, price: lot.bid, free: false });
        this.soldLog.push({
          character: lot.character.name,
          emoji: lot.character.emoji,
          price: lot.bid,
          winnerId: winner.id,
          winnerName: winner.name,
        });
      }
      lot.status = 'sold';
      this.deadline = nowMs() + SOLD_PAUSE_MS;
    } else {
      this.unsold.push(lot.character);
      lot.status = 'passed';
      this.deadline = nowMs() + PASSED_PAUSE_MS;
    }
    this.touch();
  }

  endAuction() {
    // Anyone left short gets filled from the bargain bin for free. It is a
    // punishment disguised as a gift: they are pitching with leftovers.
    const bin = shuffle(this.unsold);
    for (const p of this.activePlayers()) {
      while (p.roster.length < this.settings.rosterSize && bin.length) {
        p.roster.push({ ...bin.pop(), price: 0, free: true });
      }
    }
    this.unsold = bin;

    const pool = SCENARIOS.filter((s) => !this.usedScenarioIds.includes(s.id));
    const choices = pool.length ? pool : SCENARIOS;
    this.scenario = choices[Math.floor(Math.random() * choices.length)];
    this.usedScenarioIds.push(this.scenario.id);

    this.lot = null;
    this.phase = 'reveal';
    this.deadline = nowMs() + REVEAL_MS;
    this.pushSystemChat('Money is spent. Envelope opening...');
    this.touch();
  }

  /* --------------------------------------------------------- pitch / vote */

  startPitch() {
    this.phase = 'pitch';
    this.deadline = nowMs() + this.settings.pitchSeconds * 1000;
    for (const p of this.activePlayers()) {
      p.mvpId = null;
      p.line = '';
      p.pitchSubmitted = false;
    }
    this.touch();
  }

  /** Tapping an MVP is the whole required interaction; the line is optional. */
  setMvp(playerId, mvpId) {
    const player = this.players.get(playerId);
    if (!player) return { error: 'You are not in this room.' };
    if (this.phase !== 'pitch' || player.pitchSubmitted) return { error: 'Too late to change that.' };
    if (!player.roster.some((c) => c.id === mvpId)) return { error: 'That one is not on your roster.' };
    player.mvpId = mvpId;
    this.touch();
    return { ok: true };
  }

  submitPitch(playerId, { mvpId, line } = {}) {
    if (this.phase !== 'pitch') return { error: 'Not the pitch phase.' };
    const player = this.players.get(playerId);
    if (!player) return { error: 'You are not in this room.' };

    if (mvpId && player.roster.some((c) => c.id === mvpId)) player.mvpId = mvpId;
    // Starring somebody is optional: skipping it nominates the big signing
    // rather than blocking a player who only wants to write their defence.
    if (!player.mvpId && player.roster.length) {
      player.mvpId = player.roster.reduce((best, c) => (c.price > best.price ? c : best), player.roster[0]).id;
    }

    player.line = String(line || '').replace(/\s+/g, ' ').trim().slice(0, LINE_MAX);
    player.pitchSubmitted = true;
    this.touch();
    if (this.connectedPlayers().every((p) => p.pitchSubmitted)) this.startVote();
    return { ok: true };
  }

  /** Anyone who ran out the clock without picking gets their priciest signing. */
  autoPickMissing() {
    for (const p of this.activePlayers()) {
      if (p.mvpId || !p.roster.length) continue;
      const priciest = p.roster.reduce((best, c) => (c.price > best.price ? c : best), p.roster[0]);
      p.mvpId = priciest.id;
    }
  }

  startVote() {
    this.autoPickMissing();
    this.phase = 'vote';
    this.deadline = nowMs() + this.settings.voteSeconds * 1000;
    for (const p of this.activePlayers()) p.vote = null;
    this.touch();
  }

  castVote(playerId, targetId) {
    if (this.phase !== 'vote') return { error: 'Not the voting phase.' };
    const player = this.players.get(playerId);
    if (!player) return { error: 'You are not in this room.' };
    if (targetId === playerId) return { error: 'You cannot vote for yourself.' };
    if (!this.players.has(targetId)) return { error: 'Unknown roster.' };
    player.vote = targetId;
    this.touch();
    if (this.connectedPlayers().every((p) => p.vote)) this.finishRound();
    return { ok: true };
  }

  finishRound() {
    const players = this.activePlayers();
    for (const p of players) p.roundVotes = 0;
    for (const p of players) {
      if (p.vote && this.players.has(p.vote)) this.players.get(p.vote).roundVotes += 1;
    }

    const scored = players.map((p) => ({
      id: p.id,
      name: p.name,
      votes: p.roundVotes,
      spent: this.settings.budget - p.budget,
      leftover: p.budget,
      points: p.roundVotes * 3,
    }));

    const topVotes = Math.max(0, ...scored.map((s) => s.votes));
    const winners = scored.filter((s) => s.votes === topVotes && topVotes > 0);
    for (const s of scored) {
      if (winners.length === 1 && s.votes === topVotes) s.points += 2; // outright win bonus
      const p = this.players.get(s.id);
      p.score += s.points;
      if (winners.length === 1 && s.votes === topVotes) p.wins += 1;
    }

    scored.sort((a, b) => b.votes - a.votes || b.leftover - a.leftover || a.name.localeCompare(b.name));
    this.lastResults = {
      round: this.round,
      scenario: this.scenario,
      scored,
      winnerIds: winners.map((w) => w.id),
      tie: winners.length > 1,
    };
    this.phase = 'results';
    this.deadline = null;

    if (winners.length === 1) {
      this.pushSystemChat(`${this.players.get(winners[0].id).name} takes round ${this.round}.`);
    } else if (winners.length > 1) {
      this.pushSystemChat(`Round ${this.round} is a dead heat.`);
    } else {
      this.pushSystemChat(`Round ${this.round} ended with nobody voting. Bleak.`);
    }
    this.touch();
  }

  backToLobby() {
    this.phase = 'lobby';
    this.deadline = null;
    this.lot = null;
    this.touch();
  }

  /* ----------------------------------------------------------- host tools */

  /** Host can shove the clock forward rather than waiting one out. */
  forceAdvance() {
    if (this.phase === 'auction' && this.lot) {
      // Mid-bid this drops the hammer; during the sold/passed beat it moves
      // straight on to the next lot.
      if (this.lot.status === 'bidding') this.resolveLot();
      else this.nextLot();
    } else if (this.phase === 'reveal') {
      this.startPitch();
    } else if (this.phase === 'pitch') {
      for (const p of this.connectedPlayers()) p.pitchSubmitted = true;
      this.startVote();
    } else if (this.phase === 'vote') {
      this.finishRound();
    }
  }

  /* ---------------------------------------------------------------- chat */

  pushChat(playerId, text) {
    const player = this.players.get(playerId);
    if (!player) return;
    const body = String(text || '').trim().slice(0, 240);
    if (!body) return;
    this.chat.push({ id: `${nowMs()}-${Math.random().toString(36).slice(2, 7)}`, name: player.name, playerId, text: body, at: nowMs() });
    if (this.chat.length > CHAT_HISTORY) this.chat = this.chat.slice(-CHAT_HISTORY);
    this.touch();
  }

  pushSystemChat(text) {
    this.chat.push({ id: `${nowMs()}-${Math.random().toString(36).slice(2, 7)}`, system: true, text, at: nowMs() });
    if (this.chat.length > CHAT_HISTORY) this.chat = this.chat.slice(-CHAT_HISTORY);
  }

  /* ---------------------------------------------------------------- clock */

  tick() {
    if (!this.deadline || nowMs() < this.deadline) return;

    switch (this.phase) {
      case 'auction':
        if (!this.lot) break;
        if (this.lot.status === 'bidding') this.resolveLot();
        else this.nextLot();
        break;
      case 'reveal':
        this.startPitch();
        break;
      case 'pitch':
        this.startVote();
        break;
      case 'vote':
        this.finishRound();
        break;
      default:
        this.deadline = null;
    }
  }

  /* ---------------------------------------------------------------- state */

  /**
   * Per-player view. Pitches stay sealed until the vote opens and votes stay
   * sealed until results, so nobody can anchor on somebody else's answer.
   */
  stateFor(playerId) {
    const revealPitches = this.phase === 'vote' || this.phase === 'results';
    const revealVotes = this.phase === 'results';
    const rostersVisible = this.phase !== 'auction' && this.phase !== 'lobby';

    const players = this.activePlayers().map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.id === this.hostId,
      budget: p.budget,
      rosterCount: p.roster.length,
      roster: (rostersVisible || p.id === playerId) ? p.roster : [],
      score: p.score,
      wins: p.wins,
      pitchSubmitted: p.pitchSubmitted,
      mvpId: revealPitches || p.id === playerId ? p.mvpId : null,
      line: revealPitches || p.id === playerId ? p.line : '',
      voted: Boolean(p.vote),
      vote: revealVotes ? p.vote : (p.id === playerId ? p.vote : null),
      roundVotes: revealVotes ? p.roundVotes : 0,
      isHighBidder: Boolean(this.lot && this.lot.bidderId === p.id),
    }));

    const me = this.players.get(playerId);

    return {
      type: 'state',
      room: {
        code: this.code,
        phase: this.phase,
        round: this.round,
        hostId: this.hostId,
        settings: this.settings,
        deadline: this.deadline,
        serverNow: nowMs(),
        maxPlayers: MAX_PLAYERS,
        lotsRemaining: Math.max(0, this.lots.length - this.lotIndex - 1),
        lotNumber: this.lotIndex + 1,
        lotTotal: this.lots.length,
        soldLog: this.soldLog.slice(-8).reverse(),
        scenario: this.phase === 'lobby' || this.phase === 'auction' ? null : this.scenario,
        results: this.phase === 'results' ? this.lastResults : null,
        canStart: this.canStart(),
      },
      lot: this.lot
        ? {
            character: this.lot.character,
            bid: this.lot.bid,
            bidderId: this.lot.bidderId,
            bidderName: this.lot.bidderId ? (this.players.get(this.lot.bidderId) || {}).name : null,
            status: this.lot.status,
            history: this.lot.history.slice(-5).reverse(),
          }
        : null,
      players,
      chat: this.chat,
      you: me
        ? {
            id: me.id,
            name: me.name,
            isHost: me.id === this.hostId,
            budget: me.budget,
            roster: me.roster,
            emptySlots: this.settings.rosterSize - me.roster.length,
            maxBid: this.maxBidFor(me),
            minBid: this.minNextBid(),
            mvpId: me.mvpId,
            line: me.line,
            pitchSubmitted: me.pitchSubmitted,
            vote: me.vote,
            score: me.score,
          }
        : null,
    };
  }
}

/* ------------------------------------------------------------------ store */

class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  create() {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase().trim());
  }

  /** Drop rooms that have been silent for a while so memory does not creep. */
  sweep(maxIdleMs = 1000 * 60 * 90) {
    const cutoff = nowMs() - maxIdleMs;
    for (const [code, room] of this.rooms) {
      const anyoneHere = room.connectedPlayers().length > 0;
      if (!anyoneHere && room.lastActivity < cutoff) this.rooms.delete(code);
    }
  }
}

module.exports = { Room, RoomStore, PHASES, DEFAULT_SETTINGS, LIMITS, MAX_PLAYERS, makeCode };
