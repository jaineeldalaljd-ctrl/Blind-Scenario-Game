# Blind Scenario Auction

A multiplayer party game. Everyone drafts five people from a mixed pool — a chess
grandmaster, a Bollywood villain, a Michelin chef, a smokejumper — by bidding real
credits in a live auction. **The scenario is only revealed after the money is spent.**

Zombie outbreak. IPO. Mars transit. Murder trial.

Then you have to stand up and explain why the screaming Michelin chef is, in fact,
a top-tier apocalypse asset. Everybody votes. Most votes takes the round.

```
npm install
npm start          # http://localhost:3000
```

Open the page, create a room, and send the four-letter code (or the copied invite
link) to everyone else. One device each, 3–8 players, no accounts.

## How a round runs

| Phase | What happens |
| --- | --- |
| **Lobby** | Host sets budget, roster size and clocks. |
| **Auction** | People come up one at a time. Live ascending bids — every bid resets the clock, so a bidding war extends itself. Nobody knows the scenario yet. |
| **Reveal** | Once every roster is full, the envelope opens. |
| **Pitch** | Each player writes the case for their five against *this* scenario. |
| **Vote** | Pitches unseal at once. Everyone votes for someone else's crew. |
| **Results** | 3 points a vote, +2 for an outright win. Scores carry between rounds. |

## Design decisions that matter at the table

**The reserve rule.** You can never bid so much that you cannot fill your remaining
slots — one credit is held back per empty slot. Without it, one player empties their
wallet on the first strong card and spends the rest of the auction as a spectator.

**The bargain bin.** Lots that draw no bids are set aside, and any roster still short
at the end is filled from that pile for free. Sitting out is allowed; it just means
pitching with leftovers.

**Nothing leaks.** The server sends each player a tailored view: other rosters are
hidden during the auction, pitches stay sealed until the vote opens, and votes stay
sealed until results. There is no "just don't look" honour system.

**No real people.** Every card is an archetype with stated traits — that is what
makes the argument playable. "The Beekeeper: unnaturally calm, understands swarms,
brings the bees" gives you something to actually reason from at 2am in a Mars capsule.

## Under the hood

```
server/
  index.js            Express + ws: sockets, rooms, fan-out, heartbeat
  game.js             Room state machine — all game rules live here
  data/characters.js  72 draftable archetypes
  data/scenarios.js   18 scenarios
public/               No build step. Plain HTML/CSS/JS, served static.
test/
  game.test.js        Engine tests, clock advanced by hand
  server.test.js      End-to-end: real sockets, three clients, a full round
```

The server is authoritative — clients only send intents (`bid`, `pitch`, `vote`) and
render the state they are given. Timers run server-side; the client counts down against
a shared deadline, so a laggy phone cannot lose a bidding war it should have won.

Reconnects are handled: the player id lives in `localStorage`, so a refresh, a dropped
tunnel or a locked phone drops you back into your seat with your roster and score intact.
Rooms are in-memory and swept after 90 minutes idle — restarting the server clears
everything, which is fine for a party game and keeps deployment to one process.

### Tests

```
npm test           # engine (27 tests, no sockets, runs in ms)
npm run test:e2e   # full round over real websockets
npm run test:all
```

## Knobs

Host-configurable in the lobby: budget (20–500), roster size (3–7), bid clock,
opening clock, pitch time, vote time. Defaults are 100 credits and five slots.

The host also gets a **Skip ahead** control — drops the hammer on a lot mid-clock,
or pushes past the reveal, pitch or vote when the table is ready to move on.

### Adding your own cards

Append to `server/data/characters.js`:

```js
{ id: 'sommelier', name: 'The Master Sommelier', emoji: '🍷', tag: 'Hands', tier: 1,
  blurb: 'One of a few hundred on earth. Will tell you about it.',
  traits: ['Superhuman palate', 'Detects poison, allegedly', 'Insufferable at dinner'] },
```

Scenarios follow the same shape in `server/data/scenarios.js`. Give every card at
least one liability — a card with no downside is a card nobody has to argue for.
