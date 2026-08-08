'use strict';

/* Engine tests. No sockets, no timers -- the clock is advanced by hand so a
   full game runs in milliseconds. Run with: npm test */

const assert = require('assert');
const { Room, RoomStore, MAX_PLAYERS } = require('../server/game');
const { CHARACTERS } = require('../server/data/characters');
const { SCENARIOS } = require('../server/data/scenarios');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

function makeRoom(playerCount = 4, settings = {}) {
  const room = new Room('TEST');
  for (let i = 0; i < playerCount; i++) room.addPlayer(`p${i}`, `Player ${i}`);
  room.updateSettings(settings);
  return room;
}

/** Force the current phase/lot clock to expire and let the room react. */
function expire(room) {
  room.deadline = Date.now() - 1;
  room.tick();
}

/* ------------------------------------------------------------ data sanity */

test('character pool is large enough for a full table', () => {
  const max = MAX_PLAYERS * 7; // biggest table x biggest roster
  assert.ok(CHARACTERS.length >= max, `${CHARACTERS.length} cards for ${max} slots`);
});

test('character and scenario ids are unique', () => {
  assert.strictEqual(new Set(CHARACTERS.map((c) => c.id)).size, CHARACTERS.length);
  assert.strictEqual(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
});

test('every character carries the fields the UI renders', () => {
  for (const c of CHARACTERS) {
    assert.ok(c.name && c.emoji && c.tag && c.role, `${c.id} missing a field`);
    assert.ok(Array.isArray(c.traits) && c.traits.length >= 2, `${c.id} needs traits`);
  }
});

test('card text stays short enough to scan, not read', () => {
  for (const c of CHARACTERS) {
    assert.ok(c.role.length <= 40, `${c.id} role too long: ${c.role}`);
    for (const t of c.traits) assert.ok(t.length <= 32, `${c.id} trait too long: ${t}`);
  }
  for (const s of SCENARIOS) {
    assert.ok(s.setup.length <= 110, `${s.id} setup too long (${s.setup.length})`);
    assert.strictEqual(s.stakes.length, 3, `${s.id} should have three stakes`);
    for (const t of s.stakes) assert.ok(t.length <= 34, `${s.id} stake too long: ${t}`);
  }
});

/* ---------------------------------------------------------------- lobby */

test('a room needs two players to start', () => {
  const room = makeRoom(1);
  assert.strictEqual(room.canStart(), false);
  assert.ok(room.startRound().error);
  room.addPlayer('p1', 'Second');
  assert.strictEqual(room.canStart(), true);
});

test('settings are clamped to sane ranges', () => {
  const room = makeRoom(2);
  room.updateSettings({ budget: 99999, rosterSize: 1, bidSeconds: 0 });
  assert.strictEqual(room.settings.budget, 500);
  assert.strictEqual(room.settings.rosterSize, 3);
  assert.strictEqual(room.settings.bidSeconds, 5);
});

test('host passes to another player when the host leaves', () => {
  const room = makeRoom(3);
  assert.strictEqual(room.hostId, 'p0');
  room.removePlayer('p0');
  assert.strictEqual(room.hostId, 'p1');
});

/* -------------------------------------------------------------- bidding */

test('reserve rule keeps a credit for every unfilled slot', () => {
  const room = makeRoom(2, { budget: 100, rosterSize: 5 });
  room.startRound();
  const p = room.players.get('p0');
  assert.strictEqual(room.maxBidFor(p), 96); // 100 - 4 remaining slots
  p.roster.push({ id: 'x', price: 10 });
  p.budget -= 10;
  assert.strictEqual(room.maxBidFor(p), 87); // 90 - 3 remaining slots
});

test('bids below the minimum and above the cap are rejected', () => {
  const room = makeRoom(2, { budget: 50, rosterSize: 5 });
  room.startRound();
  assert.ok(room.placeBid('p0', 0).error, 'zero should be rejected');
  assert.ok(room.placeBid('p0', 999).error, 'over-cap should be rejected');
  assert.ok(room.placeBid('p0', 10).ok);
  assert.ok(room.placeBid('p1', 10).error, 'must beat the standing bid');
  assert.ok(room.placeBid('p0', 12).error, 'cannot outbid yourself');
  assert.ok(room.placeBid('p1', 11).ok);
});

test('each bid resets the clock', () => {
  const room = makeRoom(2, { bidSeconds: 10, openSeconds: 30 });
  room.startRound();
  const before = room.deadline;
  room.placeBid('p0', 5);
  assert.ok(room.deadline < before, 'clock should shorten to the bid window');
  const afterFirst = room.deadline;
  room.placeBid('p1', 6);
  assert.ok(room.deadline >= afterFirst, 'clock should extend on a counter-bid');
});

test('a won lot is charged and added to the roster', () => {
  const room = makeRoom(2, { budget: 100, rosterSize: 5 });
  room.startRound();
  const name = room.lot.character.name;
  room.placeBid('p1', 17);
  expire(room); // resolve
  const winner = room.players.get('p1');
  assert.strictEqual(winner.budget, 83);
  assert.strictEqual(winner.roster.length, 1);
  assert.strictEqual(winner.roster[0].name, name);
  assert.strictEqual(winner.roster[0].price, 17);
  assert.strictEqual(room.lot.status, 'sold');
});

test('a lot with no bids goes to the bargain bin', () => {
  const room = makeRoom(2);
  room.startRound();
  const name = room.lot.character.name;
  expire(room);
  assert.strictEqual(room.lot.status, 'passed');
  assert.ok(room.unsold.some((c) => c.name === name));
});

test('a player with a full roster cannot bid', () => {
  const room = makeRoom(2, { rosterSize: 3 });
  room.startRound();
  const p = room.players.get('p0');
  p.roster = [{}, {}, {}];
  assert.ok(room.placeBid('p0', 1).error);
  assert.strictEqual(room.maxBidFor(p), 0);
});

/* ------------------------------------------------------ full round drive */

/** Play an entire auction with greedy-ish bidders until the phase moves on. */
function runAuction(room) {
  let guard = 0;
  while (room.phase === 'auction' && guard++ < 5000) {
    if (room.lot && room.lot.status === 'bidding') {
      for (const p of room.eligibleBidders()) {
        // Bid on roughly two thirds of lots, at a random affordable price.
        if (Math.random() < 0.66) {
          const min = room.minNextBid();
          const max = room.maxBidFor(p);
          if (max >= min) room.placeBid(p.id, min + Math.floor(Math.random() * Math.min(6, max - min + 1)));
        }
      }
    }
    expire(room);
  }
  assert.ok(guard < 5000, 'auction failed to terminate');
}

test('auction fills every roster exactly and never overdraws a budget', () => {
  for (const playerCount of [2, 3, 5, 8]) {
    const room = makeRoom(playerCount, { budget: 100, rosterSize: 5 });
    room.startRound();
    runAuction(room);
    for (const p of room.activePlayers()) {
      assert.strictEqual(p.roster.length, 5, `${playerCount}p: ${p.name} has ${p.roster.length}`);
      assert.ok(p.budget >= 0, `${p.name} went negative`);
      const spent = p.roster.reduce((sum, c) => sum + c.price, 0);
      assert.strictEqual(p.budget, 100 - spent, `${p.name} ledger mismatch`);
    }
  }
});

test('nobody is drafted onto two rosters at once', () => {
  const room = makeRoom(6, { budget: 120, rosterSize: 5 });
  room.startRound();
  runAuction(room);
  const seen = new Set();
  for (const p of room.activePlayers()) {
    for (const c of p.roster) {
      assert.ok(!seen.has(c.id), `${c.name} was drafted twice`);
      seen.add(c.id);
    }
  }
});

test('even a stingy table ends with full rosters via the bargain bin', () => {
  const room = makeRoom(4, { budget: 100, rosterSize: 5 });
  room.startRound();
  let guard = 0;
  while (room.phase === 'auction' && guard++ < 5000) expire(room); // nobody ever bids
  for (const p of room.activePlayers()) {
    assert.strictEqual(p.roster.length, 5);
    assert.ok(p.roster.every((c) => c.free), 'unbid rosters should be free fills');
    assert.strictEqual(p.budget, 100);
  }
});

test('the scenario stays hidden until the money is spent', () => {
  const room = makeRoom(3);
  room.startRound();
  assert.strictEqual(room.scenario, null);
  assert.strictEqual(room.stateFor('p0').room.scenario, null);
  runAuction(room);
  assert.strictEqual(room.phase, 'reveal');
  assert.ok(room.scenario && room.scenario.title);
  assert.ok(room.stateFor('p0').room.scenario.title);
});

test('rosters are private during the auction and public afterwards', () => {
  const room = makeRoom(3);
  room.startRound();
  room.placeBid('p1', 4);
  expire(room);
  const duringAuction = room.stateFor('p0');
  const p1View = duringAuction.players.find((p) => p.id === 'p1');
  assert.strictEqual(p1View.roster.length, 0, 'other rosters must be hidden');
  assert.strictEqual(p1View.rosterCount, 1, 'but the count is public');

  runAuction(room);
  const afterReveal = room.stateFor('p0');
  assert.ok(afterReveal.players.find((p) => p.id === 'p1').roster.length > 0);
});

/* --------------------------------------------------------- pitch to score */

test('an MVP must come off your own roster', () => {
  const room = makeRoom(3);
  room.startRound();
  runAuction(room);
  room.startPitch();
  const mine = room.players.get('p0').roster[0].id;
  const theirs = room.players.get('p1').roster[0].id;
  assert.ok(room.setMvp('p0', theirs).error, 'cannot nominate someone else’s signing');
  assert.ok(room.setMvp('p0', 'nobody').error);
  assert.ok(room.setMvp('p0', mine).ok);
  assert.strictEqual(room.players.get('p0').mvpId, mine);
});

test('going ready without a star nominates your priciest signing', () => {
  const room = makeRoom(3, { budget: 100, rosterSize: 5 });
  room.startRound();
  runAuction(room);
  room.startPitch();

  assert.ok(room.submitPitch('p0', { line: 'Trust me on this one.' }).ok);
  const p = room.players.get('p0');
  const priciest = p.roster.reduce((best, c) => (c.price > best.price ? c : best), p.roster[0]);
  assert.strictEqual(p.mvpId, priciest.id);
  assert.strictEqual(p.pitchSubmitted, true);
});

test('picks and one-liners are sealed until voting opens', () => {
  const room = makeRoom(3);
  room.startRound();
  runAuction(room);
  room.startPitch();
  const mvp = room.players.get('p1').roster[0].id;
  room.submitPitch('p1', { mvpId: mvp, line: 'He has done this before.' });

  const seenByOther = room.stateFor('p0').players.find((p) => p.id === 'p1');
  assert.strictEqual(seenByOther.line, '', 'one-liner leaked');
  assert.strictEqual(seenByOther.mvpId, null, 'MVP leaked');
  assert.strictEqual(seenByOther.pitchSubmitted, true, 'readiness is public');

  const seenBySelf = room.stateFor('p1').players.find((p) => p.id === 'p1');
  assert.strictEqual(seenBySelf.mvpId, mvp);

  room.submitPitch('p0', { mvpId: room.players.get('p0').roster[0].id });
  room.submitPitch('p2', { mvpId: room.players.get('p2').roster[0].id });
  assert.strictEqual(room.phase, 'vote', 'everyone ready should open the vote');
  const now = room.stateFor('p0').players.find((p) => p.id === 'p1');
  assert.strictEqual(now.mvpId, mvp);
  assert.match(now.line, /done this before/);
});

test('the defence is capped at about two lines and tidied', () => {
  const room = makeRoom(2);
  room.startRound();
  runAuction(room);
  room.startPitch();
  room.submitPitch('p0', { mvpId: room.players.get('p0').roster[0].id, line: `  lots   of    space ${'x'.repeat(300)}` });
  const line = room.players.get('p0').line;
  assert.strictEqual(line.length, 160);
  assert.ok(line.startsWith('lots of space'), 'whitespace should collapse');
});

test('running out the clock nominates your priciest signing', () => {
  const room = makeRoom(2, { budget: 100, rosterSize: 5 });
  room.startRound();
  runAuction(room);
  room.startPitch();
  room.startVote(); // nobody picked anything
  for (const p of room.activePlayers()) {
    const priciest = p.roster.reduce((best, c) => (c.price > best.price ? c : best), p.roster[0]);
    assert.strictEqual(p.mvpId, priciest.id, `${p.name} should default to their big buy`);
  }
});

test('self-votes are refused and votes stay secret until results', () => {
  const room = makeRoom(3);
  room.startRound();
  runAuction(room);
  room.startPitch();
  room.startVote();

  assert.ok(room.castVote('p0', 'p0').error);
  assert.ok(room.castVote('p0', 'nobody').error);
  assert.ok(room.castVote('p0', 'p1').ok);

  const otherView = room.stateFor('p2').players.find((p) => p.id === 'p0');
  assert.strictEqual(otherView.vote, null, 'vote target leaked');
  assert.strictEqual(otherView.voted, true, 'having voted is public');
});

test('scoring pays three per vote plus an outright-win bonus', () => {
  const room = makeRoom(3);
  room.startRound();
  runAuction(room);
  room.startPitch();
  room.startVote();
  room.castVote('p0', 'p1');
  room.castVote('p2', 'p1');
  room.castVote('p1', 'p0');
  assert.strictEqual(room.phase, 'results');

  const p1 = room.players.get('p1');
  assert.strictEqual(p1.roundVotes, 2);
  assert.strictEqual(p1.score, 8);  // 2 votes x3, +2 outright
  assert.strictEqual(p1.wins, 1);
  assert.strictEqual(room.players.get('p0').score, 3);
  assert.deepStrictEqual(room.lastResults.winnerIds, ['p1']);
  assert.strictEqual(room.lastResults.tie, false);
});

test('a tie awards no win bonus', () => {
  const room = makeRoom(2);
  room.startRound();
  runAuction(room);
  room.startPitch();
  room.startVote();
  room.castVote('p0', 'p1');
  room.castVote('p1', 'p0');
  assert.strictEqual(room.lastResults.tie, true);
  assert.strictEqual(room.players.get('p0').score, 3);
  assert.strictEqual(room.players.get('p1').wins, 0);
});

test('scores carry across rounds and scenarios do not repeat', () => {
  const room = makeRoom(3);
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    room.startRound();
    runAuction(room);
    room.startPitch();
    room.startVote();
    room.castVote('p0', 'p1');
    room.castVote('p1', 'p2');
    room.castVote('p2', 'p1');
    assert.ok(!seen.has(room.scenario.id), 'scenario repeated too early');
    seen.add(room.scenario.id);
  }
  assert.strictEqual(room.round, 4);
  assert.strictEqual(room.players.get('p1').score, 4 * 8);
  assert.strictEqual(room.players.get('p1').wins, 4);
});

test('a disconnected player does not stall the pitch or vote gates', () => {
  const room = makeRoom(3);
  room.startRound();
  runAuction(room);
  room.startPitch();
  room.players.get('p2').connected = false;
  room.submitPitch('p0', { mvpId: room.players.get('p0').roster[0].id });
  room.submitPitch('p1', { mvpId: room.players.get('p1').roster[0].id });
  assert.strictEqual(room.phase, 'vote', 'connected players are the quorum');
  room.castVote('p0', 'p1');
  room.castVote('p1', 'p0');
  assert.strictEqual(room.phase, 'results');
});

test('host skip resolves whatever is on screen', () => {
  const room = makeRoom(3);
  room.startRound();
  room.placeBid('p0', 3);
  room.forceAdvance();
  assert.strictEqual(room.lot.status, 'sold');

  runAuction(room);
  assert.strictEqual(room.phase, 'reveal');
  room.forceAdvance();
  assert.strictEqual(room.phase, 'pitch');
  room.forceAdvance();
  assert.strictEqual(room.phase, 'vote');
  room.forceAdvance();
  assert.strictEqual(room.phase, 'results');
});

/* --------------------------------------------------------------- storage */

test('room store issues unique codes and sweeps empty rooms', () => {
  const store = new RoomStore();
  const codes = new Set();
  for (let i = 0; i < 200; i++) codes.add(store.create().code);
  assert.strictEqual(codes.size, 200);

  const room = store.create();
  room.lastActivity = Date.now() - 1000 * 60 * 120;
  store.sweep();
  assert.strictEqual(store.get(room.code), undefined);
});

test('room lookup is case and whitespace insensitive', () => {
  const store = new RoomStore();
  const room = store.create();
  assert.strictEqual(store.get(` ${room.code.toLowerCase()} `), room);
});

console.log(`\n${passed} passing`);
