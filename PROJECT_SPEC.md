# ⚽ Football Minds — Master Spec (v2)

> This is the single source of truth for the project. It merges the original vision with every architecture decision made since. If anything here conflicts with an older note elsewhere in the repo, **this file wins.**

**Tagline:** "The Ultimate Football Party Game."

Not a quiz site. A multiplayer football party platform — friends competing in fast, tense, highly interactive games. Feel: Chess.com's polish + GeoGuessr's tension + Gartic Phone/Skribbl.io's party chaos + Mario Party's celebration. Premium, modern, addictive, extremely smooth. **Mobile-first, always.**

---
!!!!! the most important rule is free hosting up even to 50 players and not a pc must be running as a server it means it should be a website even this pc is closed people can play !!!!!
## 1. Architecture (locked)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind v4, Framer Motion, Zustand | Already scaffolded, modern, fast |
| Realtime gameplay | Socket.io server, **in-memory room state only** | Rooms are ephemeral by nature — no game state belongs in a database. This is how Skribbl.io/Gartic Phone/Codenames-style games are built. |
| Persistence | PostgreSQL (Neon or Supabase free tier) + Prisma | Stores only what must survive between sessions: user identity, XP/levels/coins, achievements, leaderboards. **Never** live room/game state. |
| Auth | Guest Mode (device id, instant play) at launch → Google + Discord login in a later phase | Guest mode must never be blocked by auth |
| Player/club images | **TheSportsDB** free public API, called server-side via a Next.js API route with caching, real photos + real crests for any player/club by name lookup | Real imagery for unlimited players without hosting our own image library |
| Image fallback | Procedural avatar: initials + position icon on a gradient built from the player's real club colors; procedural monogram crest for clubs with no badge match | Guarantees every player/club always looks finished and premium, never a broken image icon |
| Hosting | Frontend → Vercel (free). Socket.io server → Render or Fly.io free tier. DB → Neon/Supabase free tier. | Zero cost at target scale, nothing for the user to self-host or maintain |
| Capacity target | Rooms support **up to 50 concurrent players**, comfortably free-tier | Matches real usage (friend groups), keeps infra trivial |
| Docker/Compose | Provided for local dev parity, optional for deployment | Not required to ship, useful for local full-stack dev |

**Rule of thumb used throughout:** if it's true "right now, in this room," it lives in Socket.io memory. If it's true "about this person, forever," it lives in Postgres.

---

## 2. Design System

- Primary: `#00E676` (bright green) / dark surfaces `#0B1220`, `#121826` / accent `#FFEA00` (yellow) / white text
- Glassmorphism cards (`backdrop-blur`, translucent surface, hairline border) — already implemented in `globals.css`
- Rounded, soft corners everywhere (cards, buttons, avatars)
- Micro-interactions: hover lift, tap scale, victory confetti, XP-gain pop, countdown pulse, page transitions
- No template feel — everything intentional, no default shadcn look
- Fully responsive; **mobile is the primary target**, not an afterthought

### Mobile experience (non-negotiable)
- Every screen must feel like a native app, not a shrunk desktop site
- Large touch targets (min 44px), swipe gestures where natural, bottom nav for in-game screens
- Zero horizontal scroll, one-handed reachability, portrait-first layouts

### Sound (optional, mutable)
Click, correct, wrong, victory, crowd cheer stingers. Mute toggle persisted client-side.

---

## 3. Player & Club Visuals

- `lib/sportsdb.ts` — thin client for TheSportsDB: `searchPlayer(name)`, `getTeamBadge(teamName)`
- `/api/player-image?name=` and `/api/club-badge?name=` — Next.js API routes that call TheSportsDB server-side, cache results in-memory (and later in Postgres if we want a permanent cache table), and always return *something renderable* — real image if found, otherwise a generated SVG fallback so the client never has to handle a broken state
- `<PlayerAvatar />` and `<ClubBadge />` components consume these routes exclusively — no game component ever calls TheSportsDB directly
- Every player and club, in every single game screen, uses these two components — no exceptions, no plain text names without a visual

---

## 4. Room System

- Modes: 1v1, 2v2, Free-For-All (up to 50 players) for most games. **Guess The Player** additionally supports every team size from 1v1 up to 5v5 (1v1, 2v2, 3v3, 4v4, 5v5) — see §5.1 for exactly how team picking works in those modes.
- Private rooms with a shareable invite code (short, human-typeable, e.g. `MBAPPE7X`)
- Room chat + emoji reactions
- Ready-up flow before host can start
- Host controls: start game, kick player, change mode/game
- Players self-assign to Team 1 or Team 2 in the lobby before a team-mode match starts (host can also do this on their behalf); the first player to join a team is that team's leader for any game with team-leader mechanics
- All of the above is Socket.io room state — nothing here touches Postgres

---

## 5. The Games

All games below are unchanged in *design* from the original spec, but now explicitly: every player/club reference renders via `<PlayerAvatar />` / `<ClubBadge />`, and all live state (secret picks, timers, answers, eliminations) is Socket.io room state broadcast to players in that room.

### 1. Guess The Player
Classic 20-questions — but truly unlimited questions, no timer, no hints, no AI. Two teams face off. Supported team sizes: **1v1, 2v2, 3v3, 4v4, 5v5** — chosen as the room mode before starting.

- **1v1**: each of the two players secretly picks a player directly (via search, resolved through `searchPlayer`, shown as a real `<PlayerAvatar/>` only to its owner). No extra step — picking is instant and final, exactly as before.
- **2v2 and larger**: each team shares ONE hidden player, chosen together through a small **private team lobby** (a team-only mini chat, invisible to the opposing team). Only the team's **leader** (the first player who joined that team) can *propose* a candidate via the search picker. Every other teammate then sees the proposed player and must tap an **"Agree"** button confirming they're happy with that pick. Once every non-leader teammate has agreed, the team's secret locks in. If the leader proposes a different player instead, all previous agreements on that team are cleared and teammates must agree again to the new proposal. The match only begins once **both** teams have locked in a secret this way.
- Once both secrets are locked, questions are asked in **strict turn order that alternates between the two teams**, one player at a time — the turn order interleaves the two teams' rosters (e.g. in 2v2: Team 1's first player asks, then Team 2's first player, then Team 1's second player, then Team 2's second player, looping back to the start). **On their turn, and only on their turn, the current asker chooses one of exactly two actions: "Ask a Question" or "Guess the Player."** Picking one locks the other for that turn — e.g. once they choose to ask, the guess action is unavailable to them until their next turn comes around; if they instead choose to guess, the question box is never shown for that turn. No other player, on either team, can ask a question or submit a guess while it isn't their turn — teammates simply wait, and the opposing team can only respond to a pending question (see below), never guess or ask out of turn. In 1v1 this plays out identically, just with the "team" being a single opponent: on your turn you see the same two buttons, Question and Guess.
  - **If they choose to ask**: they type one free-text yes/no question. Every currently-connected player on the **opposing** team then answers that same question via a dedicated **Yes / No button** (not free text) — as each of them answers, a live **poll** shows exactly who tapped Yes and who tapped No, updating in real time. Once every connected member of the opposing team has answered, the turn passes to the next player in the order. A running history of every question asked and its poll result stays visible to the whole room.
  - **If they choose to guess**: they submit one final guess for the opposing team's secret immediately — no question, no poll. A correct guess wins the match for that whole team instantly and reveals both secrets to everyone. An incorrect guess is shown to the room (same as before) and simply ends that player's turn, passing to the next player in the order exactly as an answered question would.
  - **Turn timer**: every player turn is timed. The current asker has 30 seconds to choose Ask or Guess and submit it — running out silently passes the turn to the next player, no penalty. Once a question is asked, the opposing side has 20 seconds to answer; anyone who hasn't tapped Yes/No by then is counted as "No" by default so the poll resolves and the turn keeps moving instead of stalling on a silent player.

### 2. Who Am I?
Timer mode. Random player selected server-side. Clues reveal on a schedule: Nationality → Age → Position → League → Current Club → Former Club → Strong Foot → Trophies. First correct guess wins, feeds the round leaderboard.

### 3. Career Maze
Random player's full club history shown immediately as a large animated vertical timeline (`<ClubBadge/>` per stop). Timer starts on reveal. Fastest correct guess wins.

### 4. Football Pyramid
Progressive reveal: Nationality → Position → League → Current Club → Strong Foot → Height → Age → Number → Former Club → Awards. Guess anytime; earlier correct guesses score more.

### 5. Last Man Standing
Prompt like "Name a player who played for Chelsea." Everyone answers simultaneously; duplicate answers eliminate everyone who wrote them, unique answers survive. Repeats until one player remains. Prompts pulled from a category pool (club, nationality+position combos, league, honors, captaincy, etc.).

### 6. The Chain
Starts on a real player (e.g. Cristiano Ronaldo). Each player in turn must name a real ex-teammate of the previous player, verified against real club-history data. 10s timer per turn, no repeats, wrong/late = eliminated. After several clean rounds, **Fire Mode** kicks in: a random modifier restricts valid answers (only left-footed, only defenders, only South Americans, only retired, only UCL winners, only 35+, only goalkeepers, only World Cup winners). Last survivor wins. This is the flagship, most-polished game.

### 7. Shirt Number Madness
A legendary number is announced (e.g. "Number 7"). Everyone types one player who's worn it. Duplicate answers score zero; unique answers score points. Category pool covers numbers 1, 9, 10, 11, underrated 8, captain's 5, etc.

### Party Mode
Chain multiple games into one session (e.g. Career Maze → Guess The Player → Football Pyramid → Last Man Standing → The Chain → Who Am I? → Final Winner), cumulative scoring across the session, big finish screen.

---

## 6. Progression & Social

- Universal XP, coins, levels — stored in `PlayerStats` (Postgres)
- Achievements/titles (e.g. Football Genius, Transfer Wizard, Chain Survivor, Number King, GOAT) — `Achievement` + `UserAchievement`
- Profile: avatar, level, XP, games played, wins, win rate, favorite game, achievements, stats
- Leaderboards: Global, Friends, Weekly, Monthly, All-Time — `LeaderboardEntry`, recomputed periodically, cheap to query

---

## 7. Admin Panel (later phase)

Manage players/clubs cache overrides, ban users, manage question/category pools, view basic analytics. Not part of the initial playable build — comes after the 7 games and room system are solid.

---

## 8. Quality Bar

No placeholder UI, no unfinished pages, no lorem ipsum. Professional typography and spacing, pixel-aligned. Production-ready, clean, reusable, scalable component architecture. SEO-friendly where public (home, landing), accessible (keyboard nav, contrast, aria labels on game controls), dark-mode-optimized throughout. Should read like a funded startup's product, not a prototype.

---

## 9. Build Order (how we're actually shipping this)

1. **Foundation** — design tokens (done), `PlayerAvatar`/`ClubBadge` + sportsdb API routes, Prisma schema + free Postgres wired up, Socket.io room server (create/join/lobby/chat/ready/start)
2. **Flagship game vertical slice** — The Chain, fully playable end-to-end, proves realtime + real images + fire mode logic
3. **Remaining 6 games**, reusing the same room/avatar infrastructure
4. **Progression layer** — XP, levels, achievements, leaderboards writing to Postgres after each match
5. **Party Mode**, then **Admin Panel**, then Google/Discord auth on top of guest mode
