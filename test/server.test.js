'use strict';

/* End-to-end smoke test: boots the real HTTP + WebSocket server and plays a
   full round through the wire with three clients. Run with: npm run test:e2e */

const assert = require('assert');
const WebSocket = require('ws');

process.env.PORT = process.env.PORT || '3999';
const { server } = require('../server/index');

const PORT = process.env.PORT;
const URL = `ws://127.0.0.1:${PORT}/ws`;

function connect() {
  const ws = new WebSocket(URL);
  const client = { ws, state: null, joined: null, errors: [] };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'state') client.state = msg;
    if (msg.type === 'joined') client.joined = msg;
    if (msg.type === 'error') client.errors.push(msg.message);
  });
  client.send = (payload) => ws.send(JSON.stringify(payload));
  return new Promise((resolve) => ws.on('open', () => resolve(client)));
}

/** Poll until `check` passes or we run out of patience. */
async function until(check, label, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));

  const host = await connect();
  const a = await connect();
  const b = await connect();

  await test('host creates a room and gets a code', async () => {
    host.send({ type: 'create', name: 'Host' });
    await until(() => host.joined, 'join ack');
    assert.match(host.joined.roomCode, /^[A-Z0-9]{4}$/);
  });

  const code = host.joined.roomCode;

  await test('players join and everyone sees the same table', async () => {
    a.send({ type: 'join', roomCode: code, name: 'Ana' });
    b.send({ type: 'join', roomCode: code.toLowerCase(), name: 'Bo' });
    await until(() => host.state && host.state.players.length === 3, 'three players');
    assert.deepStrictEqual(host.state.players.map((p) => p.name), ['Host', 'Ana', 'Bo']);
    assert.strictEqual(host.state.you.isHost, true);
    assert.strictEqual(a.state.you.isHost, false);
  });

  await test('duplicate names are disambiguated', async () => {
    const dupe = await connect();
    dupe.send({ type: 'join', roomCode: code, name: 'Ana' });
    await until(() => host.state.players.length === 4, 'fourth player');
    assert.strictEqual(host.state.players[3].name, 'Ana 2');
    dupe.send({ type: 'leave' });
    await until(() => host.state.players.length === 3, 'back to three');
    dupe.ws.close();
  });

  await test('non-hosts cannot change settings or start', async () => {
    a.errors.length = 0;
    a.send({ type: 'settings', settings: { budget: 10 } });
    a.send({ type: 'start' });
    await until(() => a.errors.length >= 2, 'two refusals');
    assert.ok(a.errors.every((e) => /host/i.test(e)));
  });

  await test('host settings propagate to every client', async () => {
    host.send({ type: 'settings', settings: { budget: 60, rosterSize: 3, bidSeconds: 5, openSeconds: 6 } });
    await until(() => b.state.room.settings.budget === 60, 'budget synced');
    assert.strictEqual(b.state.room.settings.rosterSize, 3);
  });

  await test('the auction runs and rosters fill', async () => {
    host.send({ type: 'start' });
    await until(() => host.state.room.phase === 'auction', 'auction started');
    assert.strictEqual(host.state.room.scenario, null, 'scenario must stay sealed');

    // Everyone bids the minimum on whatever is up until their roster is full.
    const bidders = [host, a, b];
    const bidding = setInterval(() => {
      for (const c of bidders) {
        const s = c.state;
        if (!s || s.room.phase !== 'auction' || !s.lot || s.lot.status !== 'bidding') continue;
        if (s.you.roster.length >= s.room.settings.rosterSize) continue;
        if (s.lot.bidderId === s.you.id) continue;
        if (s.you.maxBid < s.you.minBid) continue;
        c.send({ type: 'bid', amount: s.you.minBid });
      }
    }, 50);

    // Bots that always counter-bid would extend every clock forever, so the
    // host drops the hammer once a lot has a high bidder. This also exercises
    // the host skip control.
    const gavel = setInterval(() => {
      const s = host.state;
      if (!s || s.room.phase !== 'auction' || !s.lot) return;
      if (s.lot.status !== 'bidding' || s.lot.bidderId) host.send({ type: 'advance' });
    }, 300);

    await until(() => host.state.room.phase !== 'auction', 'auction finished', 90000);
    clearInterval(bidding);
    clearInterval(gavel);

    for (const c of [host, a, b]) {
      assert.strictEqual(c.state.you.roster.length, 3, `${c.state.you.name} roster`);
      assert.ok(c.state.you.budget >= 0);
      const spent = c.state.you.roster.reduce((sum, x) => sum + x.price, 0);
      assert.strictEqual(c.state.you.budget, 60 - spent, 'ledger mismatch');
    }
    assert.ok([host, a, b].some((c) => c.state.you.budget < 60), 'nobody actually bought anything');
  });

  await test('the scenario is revealed once the money is gone', async () => {
    await until(() => host.state.room.scenario, 'scenario revealed');
    assert.ok(host.state.room.scenario.title);
    assert.strictEqual(host.state.room.scenario.id, a.state.room.scenario.id);
  });

  await test('pitches are sealed from other players until the vote', async () => {
    host.send({ type: 'advance' }); // skip the reveal beat
    await until(() => host.state.room.phase === 'pitch', 'pitch phase');

    a.send({ type: 'pitch', text: 'The mortician is load-bearing here.' });
    await until(() => host.state.players.find((p) => p.name === 'Ana').pitchSubmitted, 'ana ready');
    assert.strictEqual(host.state.players.find((p) => p.name === 'Ana').pitch, '');

    host.send({ type: 'pitch', text: 'Mine is a masterpiece.' });
    b.send({ type: 'pitch', text: 'I panicked and bought clowns.' });
    await until(() => host.state.room.phase === 'vote', 'vote phase');
    assert.match(host.state.players.find((p) => p.name === 'Ana').pitch, /load-bearing/);
  });

  await test('votes resolve into scores', async () => {
    host.errors.length = 0;
    host.send({ type: 'vote', targetId: host.state.you.id }); // self-vote, refused
    await until(() => host.errors.length === 1, 'self-vote refused');

    const ids = Object.fromEntries(host.state.players.map((p) => [p.name, p.id]));
    host.send({ type: 'vote', targetId: ids.Ana });
    b.send({ type: 'vote', targetId: ids.Ana });
    a.send({ type: 'vote', targetId: ids.Bo });

    await until(() => host.state.room.phase === 'results', 'results');
    const results = host.state.room.results;
    assert.strictEqual(results.scored[0].name, 'Ana');
    assert.strictEqual(results.scored[0].votes, 2);
    assert.strictEqual(results.scored[0].points, 8);
    assert.deepStrictEqual(results.winnerIds, [ids.Ana]);
  });

  await test('a reconnecting player keeps their seat and roster', async () => {
    const playerId = a.state.you.id;
    const roster = a.state.you.roster.map((c) => c.id);
    a.ws.close();
    await until(() => host.state.players.find((p) => p.id === playerId).connected === false, 'marked away');

    const back = await connect();
    back.send({ type: 'join', roomCode: code, playerId, name: 'Ana' });
    await until(() => back.state && back.state.you, 'rejoined');
    assert.deepStrictEqual(back.state.you.roster.map((c) => c.id), roster);
    assert.strictEqual(back.state.you.score, 8);
    back.ws.close();
  });

  await test('chat is broadcast to the room', async () => {
    b.send({ type: 'chat', text: 'the clowns were a strategic buy' });
    await until(() => host.state.chat.some((m) => /strategic buy/.test(m.text)), 'chat delivered');
    const line = host.state.chat.find((m) => /strategic buy/.test(m.text));
    assert.strictEqual(line.name, 'Bo');
  });

  await test('joining a game in progress is refused', async () => {
    host.send({ type: 'start' });
    await until(() => host.state.room.phase === 'auction', 'round two');
    const late = await connect();
    late.send({ type: 'join', roomCode: code, name: 'Latecomer' });
    await until(() => late.errors.length > 0, 'refusal');
    assert.match(late.errors[0], /already under way/);
    late.ws.close();
  });

  await test('unknown room codes are rejected', async () => {
    const stray = await connect();
    stray.send({ type: 'join', roomCode: 'ZZZZ', name: 'Nobody' });
    await until(() => stray.errors.length > 0, 'refusal');
    assert.match(stray.errors[0], /No room/);
    stray.ws.close();
  });

  for (const c of [host, b]) c.ws.close();
  server.close();
  console.log(`\n${passed} passing`);
  setTimeout(() => process.exit(process.exitCode || 0), 250);
})();
