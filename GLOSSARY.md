# Glossary

- **Room**: a table in the server browser. Holds seats, a host and, once started, a game. `src/server.ts`.
- **Seat**: one player's place in a room, with the secret token that proves it. A seat that left a started game stays, marked `left`.
- **Game**: the rules state for one room. `src/game.ts`.
- **View**: what one player may see of a game (`GameView`): others' hands and layouts hidden during setup, the log trimmed to its tail.
- **King**: each player's own card (an ace, or a joker past four players). Losing it puts the player out.
- **Face**: the printed card a card shows (`7D`, `AH`, `JK1`); a card's id adds a deck tag (`7D-2`) when several decks are in play.
- **Limit**: the highest value a card can kill. Each kill lowers it.
- **Stack**: the cards a card has killed.
- **Half**: a turn's two parts: `action` (attack, resurrect, swap or skip), then `swap`.
- **Pending**: an attack waiting for the defender to pick a Shield or take the hit.
- **Log event**: one entry of a game's log (`LogEvent`): a kill, resurrection, swap or player out. The client words it and plays its sound.
