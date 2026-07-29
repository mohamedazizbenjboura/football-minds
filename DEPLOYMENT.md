# Deployment — Football Minds

> Answers exactly one question: **how does this go live for free, for up to
> 50 concurrent players, without your PC needing to stay on?**
> This is PROJECT_SPEC.md §1's non-negotiable rule, restated by the project
> owner as the single most important requirement of the whole project.

Short version: **two free services, no credit card required for either.**

| Piece | Service | Why |
|---|---|---|
| Frontend (Next.js) | Vercel free tier | Serves the website itself |
| Realtime gameplay (Socket.io) | Render free tier | Keeps room/game state in memory, broadcasts to players |
| Persistence (optional, not blocking) | Neon free tier | Only needed once the progression layer (XP/levels/leaderboards) is wired up — see "What's NOT required to go live" below |

Once steps 1–3 below are done, the game is a real URL anyone can open,
running on Render's and Vercel's servers — **not your computer.** You can
close your laptop and the room keeps running.

---

## 1. Deploy the Socket.io server (Render) — do this first

The frontend needs to know this URL before it can be deployed, so it comes first.

1. Push this repo to GitHub if it isn't already (`git remote add origin ...`, `git push`).
2. Go to https://dashboard.render.com → **New +** → **Blueprint**.
3. Connect the GitHub repo. Render will detect `render.yaml` at the repo
   root automatically and propose one service: `football-minds-socket`.
4. Click **Apply**. First deploy takes a few minutes (`npm install`, then
   `npm run start:socket`).
5. Once live, Render gives you a URL like
   `https://football-minds-socket.onrender.com`. **Copy it** — needed in step 2.
6. Leave `CLIENT_ORIGIN` unset for now (it's fine — Socket.io will just
   reject cross-origin requests from origins not yet on the list). You'll
   set it in step 3 once you have the Vercel URL.
7. Sanity check: open `https://football-minds-socket.onrender.com/health`
   in a browser. You should see `Football Minds socket server is running.`
   If you get a Render "not found" page instead, the deploy failed — check
   the Render dashboard's Logs tab.

**Free-tier reality, stated plainly:** Render's free Web Services sleep
after ~15 minutes idle and take 30-60 seconds to wake up on the next
request. Fine for "friends jump in a room together," not "always-hot
production server." No code change needed if this becomes an issue later —
just upgrade the Render plan, or ping `/health` periodically with a free
service like UptimeRobot to keep it warm.

---

## 2. Deploy the frontend (Vercel)

1. Go to https://vercel.com/new, import the same GitHub repo.
2. Framework preset: Vercel auto-detects Next.js — no changes needed.
3. Before the first deploy (or right after, then redeploy), add one
   environment variable in **Project Settings → Environment Variables**:
   - `NEXT_PUBLIC_SOCKET_URL` = the Render URL from step 1
     (e.g. `https://football-minds-socket.onrender.com`)
4. Deploy. Vercel gives you a URL like `https://football-minds.vercel.app`.

---

## 3. Close the loop — tell Render about the Vercel URL

Socket.io's CORS check (`server/index.ts`) only accepts connections from
origins listed in `CLIENT_ORIGIN`. Right now that's still unset from step 1.

1. Render dashboard → `football-minds-socket` → **Environment**.
2. Add `CLIENT_ORIGIN` = your Vercel URL (comma-separate multiple, e.g. the
   production URL plus any preview-deploy URL you use regularly):
   `https://football-minds.vercel.app`
3. Save — Render redeploys automatically with the new env var.

At this point the loop is closed: Vercel serves the site, browsers connect
to the Render socket server, Render only accepts connections from your
actual deployed site. Open the Vercel URL on two devices and create/join a
room to confirm realtime works end-to-end.

---

## 4. (Optional, not blocking) Postgres for progression

**Skip this section entirely if you just want the games playable.** Per
PROJECT_SPEC.md's own rule of thumb, nothing about *playing* a room/game
touches Postgres — rooms, scores mid-match, chat, The Chain/Who Am I?/Career
Maze state are all Socket.io memory. Postgres is only for what survives
between sessions: XP, levels, achievements, leaderboards (PROJECT_SPEC.md
§6) — and per PROGRESS.md, that layer hasn't been built yet regardless of
whether a database exists. So setting this up today buys nothing playable
yet; it's here for whenever the progression layer actually gets built.

1. https://neon.tech → free project → copy the connection string.
2. Vercel → Environment Variables → `DATABASE_URL` = that connection string.
3. Locally, put the same value in `.env` (already the pattern used for local
   dev against `docker-compose.yml`'s Postgres).
4. `npx prisma migrate deploy` against the Neon URL once there's an actual
   migration to run (`prisma/schema.prisma` exists; no migration has been
   generated yet — see PROGRESS.md).

---

## What "free hosting for 50 players" actually means here

- **Frontend**: Vercel's free tier has no meaningful traffic ceiling for a
  friend-group party game.
- **Realtime**: one Render free Web Service instance easily holds a single
  room of 50 Socket.io connections in memory — this isn't a heavy workload
  (small JSON messages, no media). The spec's 50-player cap was chosen
  specifically because it's comfortably free-tier (PROJECT_SPEC.md §1).
- **Cost at this scale: $0/month**, on both services, indefinitely, as long
  as usage stays within Vercel's and Render's free-tier limits (it will, at
  friend-group scale).
- **"Even if this PC is closed"**: once steps 1–3 are done, the code is
  running on Render's and Vercel's infrastructure, not `aziz`'s machine.
  Nothing about the app depends on any local process after that point.

## What this does NOT cover yet

- No custom domain (both services give you a free subdomain — good enough
  to ship; a custom domain is a later, optional step, not required for "up
  and free").
- No auth beyond guest mode (per spec, that's a later phase anyway).
- No monitoring/alerting beyond Render's built-in logs + the `/health`
  endpoint. Fine at this scale.
