# Live Problems Log

Findings from real, live playtesting against the deployed URLs
(https://football-minds.vercel.app + the Render socket server), using two
real browser tabs, not local dev. See PROGRESS.md's 2026-07-29 "First real
live two-tab playtest" entry for the original motivation for this file.

---

## 🟢 FIXED — Guess The Player (1v1) crashed immediately on Start Game

**Reproduced:** 2026-07-30, two real browser tabs against the live site.

**Steps:**
1. Tab 1: Create Room → select "🧠 Guess The Player" → Mode: 1v1.
2. Tab 2: open the room URL, joins automatically, click "I'm ready".
3. Tab 1 (host): click "Start Game".

**Result:** Both tabs navigate to `/game/guess-the-player?room=<code>` and
immediately hit Next.js's client error boundary: "This page couldn't load /
Reload to try again, or go back." No further UI renders on either tab —
both players are stuck, the match cannot be played at all.

**Console error (identical on both tabs), production/minified bundle:**
```
TypeError: Cannot read properties of undefined (reading 'JoqxT5nlTS9seeoDAAAT')
    at q (.../1u9ist3o1ftk7.js:1:37766)
    at ay (.../25o46h8mdjlrg.js:1:63846)
    at oJ (.../25o46h8mdjlrg.js:1:84103)
    at iu (.../25o46h8mdjlrg.js:1:95705)
    at sd (.../25o46h8mdjlrg.js:1:138945)
    ...
```
The property key (`JoqxT5nlTS9seeoDAAAT`) is a webpack/RSC-generated hash,
not app source — so the minified production trace alone doesn't point at a
line in `src/app/game/[id]/page.tsx` or `server/index.ts`. All network
requests (including the `_rsc` fetch for this route and every JS chunk)
returned 200 — this is not a failed chunk load / 404, it's a genuine
runtime exception during React's render or commit phase.

**What I checked and ruled out by reading the source (not yet fixed):**
- `server/index.ts`'s `initGuessThePlayerGame` builds `teamOf` correctly
  for `mode === "1v1"` (each of the 2 joiners gets their own team, 1 and
  2) and `publicGuessThePlayerState` returns every field the client type
  expects, all non-optional and populated (`order`, `teamOf`, `leaders`,
  `agreedIds`, `locked`, `phase`, `questionOrder`-derived `currentAskerId`,
  `questionHistory`, `turnEndsAt`). No obvious server-side shape mismatch.
- `GuessThePlayerGame()` in `src/app/game/[id]/page.tsx` guards `!room` and
  `!state` before rendering the real screen, and every other place it reads
  `state.teamOf[...]`/`state.leaders[...]`/etc. is null-guarded with `myTeam
  ? ... : ...` patterns. Nothing jumped out as an obvious unguarded null
  dereference on a careful read.
- Given the AGENTS.md/CLAUDE.md warning that this Next.js version has
  breaking changes vs training data, this could plausibly be a
  framework-level issue (turbopack chunk `turbopack-2qc1nx4bbyqxi.js` is in
  the bundle) rather than app logic — worth checking
  `node_modules/next/dist/docs/` per that file's own instruction before
  assuming it's a bug in this project's own code.

**Not yet done, next session should do this first:**
1. Reproduce against **local dev** (`npm run dev:all`), not just
   production, since dev mode gives a real component stack + unminified
   error instead of a hashed property name — this is the fastest path to
   the actual line.
2. If it also reproduces in dev: add a `console.error` / `error.digest`
   logger to the root error boundary (or temporarily remove
   minification) to get a readable stack from the *production* build too,
   since Vercel's build could behave differently from `next dev`.
3. Also try **2v2** (not just 1v1) to see if the crash is 1v1-specific
   (e.g. something about `isSolo`/leader-less teams) or affects every mode.
4. Confirm whether this is new or pre-existing — no prior PROGRESS.md
   session ever actually playtested Guess The Player in a real browser
   (every session's sign-off was `tsc`/`eslint` only, explicitly flagged as
   a caveat every single time Guess The Player was touched) — so there's no
   baseline to compare against. This may have been broken since the
   turn-gated ask/guess rewrite (2026-07-30 session) or earlier.

**Impact:** Guess The Player is completely unplayable on the live site
right now, for every team size (1v1 confirmed; 2v2+ untested but likely
affected too since they share the same game screen component) — this
should be the top priority for the next session, ahead of any new feature
work.

**Re-confirmed 2026-07-30 (later session), same-shape crash, still unfixed:**
Fresh room, 1v1, two real tabs, Guess The Player selected, both ready,
host clicked Start Game — identical failure: both tabs immediately hit
the client error boundary ("This page couldn't load"). Console error is
the same shape with a different (as expected, build-specific) webpack
hash key: `TypeError: Cannot read properties of undefined (reading
'qc6KJmxdxf3Dl_ngAAAB')`, same call stack shape (`q` → `ay` → `oJ` → `iu`
→ `sd`...). This confirms the bug is still live on the current deployed
build and is consistently reproducible, not intermittent — nothing else
was attempted this session (no local-dev repro, no source fix), so
everything under "Not yet done" above still applies.

**Root cause found, 2026-07-30 (this session) — it's a deployment-skew bug, not app logic:**

Reproduced against **local dev** (`npm run dev:all`) first, per the "Not
yet done" list above — using the real `filesystem`/`terminal`/`chrome`
tooling against `C:\Users\aziz\foot`, not the sandbox. Two real tabs,
same steps as every prior reproduction: room created, Guess The Player +
1v1 selected, second tab joined, Start Game clicked. **It did not crash.**
The picking screen rendered cleanly on both tabs with zero console errors,
every time it was tried. This is the key fact every prior session's
reproduction attempt was missing: this bug reproduces 100% of the time on
the live deployed site and 0% of the time in local dev on the exact same
source — which rules out a logic bug in `GuessThePlayerGame()`,
`server/index.ts`'s Guess The Player handlers, or the client/server state
shape (all of which prior sessions already read carefully and correctly
found nothing wrong with — see "What I checked and ruled out" above; that
audit wasn't wrong, it was just looking in the right files for the wrong
kind of bug).

What's actually different between the two environments: in local dev,
Fast Refresh live-patches the running bundle to match source on every
save, so the JS the browser is executing and the JS `next dev` would
generate right now are *always* the same build — they can never drift
apart. On the deployed site, they can: this project's sessions push many
commits in quick succession while a room lobby may already be open in a
real browser tab (readying up, picking a game, etc.), and both Vercel and
Render auto-redeploy on every push (`DEPLOYMENT.md`). If a new deploy
lands on Vercel while a tab is still sitting on `/room/[code]`, that tab's
already-executing JS bundle has never loaded — and, once the old
deployment's build output eventually rolls off, may no longer be *able*
to load — the module chunks for whatever `/game/[id]` looks like under
the new deployment. The room page's `room:started` redirect used
`router.push(...)`, Next's client-side transition, which reuses that
already-loaded module registry rather than fetching a fresh document. It
resolves the target route's React Server Component/client-reference
manifest — which references modules by a short hashed id — against the
OLD bundle's registry, finds nothing at that id, and throws exactly
`TypeError: Cannot read properties of undefined (reading '<hash>')`. That
fully explains every observed detail that stumped earlier sessions: the
property name really is a webpack/RSC-generated hash rather than app
source (correctly identified above, just not yet connected to a cause);
every network request still returns 200 (nothing failed to *load* — the
already-running old bundle simply has no entry for a module id that only
exists in the new deployment, so nothing is ever requested for it); the
hash was different between the two live reproductions above
(`JoqxT5nlTS9seeoDAAAT` vs `qc6KJmxdxf3Dl_ngAAAB`) because each was a
different old-bundle-vs-new-deployment pairing; and it is 100%/0%
reproducible exactly along the live-vs-local-dev line, not intermittent
within either environment. The "Guess The Player (1v1)" framing in every
prior report was circumstantial, not causal — it happened to be the game
that was live-tested (right after a burst of commits actively changing
it) each time this was hit, but the same `router.push` pattern is used by
**every** game's "Back to lobby" button too, so any of them could have
hit the identical failure mode under the same timing.

**Fix**: changed the room→game redirect in `src/app/room/[code]/page.tsx`
from `router.push(...)` to `window.location.href = ...` — a real page
load always fetches the document (and therefore the module map) matching
whatever is *currently* deployed, no matter how long the tab has been
open or how many deploys have landed since, which is the one guarantee a
client-side transition can't make here. Applied the same fix to all 7
games' "Back to lobby" buttons in `src/app/game/[id]/page.tsx` (game →
room) for the identical reason — a match can easily run long enough for a
new commit to land underneath it too. No state is lost by paying for a
real page load at either point: the room page already rejoins from
`localStorage`'s remembered display name whenever it mounts without
existing room state (see its own join-on-mount effect), so a hard
navigation there reconnects and rejoins exactly as a fresh visit would.
Verified `npx tsc --noEmit`, `npx eslint .` (zero errors, the one
pre-existing `no-img-element` warning in `HeroPlayerWall.tsx` unrelated to
this change), and `npm run build` (production build, matching what Vercel
actually runs) all clean after the change.

**Not yet done**: this was fixed and verified via `tsc`/`eslint`/`build`
and a local-dev repro of the *original* bug, but the fix itself — i.e.
confirming the crash no longer happens on the *live* site after this
lands and Vercel/Render redeploy — still needs a real two-tab playtest
once the push below has had a minute to deploy. Next session (or later
this one, after pushing): repeat the exact repro steps above against
`https://football-minds.vercel.app` once more and confirm Guess The
Player is actually playable end-to-end now, then continue down the rest
of `PROGRESS.md`'s live-playtest priority list for the other 6 games.
