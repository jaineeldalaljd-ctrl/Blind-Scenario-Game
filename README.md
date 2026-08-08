# Blind Scenario Auction

A multiplayer party game. Bid real credits for five people at auction — Magnus
Carlsen, Amrish Puri, Gordon Ramsay, Virginia Hall. **The scenario is only
revealed once the money is spent.**

Zombie outbreak. IPO. Mars transit. Murder trial.

Then you explain, out loud, why Gordon Ramsay is a top-tier apocalypse asset.
Everyone votes. Best crew takes the round.

```
npm install
npm start          # http://localhost:3000
```

Create a room, share the four-letter code. 3–8 players, one device each, no accounts.

**Play it solo first:** open `demo/solo.html` in any browser — the whole game
against three bots, no server needed.

## The round

| | |
| --- | --- |
| **Auction** | Lots come up one at a time. Every bid resets the clock, so a bidding war extends itself. |
| **Reveal** | The envelope opens. |
| **Defend** | Star the one of your five who wins *this*, then make your case in a line or two. |
| **Vote** | Defences unseal at once. Vote for someone else's crew. |
| **Results** | 3 points a vote, +2 for an outright win. Scores carry between rounds. |

## Decisions that matter at the table

**The reserve rule.** You can never bid so much that you cannot fill your
remaining slots — one credit is held back per empty slot. Without it, one player
empties their wallet on the first strong card and spends the rest of the auction
as a spectator.

**The bargain bin.** Lots nobody bids on are set aside, and any roster still
short at the end is filled from that pile for free. Sitting out is allowed; it
just means pitching with leftovers.

**Nothing leaks.** The server sends each player a tailored view: rosters are
hidden during the auction, stars and defences stay sealed until the vote, votes
until results. There is no "just don't look" honour system.

**A line or two, not an essay.** The defence is capped at 160 characters — long
enough to make a real case, short enough that nobody is typing while four people
wait. Starring your best pick is optional; skip it and your priciest signing gets
the nod. At voting time the defence is the headline and the crew is the small
print, because the defence is what people are actually judging.

**Three tags per card.** Real names, role in brackets, three short capability
tags: *Gordon Ramsay (Michelin chef) — feeds forty from nothing · runs a kitchen
like a warship · volume*. Enough to argue from, short enough to read on a clock.

## Design

Party-game bright: a violet-to-coral gradient ground, white cards, and one loud
yellow reserved for whatever you are meant to press next. Every player gets a hue
and keeps it everywhere they appear. Heavy rounded type, big thumb-sized targets,
and a phone-shaped column that centres rather than widens — the same layout on a
laptop and a phone, because everyone is holding a phone.

## Under the hood

```
server/
  index.js            Express + ws: sockets, rooms, fan-out, heartbeat
  game.js             Room state machine — all game rules live here
  data/characters.js  72 draftable people
  data/scenarios.js   18 scenarios
public/               No build step. Plain HTML/CSS/JS, served static.
demo/solo.html        The whole game in one file, versus three bots
test/                 31 engine tests + 14 end-to-end over real sockets
```

The server is authoritative — clients send intents (`bid`, `mvp`, `pitch`,
`vote`) and render what they are given. Timers run server-side and clients count
down against a shared deadline, so a laggy phone cannot lose a bidding war it
should have won.

Reconnects are handled: the player id lives in `localStorage`, so a refresh or a
locked phone drops you back into your seat with roster and score intact. Rooms are
in memory and swept after 90 minutes idle — restarting the server clears
everything, which keeps deployment to one process with no database.

```
npm test           # engine, no sockets, runs in milliseconds
npm run test:e2e   # a full round over real websockets
npm run test:all
```

## Deploying

One process, no database, websockets throughout. Any of these work as-is:

```
docker build -t blind-scenario-auction . && docker run -p 3000:3000 blind-scenario-auction
```

- **Render** — `render.yaml` is a working blueprint; free tier supports websockets.
- **Fly / Railway / Heroku** — the `Dockerfile` and `Procfile` cover all three.
- Anywhere else: set `PORT` and run `node server/index.js`. Health check at `/api/health`.

Because rooms are in memory, run a **single instance** — two instances means two
separate sets of rooms, and a player could land on the one without their game.

## Adding your own cards

Append to `server/data/characters.js` — people you actually know make it better:

```js
{ id: 'dave', name: 'Dave from Accounts', role: 'Management accountant', emoji: '🧾',
  tag: 'Systems', tier: 1,
  traits: ['Finds any money', 'Never takes leave', 'Owns a canoe'] },
```

Scenarios follow the same shape in `server/data/scenarios.js`. Keep tags to three
and under ~30 characters — they are chips, not sentences, and the tests enforce it.
