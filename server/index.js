'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const { RoomStore, MAX_PLAYERS } = require('./game');

const PORT = process.env.PORT || 3000;
const TICK_MS = 250;
const HEARTBEAT_MS = 30000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const store = new RoomStore();

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get('/api/health', (req, res) => {
  res.json({ ok: true, rooms: store.rooms.size, uptime: process.uptime() });
});

/* ------------------------------------------------------------ connections */

/** Every open socket. `meta` is filled in once the socket joins a room. */
const clients = new Set();

function send(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function fail(ws, message) {
  send(ws, { type: 'error', message });
}

function broadcast(room) {
  for (const ws of clients) {
    if (!ws.meta || ws.meta.roomCode !== room.code) continue;
    send(ws, room.stateFor(ws.meta.playerId));
  }
}

function sanitizeName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 18);
  return name || 'Anonymous';
}

function uniqueName(room, name, playerId) {
  const taken = new Set(
    room.activePlayers().filter((p) => p.id !== playerId).map((p) => p.name.toLowerCase()),
  );
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 50; i++) {
    const candidate = `${name} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} ${Math.floor(Math.random() * 999)}`;
}

/** Attach a socket to a room, either as a new player or a returning one. */
function attach(ws, room, playerId, name) {
  const existing = room.players.get(playerId);
  if (existing) {
    existing.connected = true;
    if (name) existing.name = uniqueName(room, sanitizeName(name), playerId);
    room.touch();
  } else {
    if (room.phase !== 'lobby') {
      fail(ws, 'That game is already under way. Wait for the next round.');
      return null;
    }
    if (room.activePlayers().length >= MAX_PLAYERS) {
      fail(ws, `That room is full (${MAX_PLAYERS} players).`);
      return null;
    }
    room.addPlayer(playerId, uniqueName(room, sanitizeName(name), playerId));
    room.pushSystemChat(`${room.players.get(playerId).name} joined.`);
  }
  ws.meta = { roomCode: room.code, playerId };
  send(ws, { type: 'joined', roomCode: room.code, playerId });
  broadcast(room);
  return room.players.get(playerId);
}

function requireHost(ws, room) {
  if (room.hostId !== ws.meta.playerId) {
    fail(ws, 'Only the host can do that.');
    return false;
  }
  return true;
}

/* -------------------------------------------------------------- messaging */

const HANDLERS = {
  create(ws, msg) {
    const room = store.create();
    attach(ws, room, msg.playerId || crypto.randomUUID(), msg.name);
  },

  join(ws, msg) {
    const room = store.get(msg.roomCode);
    if (!room) return fail(ws, `No room called ${String(msg.roomCode || '').toUpperCase()}.`);
    attach(ws, room, msg.playerId || crypto.randomUUID(), msg.name);
  },

  leave(ws, msg, room, player) {
    room.removePlayer(player.id);
    room.pushSystemChat(`${player.name} left.`);
    ws.meta = null;
    send(ws, { type: 'left' });
    broadcast(room);
  },

  rename(ws, msg, room, player) {
    player.name = uniqueName(room, sanitizeName(msg.name), player.id);
    room.touch();
  },

  settings(ws, msg, room) {
    if (!requireHost(ws, room)) return;
    room.updateSettings(msg.settings || {});
  },

  start(ws, msg, room) {
    if (!requireHost(ws, room)) return;
    if (room.phase !== 'lobby' && room.phase !== 'results') {
      return fail(ws, 'A round is already running.');
    }
    const result = room.startRound();
    if (result.error) fail(ws, result.error);
  },

  bid(ws, msg, room, player) {
    const result = room.placeBid(player.id, msg.amount);
    if (result.error) fail(ws, result.error);
  },

  mvp(ws, msg, room, player) {
    const result = room.setMvp(player.id, msg.mvpId);
    if (result.error) fail(ws, result.error);
  },

  pitch(ws, msg, room, player) {
    const result = room.submitPitch(player.id, { mvpId: msg.mvpId, line: msg.line });
    if (result.error) fail(ws, result.error);
  },

  vote(ws, msg, room, player) {
    const result = room.castVote(player.id, msg.targetId);
    if (result.error) fail(ws, result.error);
  },

  lobby(ws, msg, room) {
    if (!requireHost(ws, room)) return;
    room.backToLobby();
  },

  advance(ws, msg, room) {
    if (!requireHost(ws, room)) return;
    room.forceAdvance();
  },

  chat(ws, msg, room, player) {
    room.pushChat(player.id, msg.text);
  },

  ping(ws) {
    send(ws, { type: 'pong', serverNow: Date.now() });
  },
};

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.meta = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return fail(ws, 'Malformed message.');
    }
    const handler = HANDLERS[msg && msg.type];
    if (!handler) return fail(ws, 'Unknown action.');

    // create/join/ping run without a room; everything else needs a seat.
    if (msg.type === 'create' || msg.type === 'join' || msg.type === 'ping') {
      try {
        handler(ws, msg);
      } catch (err) {
        console.error('handler error', msg.type, err);
        fail(ws, 'Something broke on the server.');
      }
      return;
    }

    if (!ws.meta) return fail(ws, 'Join a room first.');
    const room = store.get(ws.meta.roomCode);
    if (!room) {
      ws.meta = null;
      return fail(ws, 'That room no longer exists.');
    }
    const player = room.players.get(ws.meta.playerId);
    if (!player) {
      ws.meta = null;
      return fail(ws, 'You are no longer in that room.');
    }

    try {
      handler(ws, msg, room, player);
    } catch (err) {
      console.error('handler error', msg.type, err);
      fail(ws, 'Something broke on the server.');
    }
    if (room.dirty) {
      room.dirty = false;
      broadcast(room);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (!ws.meta) return;
    const room = store.get(ws.meta.roomCode);
    if (!room) return;
    const player = room.players.get(ws.meta.playerId);
    if (!player) return;

    // Mid-game, a dropped player keeps their roster and can reconnect. In the
    // lobby there is nothing to preserve, so the seat is freed.
    if (room.phase === 'lobby') {
      room.removePlayer(player.id);
      room.pushSystemChat(`${player.name} left.`);
    } else {
      player.connected = false;
      room.touch();
    }
    broadcast(room);
  });
});

/* ------------------------------------------------------------------ loops */

setInterval(() => {
  for (const room of store.rooms.values()) {
    room.tick();
    if (room.dirty) {
      room.dirty = false;
      broadcast(room);
    }
  }
}, TICK_MS);

setInterval(() => {
  for (const ws of clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      clients.delete(ws);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  store.sweep();
}, HEARTBEAT_MS);

server.listen(PORT, () => {
  console.log(`Blind Scenario Auction running on http://localhost:${PORT}`);
});

module.exports = { app, server };
