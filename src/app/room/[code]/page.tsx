"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  Check,
  Crown,
  LogOut,
  Send,
  UserX,
  Loader2,
  Swords,
  Users2,
  ShieldCheck,
} from "lucide-react";
import { useRoomStore, TEAM_MODES, type RoomMode } from "@/lib/store/room";
import { GAMES, gameById } from "@/lib/games";

const DISPLAY_NAME_KEY = "fm:displayName";

// Only Guess The Player has real modes — every team size it supports,
// 1v1 through 5v5 (PROJECT_SPEC.md §4). Every other game is a single
// free-for-all experience and never shows a mode picker at all. 2v2+ all
// reuse the same "Users2" icon — the team-size number in the label does
// the rest.
const MODES: { id: RoomMode; label: string; icon: React.ReactNode }[] = [
  { id: "1v1", label: "1v1", icon: <Swords size={16} /> },
  { id: "2v2", label: "2v2", icon: <Users2 size={16} /> },
  { id: "3v3", label: "3v3", icon: <Users2 size={16} /> },
  { id: "4v4", label: "4v4", icon: <Users2 size={16} /> },
  { id: "5v5", label: "5v5", icon: <Users2 size={16} /> },
];

// The only game that currently has team-size modes. Every other game just
// runs as free-for-all under the hood — the host never needs to see or
// touch "Mode" for it.
const TEAM_MODE_GAMES = new Set(["guess-the-player"]);

function capacityForMode(mode: RoomMode): number {
  if (mode === "ffa") return 50;
  const m = /^(\d+)v(\d+)$/.exec(mode);
  return m ? Number(m[1]) * 2 : 50;
}

export default function RoomLobbyPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params?.code ?? "").toString().toUpperCase();

  const {
    room,
    selfId,
    error,
    joinRoom,
    leaveRoom,
    setReady,
    changeMode,
    assignTeam,
    changeGame,
    kick,
    startGame,
    sendChat,
    clearError,
  } = useRoomStore();

  // Lazily seeded from `room` so a mount where the store already has the
  // room (e.g. remounted while still connected) starts non-joining without
  // needing a synchronous setState-in-effect to correct it afterwards.
  const [joining, setJoining] = useState(() => !room);
  const [chatText, setChatText] = useState("");
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // If we land here directly (refresh, shared link) without room state yet,
  // rejoin using the name we remember locally. If there's no remembered
  // name, send them home to pick one via the entry modal.
  useEffect(() => {
    if (room) return; // already have room state — nothing to (re)join
    const name = typeof window !== "undefined" ? localStorage.getItem(DISPLAY_NAME_KEY) : null;
    if (!name) {
      router.replace("/");
      return;
    }
    joinRoom(code, name).then((ok) => {
      setJoining(false);
      if (!ok) {
        // room may simply not exist (bad/expired code) — bounce home
        setTimeout(() => router.replace("/"), 1500);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // BUG FIX (live-problems.md — "Guess The Player crashes immediately on
  // Start Game"): this used to be `router.push(...)`, a client-side
  // transition that reuses whatever JS chunks/RSC module registry the tab
  // already has loaded from whenever THIS page was first opened. Every
  // session in this project pushes multiple commits while real people are
  // sitting in a live lobby readying up — Vercel/Render both auto-redeploy
  // on every push (DEPLOYMENT.md). If a new deploy landed while a tab was
  // sitting on `/room/[code]`, that tab's already-executing bundle has
  // never loaded (and, after the old deployment's assets eventually roll
  // off, may no longer be ABLE to load) the chunks for whatever `/game/[id]`
  // looks like in the new deployment. `router.push` doesn't reload the
  // document, so it tries to resolve the new route's React Server
  // Component/client-reference manifest against the OLD bundle's module
  // registry and throws `Cannot read properties of undefined (reading
  // '<hashed-module-id>')` — which is exactly the error signature recorded
  // in live-problems.md (a webpack/RSC-generated hash, not app source, and
  // every network request still returning 200 — nothing failed to load,
  // the already-loaded runtime just doesn't know that module id). This
  // reproduces 100% of the time in that scenario and 0% of the time in
  // local dev, where Fast Refresh keeps the running bundle live-patched to
  // match source on every save, so the two can never drift apart — which
  // matches exactly what was observed (unreproducible locally, 100%
  // reproducible live). A full navigation always fetches a fresh HTML
  // document (and therefore the CURRENT deployment's chunk map) no matter
  // how long this tab has been open or how many deploys have landed since,
  // which is the one guarantee a client-side transition can't make here.
  // The socket reconnects and rejoins the room automatically on the new
  // page load (see the join-on-mount effect on `/game/[id]`'s equivalent
  // pattern and this page's own rejoin-from-localStorage effect above), so
  // there's no state actually lost by paying for a real page load here.
  useEffect(() => {
    if (room?.started && room.gameId) {
      window.location.href = `/game/${room.gameId}?room=${room.code}`;
    }
  }, [room?.started, room?.gameId, room?.code]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [room?.chat.length]);

  if (joining) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <Loader2 className="animate-spin text-[var(--color-primary)]" size={36} />
        <p className="text-gray-400">Joining room {code}…</p>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-xl font-bold">Couldn&apos;t join room {code}</p>
        <p className="text-gray-400 max-w-sm">{error ?? "That room may not exist anymore."}</p>
      </main>
    );
  }

  const self = room.players.find((p) => p.socketId === selfId);
  const isHost = self?.isHost ?? false;
  const capacity = capacityForMode(room.mode);
  const nonHostPlayers = room.players.filter((p) => !p.isHost);
  const everyoneReady = nonHostPlayers.length > 0 && nonHostPlayers.every((p) => p.ready);
  const currentGame = gameById(room.gameId ?? undefined);
  // Team picking only matters once a side genuinely has more than one
  // player — 1v1 assigns the two joiners to a side of one automatically
  // server-side, no lobby step needed (PROJECT_SPEC.md §5.1).
  const showTeamPicker = TEAM_MODES.includes(room.mode) && room.mode !== "1v1";
  const perTeamCap = capacity / 2;
  const team1 = room.players.filter((p) => p.team === 1);
  const team2 = room.players.filter((p) => p.team === 2);
  const unassigned = room.players.filter((p) => p.team !== 1 && p.team !== 2);
  // Leader = first-joined member of the team, same rule the server uses.
  const leader1Id = team1[0]?.socketId ?? null;
  const leader2Id = team2[0]?.socketId ?? null;

  function copyCode() {
    navigator.clipboard?.writeText(room!.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleStart() {
    setStarting(true);
    await startGame();
    setStarting(false);
  }

  function handleLeave() {
    leaveRoom();
    router.push("/");
  }

  function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    sendChat(text);
    setChatText("");
  }

  // Host picks the game first; the mode picker only shows up afterward, and
  // only for games that actually have specialized modes (currently just
  // Guess The Player). Switching into/out of that game keeps `room.mode` in
  // sync so capacity + the Teams panel are never left pointing at a mode
  // that no longer makes sense for the newly selected game.
  function handleSelectGame(gameId: string) {
    changeGame(gameId);
    if (!room) return;
    if (TEAM_MODE_GAMES.has(gameId)) {
      if (room.mode === "ffa") changeMode("1v1");
    } else if (room.mode !== "ffa") {
      changeMode("ffa");
    }
  }

  return (
    <main className="min-h-screen px-4 pt-10 pb-28 max-w-5xl mx-auto w-full flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={copyCode}
            className="flex items-center gap-2 glass rounded-2xl px-4 py-3 font-mono text-2xl font-bold tracking-[0.25em] hover:border-[var(--color-primary)]/50 border border-transparent transition-colors"
          >
            {room.code}
            {copied ? (
              <Check size={18} className="text-[var(--color-primary)]" />
            ) : (
              <Copy size={18} className="text-gray-400" />
            )}
          </button>
          <span className="text-sm text-gray-400">
            {room.players.length}/{capacity} players
          </span>
        </div>
        <button
          onClick={handleLeave}
          className="flex items-center gap-2 text-gray-400 hover:text-red-400 transition-colors text-sm font-semibold"
        >
          <LogOut size={16} /> Leave
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2.5 flex items-center justify-between">
          {error}
          <button onClick={clearError} className="underline">dismiss</button>
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Left: setup + players */}
        <div className="flex flex-col gap-6">
          {/* Game + mode select (host only editable) */}
          <div className="glass rounded-3xl p-5 flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Game</p>
              {isHost ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {GAMES.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => handleSelectGame(g.id)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors text-left ${
                        room.gameId === g.id
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "border-white/10 bg-white/5 text-gray-300 hover:border-white/20"
                      }`}
                    >
                      <span>{g.icon}</span>
                      <span className="truncate">{g.title}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="glass rounded-xl px-4 py-3 flex items-center gap-2">
                  <span className="text-xl">{currentGame?.icon ?? "❓"}</span>
                  <span className="font-semibold">
                    {currentGame?.title ?? "Waiting for host to pick a game…"}
                  </span>
                </div>
              )}
            </div>

            {/* Mode only exists for games that have real team sizes (right now,
                just Guess The Player) — nothing renders here at all until the
                host picks one of those games. */}
            {room.gameId && TEAM_MODE_GAMES.has(room.gameId) && (
              <div>
                <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Mode</p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      disabled={!isHost}
                      onClick={() => changeMode(m.id)}
                      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-sm font-bold transition-colors ${
                        room.mode === m.id
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "border-white/10 bg-white/5 text-gray-300"
                      } ${!isHost ? "opacity-60 cursor-not-allowed" : "hover:border-white/20"}`}
                    >
                      {m.icon}
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Teams — only for 2v2+ (1v1 auto-assigns, ffa has no teams) */}
          {showTeamPicker && (
            <div className="glass rounded-3xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Teams — {room.mode}
                </p>
                <p className="text-xs text-gray-500">Max {perTeamCap} per side</p>
              </div>
              {unassigned.length > 0 && (
                <p className="text-xs text-[var(--color-accent)] bg-[var(--color-accent)]/10 rounded-lg px-3 py-2 mb-3">
                  Everyone needs to join a team before the host can start.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([1, 2] as const).map((team) => {
                  const members = team === 1 ? team1 : team2;
                  const leaderId = team === 1 ? leader1Id : leader2Id;
                  const full = members.length >= perTeamCap;
                  const onThisTeam = self?.team === team;
                  return (
                    <div
                      key={team}
                      className={`rounded-2xl p-3 border ${
                        team === 1
                          ? "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5"
                          : "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold">
                          Team {team} ({members.length}/{perTeamCap})
                        </span>
                        <button
                          onClick={() => assignTeam(team)}
                          disabled={onThisTeam || (full && !onThisTeam)}
                          className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${
                            onThisTeam
                              ? "bg-white/10 text-gray-500 cursor-default"
                              : full
                              ? "bg-white/5 text-gray-600 cursor-not-allowed"
                              : "bg-white/10 text-white hover:bg-white/20"
                          }`}
                        >
                          {onThisTeam ? "Joined" : full ? "Full" : "Join"}
                        </button>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {members.length === 0 && (
                          <p className="text-xs text-gray-500 italic px-1">No one yet</p>
                        )}
                        {members.map((p) => (
                          <div
                            key={p.socketId}
                            className="flex items-center gap-1.5 text-sm bg-white/5 rounded-lg px-2.5 py-1.5"
                          >
                            {p.socketId === leaderId && (
                              <ShieldCheck size={13} className="text-[var(--color-primary)] shrink-0" />
                            )}
                            <span className="truncate">{p.displayName}</span>
                            {p.socketId === selfId && <span className="text-gray-500 text-xs">(you)</span>}
                            {p.socketId === leaderId && (
                              <span className="text-[10px] text-gray-400 ml-auto shrink-0">leader</span>
                            )}
                            {isHost && (
                              <button
                                onClick={() => assignTeam(team === 1 ? 2 : 1, p.socketId)}
                                className="ml-auto text-[10px] text-gray-500 hover:text-white shrink-0 font-semibold"
                              >
                                move → Team {team === 1 ? 2 : 1}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {isHost && unassigned.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {unassigned.map((p) => (
                    <div key={p.socketId} className="flex items-center gap-1.5 bg-white/5 rounded-lg px-2.5 py-1.5 text-xs">
                      <span>{p.displayName}</span>
                      <button
                        onClick={() => assignTeam(1, p.socketId)}
                        className="text-[var(--color-primary)] font-bold hover:underline"
                      >
                        → Team 1
                      </button>
                      <button
                        onClick={() => assignTeam(2, p.socketId)}
                        className="text-[var(--color-accent)] font-bold hover:underline"
                      >
                        → Team 2
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Players */}
          <div className="glass rounded-3xl p-5">
            <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">
              Players
            </p>
            <div className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {room.players.map((p) => (
                  <motion.div
                    key={p.socketId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] flex items-center justify-center font-bold text-sm shrink-0">
                        {p.displayName.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="font-semibold truncate">{p.displayName}</span>
                      {p.isHost && <Crown size={16} className="text-[var(--color-accent)] shrink-0" />}
                      {p.socketId === selfId && (
                        <span className="text-xs text-gray-500 shrink-0">(you)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!p.isHost && (
                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                            p.ready
                              ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                              : "bg-white/10 text-gray-400"
                          }`}
                        >
                          {p.ready ? "Ready" : "Not ready"}
                        </span>
                      )}
                      {isHost && p.socketId !== selfId && (
                        <button
                          onClick={() => kick(p.socketId)}
                          className="text-gray-500 hover:text-red-400 transition-colors p-1"
                          aria-label={`Kick ${p.displayName}`}
                        >
                          <UserX size={16} />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Right: chat */}
        <div className="glass rounded-3xl p-5 flex flex-col h-[420px] lg:h-auto">
          <p className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">Chat</p>
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 mb-3">
            {room.chat.length === 0 && (
              <p className="text-sm text-gray-500 italic">Say hi to the lobby 👋</p>
            )}
            {room.chat.map((m) => (
              <div key={m.id} className="text-sm">
                <span className="font-bold text-[var(--color-primary)]">{m.from}: </span>
                <span className="text-gray-200">{m.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={handleSendChat} className="flex gap-2">
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              maxLength={280}
              placeholder="Type a message…"
              className="flex-1 h-11 px-3 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none text-sm transition-colors"
            />
            <button
              type="submit"
              className="w-11 h-11 rounded-xl bg-[var(--color-primary)] text-black flex items-center justify-center shrink-0 hover:bg-[var(--color-primary-dark)] transition-colors"
              aria-label="Send"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 glass border-t border-white/10 flex items-center justify-center gap-4">
        {isHost ? (
          <button
            onClick={handleStart}
            disabled={!room.gameId || !everyoneReady || starting}
            className="w-full max-w-md h-14 rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold text-lg flex items-center justify-center gap-2 transition-colors"
          >
            {starting ? (
              <Loader2 size={20} className="animate-spin" />
            ) : !room.gameId ? (
              "Pick a game first"
            ) : !everyoneReady ? (
              "Waiting for everyone to be ready…"
            ) : (
              "Start Game"
            )}
          </button>
        ) : (
          <button
            onClick={() => setReady(!self?.ready)}
            className={`w-full max-w-md h-14 rounded-xl font-bold text-lg transition-colors ${
              self?.ready
                ? "bg-white/10 text-gray-300 hover:bg-white/15"
                : "bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] text-black"
            }`}
          >
            {self?.ready ? "Cancel ready" : "I'm ready"}
          </button>
        )}
      </div>
    </main>
  );
}
