<img src="assets/icon.svg" width="64" height="64" alt="">

# Last King Standing Online

Online multiplayer card game for 2–10 players (the host picks the room size). Node ≥ 20, no dependencies.

```sh
npm start        # serves on $PORT (default 3000), binds 0.0.0.0
npm test
```

Open the server URL, enter a name, create or join a room from the browser, and the host starts the game.

## Layout

- `src/game.js`: rules engine (pure state machine, server-authoritative).
- `src/server.js`: rooms / server browser over HTTP; each client gets its own filtered view over Server-Sent Events.
- `public/`: plain functional client (UI still to be designed).

API: `GET /api/rooms`, `POST /api/rooms`, `POST /api/rooms/:id/{join,start,action,leave}` (with an `x-token` header),
`GET /api/rooms/:id/events?token=` (SSE).

## How the rules are read

Where the rules were ambiguous:

- Aces not used as Kings are left out of the deal (the deal is only 2–K).
- 7+ players: a second deck is shuffled in. Kings are all aces first, then jokers.
- Others' hands and layouts stay hidden until everyone has laid out.
- If an attack can be shielded (a ♠ in the target's row), the game waits for the defender to choose a ♠ or decline.
- A resurrected card comes back with a fresh limit: its face number, doubled for ♣ (a King gets 1).
- A resurrected enemy King is an ordinary card worth 1. It has no King protection and losing it eliminates nobody.
- Leaving a game in progress forfeits: your King is treated as dead.
- State is in memory. Restarting the server ends all games, and rooms idle for an hour are dropped.
