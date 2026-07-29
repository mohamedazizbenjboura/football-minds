# Football Minds — Progress Log

> Source of truth for "what's actually built" vs `PROJECT_SPEC.md` / `foot_database.md`.
> Updated every time something changes. Newest entries at the top of the Log.

---

## Status vs Build Order (PROJECT_SPEC.md §9)

1. **Foundation** — ✅ mostly done
   - ✅ Design tokens (`globals.css`: primary/accent/surface colors, glassmorphism `.glass` utility)
   - ✅ `<PlayerAvatar/>` / `<ClubBadge/>` components + `/api/player-image`, `/api/club-badge` routes (TheSportsDB + procedural SVG fallback, in-memory cache)
   - ✅ Prisma schema (`prisma/schema.prisma`): Club, Player, ClubStint, User, PlayerStats, Achievement, UserAchievement, LeaderboardEntry
   - ⚠️ Postgres is **not actually wired up** — no `DATABASE_URL` set, no migration run, no `prisma/seed.ts` (referenced by `npm run seed` in package.json but the file doesn't exist yet)
   - ✅ Socket.io room server (`server/index.ts`): create/join/lobby/chat/ready-up/kick/start, host handoff on disconnect, up to 50 players, 1v1/2v2/FFA modes
   - ✅ Home page (`src/app/page.tsx`) + `RoomEntryModal` + room lobby page (`src/app/room/[code]/page.tsx`)

2. **Flagship game vertical slice — The Chain** — ✅ done, fully playable end-to-end
   - `server/chainEngine.ts` — dataset loader, name resolution (exact + last-name match, accent-insensitive), teammate-overlap check, Fire Mode modifier pool, random starting-player picker
   - `server/index.ts` — chain game state lives on the `Room` object (`room.chain`), driven entirely by socket events: `room:start` initializes it when `gameId === "the-chain"`; `chain:submit` validates each guess (unknown player → eliminated, repeat name → eliminated, not a real teammate → eliminated, breaks an active Fire Mode rule → eliminated); a 10s server-side timer per turn eliminates on timeout (`chain:wrongAnswer` + elimination); turn order skips eliminated players; Fire Mode auto-activates once every surviving player has completed one clean turn; game ends and declares a winner once one player remains; mid-match disconnects count as eliminations so the game never stalls
   - `src/lib/store/chain.ts` — client store mirroring the server-authoritative state (`chain:state`, `chain:wrongAnswer`, `chain:fireMode`)
   - `src/app/game/[id]/page.tsx` — the actual game screen: live turn banner + countdown, animated chain history with `<PlayerAvatar/>` per stop, Fire Mode banner, per-player eliminated/active chips, wrong-answer/timeout feedback, winner screen. Every other game id (`guess-the-player`, `who-am-i`, etc.) renders an honest "in development" screen instead of a blank/broken route, since only The Chain has a real engine so far.
   - Dataset: `server/data/players.json` — ~40 real, famous players with real career stints, hand-picked. This is **not** the production Football Knowledge Database from `foot_database.md` — see gaps below.
   - Verified: `npx tsc --noEmit` clean and `npx eslint` clean across the new/changed files after `npm install` filled in missing packages (`zustand`, `framer-motion`, `lucide-react`, `socket.io`, etc. were present in `package.json` but not actually installed in `node_modules` yet).

3. **Remaining 6 games** — 4 of 6 done, 2 not started
   - ✅ **Who Am I?** — fully playable end-to-end (see below)
   - ✅ **Career Maze** — fully playable end-to-end (see below)
   - ✅ **Last Man Standing** — fully playable end-to-end (see below). This one has a story — see "2026-07-28 — Critical fix: missing engine file" in the Log: the client and `server/index.ts` sides were already fully built from an earlier session, but the engine file they both depend on was never actually created, so the whole project failed to type-check and nothing could run at all. Fixed this session.
   - ✅ **Guess The Player** — fully playable end-to-end, **1v1 only** (see below and "Known gaps" for why 2v2 isn't supported yet)
   - ❌ Football Pyramid, Shirt Number Madness — still placeholder "in development" screens at `/game/<id>` so the app never shows a blank/broken page, but no game logic exists for either yet.

4. **Progression layer (XP/coins/achievements/leaderboards)** — ❌ not started. Schema exists in Prisma but nothing writes to it yet (no post-match write, no Postgres connection). The Chain, Who Am I?, Career Maze, Last Man Standing, and Guess The Player all currently declare a winner but don't record anything permanent.

5. **Party Mode, Admin Panel, Google/Discord auth** — ❌ not started (later phases per spec, expected)

---

### Who Am I? — implementation notes

- `server/whoAmIEngine.ts` — clue builder (`buildClues`) + random-target picker (`randomWhoAmITarget`, excludes names already used this match) + guess resolution (`isCorrectWhoAmIGuess`, reuses `chainEngine.ts`'s `resolvePlayer` so name matching stays consistent across games).
- `server/index.ts` — `room.whoAmI` state, driven by socket events: `room:start` initializes it when `gameId === "who-am-i"`; 5 rounds per match; each round reveals 1 of 8 clues immediately then one more every 4s; `whoami:submit` accepts a guess from *any* player at any time during the `clue` phase (wrong guesses are silent, no penalty — this isn't an elimination game); first correct guess ends the round and scores `100 - (cluesRevealed-1)*12`, floored at 20, so guessing early is worth much more; if nobody solves it before the last clue + a 6s grace window, the round ends unsolved (target revealed, 0 points awarded); a 4s pause between rounds; after round 5 the game ends and whoever has the highest total score wins.
- **Deviation from the spec's clue order**, documented in `whoAmIEngine.ts`'s file header too: the spec lists Nationality → Age → Position → **League** → Current Club → Former Club → Strong Foot → Trophies, but `players.json` has no `league` field per player (`foot_database.md` §11 "Leagues" isn't wired up — clubs are just strings on career stints, not linked to a league record). **Continent** is substituted in that slot so clue count/pacing still match; swap back to a real League clue once leagues exist in the data.
- `src/lib/store/whoami.ts` — client store mirroring server state (`whoami:state`, `whoami:solved`).
- `src/app/game/[id]/page.tsx` — `WhoAmIGame()`: round counter, per-clue reveal timer, animated clue list, live scoreboard, solved/unsolved round-end banner, final leaderboard + winner screen. Reuses the same route as The Chain (`gameId` branch) rather than a new file, matching the existing pattern.
- Verified: `npx tsc --noEmit` clean and `npx eslint` clean on all new/changed files. **Not** runtime/playtested (no multi-tab session was run this session either) — same caveat as The Chain below.

---

### Career Maze — implementation notes

- `server/careerMazeEngine.ts` — timeline builder (`buildTimeline`, sorts a player's `careers` oldest-first) + random-target picker (`randomCareerMazeTarget`, prefers players with 2+ club stints so the timeline is an actual puzzle, and excludes names already used this match) + guess resolution (`isCorrectCareerMazeGuess`, reuses `chainEngine.ts`'s `resolvePlayer`).
- `server/index.ts` — `room.careerMaze` state, driven by socket events: `room:start` initializes it when `gameId === "career-maze"`; 5 rounds per match; unlike Who Am I?, the **entire** club-history timeline is shown at once (per spec — "shown immediately as a large animated vertical timeline") and a single 20s round timer starts; `careermaze:submit` accepts a guess from any player at any time during the `guess` phase (wrong guesses are silent, no penalty); first correct guess ends the round and scores by elapsed time — `100 - floor(elapsedSeconds*4)`, floored at 20, so instant guesses are worth ~5x a last-second one; if the 20s timer runs out unsolved, the round ends (target revealed, 0 points); 4s pause between rounds; after round 5 the game ends and whoever has the highest total score wins.
- No spec deviation needed here — `server/data/players.json` already has everything Career Maze needs (`careers[].club/startYear/endYear`) since The Chain relies on the same field.
- `src/lib/store/careerMaze.ts` — client store mirroring server state (`careermaze:state`, `careermaze:solved`).
- `src/app/game/[id]/page.tsx` — `CareerMazeGame()`: round counter, countdown timer, animated vertical timeline using `<ClubBadge/>` per stop with a connecting line, live scoreboard, solved/unsolved round-end banner, final leaderboard + winner screen. Same route-branch pattern as The Chain and Who Am I?.
- Verified: `npx tsc --noEmit` clean and `npx eslint` clean on all new/changed files. **Not** runtime/playtested.

---

### Last Man Standing — implementation notes

- `server/lastManStandingEngine.ts` — the piece that was actually missing (see Log entry below). Builds a prompt pool dynamically from `server/data/players.json` itself (clubs, nationalities, continents, positions, preferred foot, World Cup/Champions League winner, retired/active), rather than from `foot_database.md`'s full leagues/honors/captaincy tables, since those aren't wired up yet. A category is only included if at least 4 distinct players in the dataset qualify for it, so a round always has real variety instead of forcing everyone onto the same one or two valid names. `randomPrompt(usedIds)` avoids repeating a category within a match; `verifyAnswer(prompt, raw)` resolves the free-text answer via `chainEngine.ts`'s `resolvePlayer` (same matching as every other game) and checks it against the prompt's category, returning `no-answer` / `not-found` / `doesnt-match` so `server/index.ts` can present a clear reason per player.
- `server/index.ts` — `room.lastManStanding` state and full round lifecycle were already written before this session: `room:start` initializes it when `gameId === "last-man-standing"`; each round gives every survivor `LAST_MAN_STANDING_ANSWER_SECONDS` (20s) to submit one answer via `lastmanstanding:submit`; a round resolves early the moment every survivor has answered, or when the timer runs out (silence = `no-answer`, eliminated); among valid answers, anyone whose answer resolves to the same real player as someone else is eliminated as a `duplicate`, everyone else survives; repeats with a fresh prompt (never reusing a category) until 0 or 1 players remain; a disconnect mid-round counts as eliminated so the round can still resolve.
- `src/lib/store/lastManStanding.ts` and the `LastManStandingGame()` screen in `src/app/game/[id]/page.tsx` were also already fully built: prompt card, live "X / Y answered" count, round-end results list (survived/eliminated + reason per player), player chips showing eliminated/answered/still-thinking, countdown timer, final winner screen (or an honest "no survivors — draw" state if a round eliminates everyone at once).
- Verified `npx tsc --noEmit` and `npx eslint` clean across the whole project after adding the engine file. **Not** runtime/playtested — same caveat as every other game below.

### Guess The Player — implementation notes

- **Scoped to 1v1 only this session.** The spec also describes a 2v2 variant ("teammates share one hidden player"), but that needs a team-assignment mechanism: `RoomPlayer.team` is declared in `server/index.ts`'s types but there is no socket event anywhere in the codebase that actually sets it. Rather than bolt a one-off team-picker onto just this game, `server/index.ts`'s `room:start` handler rejects starting Guess The Player outside `mode === "1v1"` with a clear error (surfaced already via the room lobby's existing generic error banner) — no silent failure or broken screen.
- This is the first game with **no dependency on `server/data/players.json`** — the secret pick can be any real player, resolved through TheSportsDB via a new type-ahead endpoint rather than the curated ~40-name dataset the other five games share. New pieces: `src/lib/sportsdb.ts` gained `searchPlayers()` (returns the full candidate list; `searchPlayer()` now just calls it and picks the best match, unchanged behavior); `src/app/api/player-search/route.ts` is a new, read-only Next.js API route wrapping it; `src/components/PlayerSearchPicker.tsx` is a new debounced type-ahead component showing each candidate with a real `<PlayerAvatar/>` preview, with a manual "use it anyway" fallback if TheSportsDB has no match (since the spec is explicit this game has "no AI" — there's deliberately no automated real-player validation, same as a real-life 20-questions game).
- `server/guessThePlayerEngine.ts` — intentionally tiny: just `namesMatch()` (reuses `chainEngine.ts`'s `normalizeName`) and `isValidPick()`. No dataset loading, no network calls from the room server itself — TheSportsDB is only ever called from the Next.js API route, per §3's existing architecture rule.
- `server/index.ts` — `room.guessThePlayer` state: `picking` phase where each of the 2 players submits one secret via `guessplayer:pick` (locked in, no changing your mind); once both have picked, phase flips to `playing`; either player can submit a guess at any time via `guessplayer:guess` (no turn order — free-for-all duel); a guess matching the opponent's secret (accent/case-insensitive) ends the game immediately and reveals both secrets. The actual yes/no questions happen over the **existing room chat** (`chat:message`) — no new event needed for that part, exactly matching the spec's own framing ("unlimited yes/no questions asked in room chat"). Each player's own secret is emitted privately (`guessplayer:yourSecret`, direct-to-socket, never room-wide) so it never leaks to the opponent through the state broadcast, keeping "shown as a real `<PlayerAvatar/>` only to its owner" true at the server layer, not just in the UI. A mid-match disconnect ends the game with the remaining player winning by forfeit (`forfeited: true` on the public state), same fairness principle as every other game's disconnect handling.
- `src/lib/store/guessThePlayer.ts` and the `GuessThePlayerGame()` screen in `src/app/game/[id]/page.tsx`: picking screen (search picker or "waiting for opponent"), playing screen (own secret shown privately, embedded chat for questions, a separate guess log distinct from chat since a guess is a deliberate scored action rather than a question, a dedicated guess input), and a winner screen revealing both secrets side by side (or a "won by forfeit" message if the opponent disconnected).
- Verified `npx tsc --noEmit` and `npx eslint` clean across the whole project after adding all of the above. **Not** runtime/playtested — same caveat as every other game below.

## Known gaps / honest caveats

- The football knowledge database from `foot_database.md` (100k+ players, careers, transfers, relationship graph in Postgres) is a **future/production dataset**. Nothing at that scale exists yet — right now there's no Postgres connection at all. The Chain's dataset is a small hand-picked JSON file (~40 real, famous players with real career stints) just to make the flagship game genuinely playable end-to-end; it is **not** a substitute for the real import pipeline in §27 of the database spec. It will run out of valid teammate chains quickly with a large group, and it only covers players an average fan would recognize — no lower leagues, no women's football, no historical pre-2000s era depth.
- The Chain's dataset means `resolvePlayer` will fail (and eliminate the player) for any real player not in that ~40-name list, even though they're a legitimate answer in the real world. This is a direct consequence of not having the real database yet, not a bug in the matching logic itself.
- No automated tests exist anywhere in the repo. Everything verified this session was via `tsc --noEmit` + `eslint`, not runtime/integration testing (no two-browser-tab playtest was performed).
- `AGENTS.md`/`CLAUDE.md` warn this Next.js version has breaking changes vs training data — worth a docs check in `node_modules/next/dist/docs/` before touching routing/config-sensitive code.
- "Complete the project" (build all 7 games + the full production database + progression + Party Mode + Admin Panel + auth) is a multi-week build, not something one session can finish. Each session's scope is deliberately narrowed to one or two real, verifiable milestones rather than a shallow pass across everything — session 2 finished The Chain end-to-end (Build Order step 2), session 3 added Who Am I? and Career Maze (Build Order step 3, 2/6 of the remaining games done); the honest state of everything else is recorded above rather than glossed over.
- A tooling mistake happened mid-session and is worth recording: `server/whoAmIEngine.ts` was first created with a sandbox-local file tool instead of the remote filesystem tool pointed at `C:\Users\aziz\foot`, so the file briefly didn't exist in the actual repo even though it looked created. Caught immediately by `npx tsc --noEmit` failing with "Cannot find module './whoAmIEngine'", then re-created at the correct path. Flagging this so a future session double-checks that file-creation tool calls are landing in the real repo path, not a sandbox, especially early in a session.
- **This exact mistake recurred, worse, in a later session**: `server/lastManStandingEngine.ts` was apparently never created in the real repo at all, even though `server/index.ts` (the room server) and the entire client side (`src/lib/store/lastManStanding.ts`, the `LastManStandingGame()` screen) were fully built around it and PROGRESS.md's own build-order table wasn't updated to say so. The project was left in a state where `npx tsc --noEmit` failed outright — nothing could run, build, or deploy — and that broken state wasn't caught or recorded before that session ended. Found and fixed at the start of the 2026-07-28 "Critical fix" session below by reading the actual compiler error rather than trusting PROGRESS.md's summary. **Lesson for every future session, stated plainly: run `npx tsc --noEmit` yourself, near the start, before trusting this file's status table — PROGRESS.md is only as accurate as the session that last wrote it, and a session can end mid-task without that being reflected here.**
- **2v2 team assignment doesn't exist yet.** `server/index.ts` declares `RoomPlayer.team?: 1 | 2` and `capacityForMode("2v2") === 4`, but no socket event anywhere sets that field — it's dead/unused right now. This blocks any game's 2v2 variant that needs teammates to know they're paired (Guess The Player's "teammates share one hidden player", and eventually Party Mode). A real `room:assignTeam`-style event (host assigns, or players self-select, 2 vs 2) needs to be built once — shared infrastructure, not duplicated per game — before any 2v2-specific game logic is worth writing.

---

## Log (newest first)

### 2026-07-28 — Guess The Player built end-to-end (1v1)
- User said "continue" — re-read `PROJECT_SPEC.md`, `foot_database.md`, and this file in full before starting, per standing instructions.
- Ran `npx tsc --noEmit` and `npx eslint .` first, before assuming the previous session's "clean" sign-off still held — both still clean, so this session started from real green rather than a stale claim.
- Picked Guess The Player as the next Build Order step 3 target. Noted the spec's 2v2 "teammates share one hidden player" clause depends on team assignment, which doesn't exist anywhere in the codebase (`RoomPlayer.team` is declared but never set) — scoped this session to 1v1 only rather than build a one-off team picker just for this game; recorded that gap explicitly in "Known gaps" for whoever builds real team assignment later.
- Added `searchPlayers()` to `src/lib/sportsdb.ts` (full candidate list; `searchPlayer()` now delegates to it) and a new `/api/player-search` route, so the pick step can offer a real type-ahead against TheSportsDB instead of unresolved free text.
- Added `src/components/PlayerSearchPicker.tsx` — debounced type-ahead with `<PlayerAvatar/>` previews per candidate, plus a manual "use it anyway" fallback for players TheSportsDB doesn't have (spec says "no AI", so no automated real-player validation is imposed here).
- Added `server/guessThePlayerEngine.ts` (`namesMatch`, `isValidPick` — intentionally minimal, no dataset, no network calls from the room server).
- Added `room.guessThePlayer` state + full lifecycle to `server/index.ts`: picking phase (`guessplayer:pick`, locked in once submitted), playing phase (`guessplayer:guess`, no turn order, first match to the opponent's secret wins), a `room:start` guard rejecting non-1v1 mode with a clear ack error, each player's own secret sent privately (never in the room-wide broadcast) via `guessplayer:yourSecret`, and disconnect-as-forfeit handling in `handleLeave`.
- Added `src/lib/store/guessThePlayer.ts` and the `GuessThePlayerGame()` screen in `src/app/game/[id]/page.tsx` — picking screen, playing screen (own secret shown privately + the existing room chat embedded for yes/no questions + a separate guess log/input), winner screen revealing both secrets (or a forfeit message).
- Hit two real `eslint` errors while verifying (not pre-existing — introduced by this session's own new code) and fixed both: a synchronous `setState` inside `PlayerSearchPicker`'s debounce effect for the "query too short" case (restructured so no state needs correcting synchronously, and gated the results/no-match UI on query length instead), and an unescaped `'` in the winner screen's JSX (`&apos;`).
- Verified `npx tsc --noEmit` and `npx eslint .` clean across the whole project after all of the above.
- Updated the Build Order status table, added a Guess The Player implementation-notes section, and added the 2v2-team-assignment gap to "Known gaps".
- Not runtime-playtested — same caveat as every other game. Next session: either playtest across real browser tabs, or pick up Football Pyramid or Shirt Number Madness (the two still-unbuilt games), or build real `room:assignTeam` infrastructure to unlock every game's 2v2 variant at once.

### 2026-07-28 — Critical fix: missing engine file was blocking the entire build, then Last Man Standing lint fix
- Read `PROJECT_SPEC.md`, `foot_database.md`, and this file in full, word by word, before touching anything, per standing instructions.
- Ran `npx tsc --noEmit` before assuming anything in this file's status table was current — it failed immediately: `server/index.ts(52,8): error TS2307: Cannot find module './lastManStandingEngine'`.
- Investigated: `server/index.ts` had a complete, well-built Last Man Standing game (state, round lifecycle, socket events) and the client (`src/lib/store/lastManStanding.ts`, the `LastManStandingGame()` screen in `src/app/game/[id]/page.tsx`, the game's entry in `src/lib/games.ts`) was equally complete — but `server/lastManStandingEngine.ts`, the one file both sides import from, did not exist anywhere in the repo (confirmed with a recursive file search). This matches, and is worse than, the tooling mistake already documented below from an earlier session. The project could not type-check, build, or run at all in this state.
- Wrote `server/lastManStandingEngine.ts` directly to the real repo path (`C:\Users\aziz\foot\server\lastManStandingEngine.ts`), double-checked immediately afterward with `get_file_info` that it actually landed there before moving on. Implementation: `randomPrompt(usedIds)` + `verifyAnswer(prompt, raw)` + a `LastManStandingPrompt` pool built dynamically from `server/data/players.json` (clubs, nationalities, continents, positions, foot, World Cup/Champions League winner, retired/active status), each category gated at a minimum of 4 qualifying players so rounds have real variety; reuses `chainEngine.ts`'s `resolvePlayer` for consistent name matching with every other game.
- Verified `npx tsc --noEmit` clean afterward.
- Ran `npx eslint .` on the whole project (not just changed files, since the last known-good state was in question) and found one more, unrelated, pre-existing error: a synchronous `setState` inside a `useEffect` body in `src/app/room/[code]/page.tsx` (`react-hooks/set-state-in-effect`). Fixed by seeding `joining` state lazily from `room`'s truthiness at mount (`useState(() => !room)`) instead of correcting it with a synchronous `setJoining(false)` call inside the effect.
- Verified `npx tsc --noEmit` and `npx eslint .` both clean across the entire project after both fixes.
- Updated the Build Order status table and "Known gaps" section above to reflect Last Man Standing's real status (done, 3/6 of remaining games) and to record the lesson about not trusting this file's summary without independently checking `tsc`.
- Did **not** start a new game this session — the discovery and fix above was the full scope; see "Known gaps" for why an unplaytested (no two-browser-tab session was run) but type/lint-clean state is the honest bar met here.
- Next session should pick up at: (a) optionally playtest The Chain / Who Am I? / Career Maze / Last Man Standing together in real browser tabs, since none of the four have ever been runtime-tested, only verified via `tsc`/`eslint`; then (b) Guess The Player, Football Pyramid, or Shirt Number Madness as the next new game per Build Order step 3.

### 2026-07-28 — Career Maze built end-to-end
- User said "continue" — read `PROJECT_SPEC.md`, `foot_database.md`, and this file again before starting, per standing instructions.
- Picked Career Maze as the next target: `server/data/players.json` already has everything it needs (`careers[]` with club/startYear/endYear), so it was the lowest-friction remaining game after Who Am I?.
- Added `server/careerMazeEngine.ts` (timeline builder, well-travelled-player-biased random picker, guess resolver).
- Added `room.careerMaze` state + full round lifecycle to `server/index.ts` (5 rounds, full timeline revealed immediately per spec, 20s single round timer, open guessing, elapsed-time scoring, unsolved-round handling, game-end winner by total score).
- Added `src/lib/store/careerMaze.ts` and the `CareerMazeGame()` screen in `src/app/game/[id]/page.tsx` — animated vertical timeline using the existing `<ClubBadge/>` component, per spec §5.
- Verified `npx tsc --noEmit` and `npx eslint` clean across all new/changed files. Did not runtime-playtest.
- Updated this file.

### 2026-07-28 — Who Am I? built end-to-end
- Read `PROJECT_SPEC.md`, `foot_database.md`, and this file in full before starting, per standing instructions.
- Picked Who Am I? as the next Build Order step 3 target (dataset already has nationality/age/position/foot/careers/trophy-booleans, so it needed the least new data of the remaining 6 games).
- Added `server/whoAmIEngine.ts` (clue builder, random-target picker, guess resolver).
- Added `room.whoAmI` state + full round lifecycle to `server/index.ts` (5 rounds, 8 clues/round on a 4s reveal schedule, open guessing, early-guess scoring, unsolved-round handling, game-end winner by total score).
- Added `src/lib/store/whoami.ts` and the `WhoAmIGame()` screen in `src/app/game/[id]/page.tsx`.
- Hit and fixed a tooling mistake mid-session (see "Known gaps" below) — a file was first written to the wrong filesystem and had to be redone.
- Fixed one `eslint` error (`react-hooks/set-state-in-effect`) by moving guess-box reset from an effect to a render-time conditional update.
- Verified `npx tsc --noEmit` and `npx eslint` clean across all new/changed files. Did not runtime-playtest.
- Updated this file.

### 2026-07-28 — The Chain wired end-to-end
- Read `PROJECT_SPEC.md` and `foot_database.md` in full again, word for word, to confirm nothing in the previous session's read was missed.
- Audited the actual repo (`C:\Users\aziz\foot`) again: `server/chainEngine.ts` and `server/data/players.json` already existed from the prior session (engine + dataset), but `server/index.ts` had no chain-specific socket events yet and `src/app/game/[id]/page.tsx` didn't exist at all — so the game was not actually playable end-to-end despite the engine being ready.
- Exported `normalizeName` from `server/chainEngine.ts` (was a private `normalize` helper) so the room server can reuse the same accent-insensitive matching for "already used in this chain" checks.
- Added full chain game state + lifecycle to `server/index.ts`: init on `room:start`, `chain:submit` validation (unknown/repeat/non-teammate/Fire-Mode-violating guesses all eliminate), 10s per-turn server timer, turn advancement that skips eliminated players, Fire Mode auto-activation, win detection, and disconnect-as-elimination handling.
- Added `src/lib/store/chain.ts` (client-side mirror of server chain state) and `src/app/game/[id]/page.tsx` (the actual playable screen for The Chain, plus an honest "in development" placeholder for the other six games).
- Ran `npm install` (several declared dependencies — zustand, framer-motion, lucide-react, socket.io, socket.io-client — weren't actually present in `node_modules`), then verified `npx tsc --noEmit` and `npx eslint` both come back clean across the whole project.
- Updated this file.

### 2026-07-28 — Session start
- Read `PROJECT_SPEC.md` and `foot_database.md` in full.
- Audited the actual repo (`C:\Users\aziz\foot`) file by file against both specs — findings above.
- Created this progress file.
- Starting on The Chain (flagship game) end-to-end, per Build Order step 2.
