"use client";

/**
 * /game/[id] — PROJECT_SPEC.md §5 "The Games".
 * Routed to from the room lobby once the host starts a match
 * (see src/app/room/[code]/page.tsx's `room:started` redirect).
 *
 * "the-chain", "who-am-i", "career-maze", "last-man-standing",
 * "guess-the-player", and "football-pyramid" are real, playable game
 * engines right now — see PROGRESS.md for status on the remaining one
 * ("shirt-madness"). Every other id renders an honest "in development"
 * screen instead of a broken/empty page.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Clock, Flame, Trophy, Skull, Send, Construction, HelpCircle, Sparkles } from "lucide-react";
import { useRoomStore } from "@/lib/store/room";
import { useChainStore, type ChainPosition } from "@/lib/store/chain";
import { useWhoAmIStore } from "@/lib/store/whoami";
import { useCareerMazeStore } from "@/lib/store/careerMaze";
import { useLastManStandingStore } from "@/lib/store/lastManStanding";
import { useGuessThePlayerStore } from "@/lib/store/guessThePlayer";
import { useFootballPyramidStore } from "@/lib/store/footballPyramid";
import { gameById } from "@/lib/games";
import PlayerAvatar from "@/components/PlayerAvatar";
import ClubBadge from "@/components/ClubBadge";
import PlayerSearchPicker from "@/components/PlayerSearchPicker";

export default function GamePage() {
  const params = useParams<{ id: string }>();
  const gameId = (params?.id ?? "").toString();

  if (gameId === "the-chain") {
    return <TheChainGame />;
  }
  if (gameId === "who-am-i") {
    return <WhoAmIGame />;
  }
  if (gameId === "career-maze") {
    return <CareerMazeGame />;
  }
  if (gameId === "last-man-standing") {
    return <LastManStandingGame />;
  }
  if (gameId === "guess-the-player") {
    return <GuessThePlayerGame />;
  }
  if (gameId === "football-pyramid") {
    return <FootballPyramidGame />;
  }
  return <ComingSoon gameId={gameId} />;
}

// ---------------------------------------------------------------------------
// Placeholder for the 6 games not built yet (honest, not a broken page)
// ---------------------------------------------------------------------------

function ComingSoon({ gameId }: { gameId: string }) {
  const router = useRouter();
  const game = gameById(gameId);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="glass rounded-3xl p-10 max-w-md flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-primary)]/10 flex items-center justify-center text-3xl">
          {game?.icon ?? "🚧"}
        </div>
        <h1 className="text-2xl font-bold">{game?.title ?? "This game"}</h1>
        <p className="text-gray-400">{game?.description}</p>
        <div className="flex items-center gap-2 text-sm text-[var(--color-accent)] bg-[var(--color-accent)]/10 rounded-full px-4 py-2">
          <Construction size={16} />
          In active development — The Chain, Who Am I?, Career Maze, Last Man Standing, Guess The Player, and Football Pyramid are fully playable now.
        </div>
        <button
          onClick={() => router.push("/")}
          className="mt-2 flex items-center gap-2 text-[var(--color-primary)] font-semibold hover:underline"
        >
          <ArrowLeft size={16} /> Back home
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// The Chain — the flagship game, fully playable
// ---------------------------------------------------------------------------

function wrongReasonLabel(reason: string): string {
  switch (reason) {
    case "not-found":
      return "not a recognized player";
    case "already-used":
      return "already used in this chain";
    case "not-teammates":
      return "never a teammate of the last player";
    case "modifier":
      return "doesn't match the Fire Mode rule";
    default:
      return reason;
  }
}

function TheChainGame() {
  const router = useRouter();
  const { room, selfId } = useRoomStore();
  const { state, lastWrong, fireModeBanner, attach, sync, submit, clearFireModeBanner } =
    useChainStore();
  const [guess, setGuess] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    attach();
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!fireModeBanner) return;
    const t = setTimeout(() => clearFireModeBanner(), 4000);
    return () => clearTimeout(t);
  }, [fireModeBanner, clearFireModeBanner]);

  function nameOf(id: string | null) {
    return room?.players.find((p) => p.socketId === id)?.displayName ?? "—";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text || !isMyTurn) return;
    submit(text);
    setGuess("");
  }

  if (!room) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-xl font-bold">No active room</p>
        <button
          onClick={() => router.push("/")}
          className="text-[var(--color-primary)] font-semibold hover:underline"
        >
          Back home
        </button>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-gray-400">Loading The Chain…</p>
      </main>
    );
  }

  const isMyTurn = Boolean(!state.winnerId && state.currentPlayerId === selfId);
  const amEliminated = state.eliminated.includes(selfId ?? "");
  const secondsLeft = state.turnEndsAt ? Math.max(0, Math.ceil((state.turnEndsAt - now) / 1000)) : null;
  const lastEntry = state.chain[state.chain.length - 1];

  if (state.winnerId) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass rounded-3xl p-10 max-w-md flex flex-col items-center gap-4"
        >
          <Trophy size={48} className="text-[var(--color-accent)]" />
          <h1 className="text-3xl font-bold">{nameOf(state.winnerId)} wins!</h1>
          <p className="text-gray-400">
            Survived a {state.chain.length}-player chain
            {state.modifier ? ` through Fire Mode: ${state.modifier.description}` : ""}.
          </p>
          <button
            onClick={() => router.push(`/room/${room.code}`)}
            className="mt-2 h-12 px-6 rounded-xl bg-[var(--color-primary)] text-black font-bold hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Back to lobby
          </button>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 pt-6 pb-32 max-w-3xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/room/${room.code}`)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-semibold"
        >
          <ArrowLeft size={16} /> Lobby
        </button>
        <div className="flex items-center gap-2 font-mono font-bold text-lg">
          <Clock
            size={18}
            className={secondsLeft !== null && secondsLeft <= 3 ? "text-red-400" : "text-[var(--color-primary)]"}
          />
          <span className={secondsLeft !== null && secondsLeft <= 3 ? "text-red-400" : ""}>
            {secondsLeft ?? "-"}s
          </span>
        </div>
      </div>

      <AnimatePresence>
        {fireModeBanner && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 bg-orange-500/15 border border-orange-500/30 text-orange-300 rounded-2xl px-4 py-3 font-bold"
          >
            <Flame size={20} /> Fire Mode: {fireModeBanner}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Turn banner */}
      <div
        className={`glass rounded-2xl px-5 py-4 flex items-center justify-between gap-3 ${
          isMyTurn ? "border border-[var(--color-primary)]/60" : ""
        }`}
      >
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Current turn</p>
          <p className="font-bold text-lg">{isMyTurn ? "You!" : nameOf(state.currentPlayerId)}</p>
        </div>
        {lastEntry && (
          <div className="flex items-center gap-2 min-w-0">
            <PlayerAvatar name={lastEntry.name} position={lastEntry.position as ChainPosition} size={44} ring />
            <div className="text-right min-w-0">
              <p className="font-semibold text-sm truncate">{lastEntry.name}</p>
              <p className="text-xs text-gray-400">Name a real teammate</p>
            </div>
          </div>
        )}
      </div>

      {state.modifier && (
        <div className="flex items-center gap-2 text-sm text-orange-300 bg-orange-500/10 rounded-xl px-4 py-2.5">
          <Flame size={16} /> Fire Mode active: {state.modifier.description}
        </div>
      )}

      {/* Chain history */}
      <div className="glass rounded-3xl p-4 flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
        <AnimatePresence initial={false}>
          {state.chain.map((entry, i) => (
            <motion.div
              key={`${entry.name}-${i}`}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2"
            >
              <PlayerAvatar name={entry.name} position={entry.position} size={40} />
              <div className="min-w-0">
                <p className="font-semibold truncate">{entry.name}</p>
                <p className="text-xs text-gray-400 truncate">
                  {entry.nationality} · named by {entry.by}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Players / eliminated */}
      <div className="flex flex-wrap gap-2">
        {state.order.map((id) => {
          const eliminated = state.eliminated.includes(id);
          return (
            <span
              key={id}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${
                eliminated
                  ? "bg-red-500/10 text-red-400 line-through"
                  : id === state.currentPlayerId
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "bg-white/5 text-gray-300"
              }`}
            >
              {eliminated && <Skull size={12} />}
              {nameOf(id)}
              {id === selfId ? " (you)" : ""}
            </span>
          );
        })}
      </div>

      {lastWrong && lastWrong.playerId === selfId && (
        <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2.5">
          {lastWrong.reason === "timeout"
            ? "Time's up — eliminated."
            : `"${lastWrong.guess}" didn't work (${wrongReasonLabel(lastWrong.reason)}) — eliminated.`}
        </p>
      )}

      {amEliminated && !lastWrong && (
        <p className="text-sm text-gray-400 bg-white/5 rounded-xl px-4 py-2.5">
          You&apos;re out — watching the rest of the chain play out.
        </p>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="fixed bottom-0 left-0 right-0 p-4 glass border-t border-white/10 flex justify-center"
      >
        <div className="w-full max-w-3xl flex gap-2">
          <input
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            disabled={!isMyTurn}
            placeholder={isMyTurn ? "Name a teammate…" : amEliminated ? "You're eliminated" : "Waiting for your turn…"}
            className="flex-1 h-14 px-4 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none disabled:opacity-40 transition-colors"
          />
          <button
            type="submit"
            disabled={!isMyTurn || !guess.trim()}
            className="w-14 h-14 rounded-xl bg-[var(--color-primary)] text-black flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-[var(--color-primary-dark)] transition-colors"
            aria-label="Submit"
          >
            <Send size={20} />
          </button>
        </div>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Career Maze — fully playable
// ---------------------------------------------------------------------------

function CareerMazeGame() {
  const router = useRouter();
  const { room, selfId } = useRoomStore();
  const { state, lastSolved, attach, sync, submit } = useCareerMazeStore();
  const [guess, setGuess] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    attach();
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Clear the guess box whenever a new round starts (derived during render,
  // not an effect, to avoid a synchronous setState-in-effect cascade).
  const [guessRound, setGuessRound] = useState<number | null>(null);
  if (state && state.round !== guessRound) {
    setGuessRound(state.round);
    if (guess) setGuess("");
  }

  function nameOf(id: string | null) {
    return room?.players.find((p) => p.socketId === id)?.displayName ?? "—";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text || state?.phase !== "guess") return;
    submit(text);
    setGuess("");
  }

  if (!room) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-xl font-bold">No active room</p>
        <button
          onClick={() => router.push("/")}
          className="text-[var(--color-primary)] font-semibold hover:underline"
        >
          Back home
        </button>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-gray-400">Loading Career Maze…</p>
      </main>
    );
  }

  const sortedScores = Object.entries(state.scores).sort(([, a], [, b]) => b - a);
  const secondsLeft = state.roundEndsAt ? Math.max(0, Math.ceil((state.roundEndsAt - now) / 1000)) : null;

  if (state.phase === "gameEnd") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass rounded-3xl p-10 max-w-md w-full flex flex-col items-center gap-4"
        >
          <Trophy size={48} className="text-[var(--color-accent)]" />
          <h1 className="text-3xl font-bold">{nameOf(state.winnerId)} wins!</h1>
          <p className="text-gray-400">After {state.totalRounds} rounds of Career Maze</p>
          <div className="w-full flex flex-col gap-2 mt-2">
            {sortedScores.map(([id, score], i) => (
              <div
                key={id}
                className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${
                  i === 0 ? "bg-[var(--color-primary)]/15" : "bg-white/5"
                }`}
              >
                <span className="font-semibold">
                  {i + 1}. {nameOf(id)}
                  {id === selfId ? " (you)" : ""}
                </span>
                <span className="font-bold font-mono">{score} pts</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => router.push(`/room/${room.code}`)}
            className="mt-2 h-12 px-6 rounded-xl bg-[var(--color-primary)] text-black font-bold hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Back to lobby
          </button>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 pt-6 pb-32 max-w-3xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/room/${room.code}`)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-semibold"
        >
          <ArrowLeft size={16} /> Lobby
        </button>
        <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
          Round {state.round} / {state.totalRounds}
        </div>
        {state.phase === "guess" && (
          <div className="flex items-center gap-2 font-mono font-bold text-lg">
            <Clock
              size={18}
              className={secondsLeft !== null && secondsLeft <= 5 ? "text-red-400" : "text-[var(--color-primary)]"}
            />
            <span className={secondsLeft !== null && secondsLeft <= 5 ? "text-red-400" : ""}>
              {secondsLeft ?? "—"}s
            </span>
          </div>
        )}
      </div>

      {/* Solved / round-end banner */}
      <AnimatePresence>
        {state.phase !== "guess" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`flex items-center gap-3 rounded-2xl px-5 py-4 ${
              state.solvedBy
                ? "bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/40"
                : "bg-white/5 border border-white/10"
            }`}
          >
            {state.solvedBy ? (
              <Sparkles className="text-[var(--color-primary)]" size={22} />
            ) : (
              <HelpCircle className="text-gray-400" size={22} />
            )}
            <div>
              <p className="font-bold">
                {state.solvedBy
                  ? `${nameOf(state.solvedBy)} got it! ${lastSolved && lastSolved.playerId === state.solvedBy ? `+${lastSolved.points} pts` : ""}`
                  : "Time's up — nobody guessed it."}
              </p>
              <p className="text-sm text-gray-400">
                It was <span className="font-semibold text-white">{state.targetName}</span> — next round starting…
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Animated vertical timeline */}
      <div className="glass rounded-3xl p-5 flex flex-col gap-1">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2">Club history</p>
        {state.timeline.map((stop, i) => (
          <motion.div
            key={`${stop.club}-${i}`}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className="flex items-center gap-4 relative pb-5 last:pb-0"
          >
            {/* Connector line */}
            {i < state.timeline.length - 1 && (
              <span className="absolute left-6 top-12 bottom-0 w-0.5 bg-white/10" aria-hidden />
            )}
            <ClubBadge name={stop.club} size={48} />
            <div className="min-w-0">
              <p className="font-bold truncate">{stop.club}</p>
              <p className="text-sm text-gray-400">
                {stop.startYear} – {stop.endYear}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Live scoreboard */}
      <div className="flex flex-wrap gap-2">
        {sortedScores.map(([id, score]) => (
          <span
            key={id}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-white/5 text-gray-300"
          >
            {nameOf(id)}
            {id === selfId ? " (you)" : ""}: {score}
          </span>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="fixed bottom-0 left-0 right-0 p-4 glass border-t border-white/10 flex justify-center"
      >
        <div className="w-full max-w-3xl flex gap-2">
          <input
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            disabled={state.phase !== "guess"}
            placeholder={state.phase === "guess" ? "Who played there?…" : "Waiting for next round…"}
            className="flex-1 h-14 px-4 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none disabled:opacity-40 transition-colors"
          />
          <button
            type="submit"
            disabled={state.phase !== "guess" || !guess.trim()}
            className="w-14 h-14 rounded-xl bg-[var(--color-primary)] text-black flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-[var(--color-primary-dark)] transition-colors"
            aria-label="Submit"
          >
            <Send size={20} />
          </button>
        </div>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Who Am I? — fully playable
// ---------------------------------------------------------------------------

function WhoAmIGame() {
  const router = useRouter();
  const { room, selfId } = useRoomStore();
  const { state, lastSolved, attach, sync, submit } = useWhoAmIStore();
  const [guess, setGuess] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    attach();
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Clear the guess box whenever a new round starts (derived during render,
  // not an effect, to avoid a synchronous setState-in-effect cascade).
  const [guessRound, setGuessRound] = useState<number | null>(null);
  if (state && state.round !== guessRound) {
    setGuessRound(state.round);
    if (guess) setGuess("");
  }

  function nameOf(id: string | null) {
    return room?.players.find((p) => p.socketId === id)?.displayName ?? "—";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text || state?.phase !== "clue") return;
    submit(text);
    setGuess("");
  }

  if (!room) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-xl font-bold">No active room</p>
        <button
          onClick={() => router.push("/")}
          className="text-[var(--color-primary)] font-semibold hover:underline"
        >
          Back home
        </button>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-gray-400">Loading Who Am I?…</p>
      </main>
    );
  }

  const sortedScores = Object.entries(state.scores).sort(([, a], [, b]) => b - a);
  const secondsToNextClue = state.nextClueAt
    ? Math.max(0, Math.ceil((state.nextClueAt - now) / 1000))
    : null;

  if (state.phase === "gameEnd") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass rounded-3xl p-10 max-w-md w-full flex flex-col items-center gap-4"
        >
          <Trophy size={48} className="text-[var(--color-accent)]" />
          <h1 className="text-3xl font-bold">{nameOf(state.winnerId)} wins!</h1>
          <p className="text-gray-400">After {state.totalRounds} rounds of Who Am I?</p>
          <div className="w-full flex flex-col gap-2 mt-2">
            {sortedScores.map(([id, score], i) => (
              <div
                key={id}
                className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${
                  i === 0 ? "bg-[var(--color-primary)]/15" : "bg-white/5"
                }`}
              >
                <span className="font-semibold">
                  {i + 1}. {nameOf(id)}
                  {id === selfId ? " (you)" : ""}
                </span>
                <span className="font-bold font-mono">{score} pts</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => router.push(`/room/${room.code}`)}
            className="mt-2 h-12 px-6 rounded-xl bg-[var(--color-primary)] text-black font-bold hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Back to lobby
          </button>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 pt-6 pb-32 max-w-3xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/room/${room.code}`)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-semibold"
        >
          <ArrowLeft size={16} /> Lobby
        </button>
        <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
          Round {state.round} / {state.totalRounds}
        </div>
        {state.phase === "clue" && (
          <div className="flex items-center gap-2 font-mono font-bold text-lg">
            <Clock
              size={18}
              className={
                secondsToNextClue !== null && secondsToNextClue <= 1
                  ? "text-red-400"
                  : "text-[var(--color-primary)]"
              }
            />
            <span>{secondsToNextClue ?? "—"}s</span>
          </div>
        )}
      </div>

      {/* Solved / round-end banner */}
      <AnimatePresence>
        {state.phase !== "clue" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`flex items-center gap-3 rounded-2xl px-5 py-4 ${
              state.solvedBy
                ? "bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/40"
                : "bg-white/5 border border-white/10"
            }`}
          >
            {state.solvedBy ? (
              <Sparkles className="text-[var(--color-primary)]" size={22} />
            ) : (
              <HelpCircle className="text-gray-400" size={22} />
            )}
            <div>
              <p className="font-bold">
                {state.solvedBy
                  ? `${nameOf(state.solvedBy)} got it! ${lastSolved && lastSolved.playerId === state.solvedBy ? `+${lastSolved.points} pts` : ""}`
                  : "Nobody guessed it in time."}
              </p>
              <p className="text-sm text-gray-400">
                It was <span className="font-semibold text-white">{state.targetName}</span> — next round starting…
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clue list */}
      <div className="glass rounded-3xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
            Clue {state.cluesRevealed} of {state.totalClues}
          </p>
          <div className="flex gap-1">
            {Array.from({ length: state.totalClues }).map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full ${
                  i < state.cluesRevealed ? "bg-[var(--color-primary)]" : "bg-white/10"
                }`}
              />
            ))}
          </div>
        </div>
        <AnimatePresence initial={false}>
          {state.clues.map((clue, i) => (
            <motion.div
              key={`${clue.label}-${i}`}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3"
            >
              <span className="text-sm text-gray-400 font-semibold">{clue.label}</span>
              <span className="font-bold">{clue.value}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Live scoreboard */}
      <div className="flex flex-wrap gap-2">
        {sortedScores.map(([id, score]) => (
          <span
            key={id}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-white/5 text-gray-300"
          >
            {nameOf(id)}
            {id === selfId ? " (you)" : ""}: {score}
          </span>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="fixed bottom-0 left-0 right-0 p-4 glass border-t border-white/10 flex justify-center"
      >
        <div className="w-full max-w-3xl flex gap-2">
          <input
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            disabled={state.phase !== "clue"}
            placeholder={state.phase === "clue" ? "Who is it?…" : "Waiting for next round…"}
            className="flex-1 h-14 px-4 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none disabled:opacity-40 transition-colors"
          />
          <button
            type="submit"
            disabled={state.phase !== "clue" || !guess.trim()}
            className="w-14 h-14 rounded-xl bg-[var(--color-primary)] text-black flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-[var(--color-primary-dark)] transition-colors"
            aria-label="Submit"
          >
            <Send size={20} />
          </button>
        </div>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Last Man Standing — fully playable
// ---------------------------------------------------------------------------

function lastManStandingReasonLabel(reason: string | null): string {
  switch (reason) {
    case "no-answer":
      return "no answer submitted in time";
    case "not-found":
      return "not a recognized player";
    case "doesnt-match":
      return "doesn't match the prompt";
    case "duplicate":
      return "someone else gave the same answer";
    default:
      return "";
  }
}

function LastManStandingGame() {
  const router = useRouter();
  const { room, selfId } = useRoomStore();
  const { state, attach, sync, submit } = useLastManStandingStore();
  const [guess, setGuess] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    attach();
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Clear the guess box whenever a new round starts (derived during render,
  // not an effect, to avoid a synchronous setState-in-effect cascade).
  const [guessRound, setGuessRound] = useState<number | null>(null);
  if (state && state.roundNumber !== guessRound) {
    setGuessRound(state.roundNumber);
    if (guess) setGuess("");
  }

  function nameOf(id: string | null) {
    return room?.players.find((p) => p.socketId === id)?.displayName ?? "—";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text || state?.phase !== "answering" || alreadyAnswered || amEliminated) return;
    submit(text);
    setGuess("");
  }

  if (!room) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-xl font-bold">No active room</p>
        <button
          onClick={() => router.push("/")}
          className="text-[var(--color-primary)] font-semibold hover:underline"
        >
          Back home
        </button>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-gray-400">Loading Last Man Standing…</p>
      </main>
    );
  }

  const amEliminated = state.eliminated.includes(selfId ?? "");
  const alreadyAnswered = state.answeredPlayerIds.includes(selfId ?? "");
  const secondsLeft = state.roundEndsAt ? Math.max(0, Math.ceil((state.roundEndsAt - now) / 1000)) : null;
  const survivorCount = state.order.filter((id) => !state.eliminated.includes(id)).length;

  if (state.phase === "gameEnd") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass rounded-3xl p-10 max-w-md w-full flex flex-col items-center gap-4"
        >
          <Trophy size={48} className="text-[var(--color-accent)]" />
          <h1 className="text-3xl font-bold">
            {state.winnerId ? `${nameOf(state.winnerId)} wins!` : "No survivors — it's a draw"}
          </h1>
          <p className="text-gray-400">
            Survived {state.roundNumber} round{state.roundNumber === 1 ? "" : "s"} of Last Man Standing
          </p>
          <button
            onClick={() => router.push(`/room/${room.code}`)}
            className="mt-2 h-12 px-6 rounded-xl bg-[var(--color-primary)] text-black font-bold hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Back to lobby
          </button>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 pt-6 pb-32 max-w-3xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/room/${room.code}`)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-semibold"
        >
          <ArrowLeft size={16} /> Lobby
        </button>
        <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
          Round {state.roundNumber} · {survivorCount} left
        </div>
        {state.phase === "answering" && (
          <div className="flex items-center gap-2 font-mono font-bold text-lg">
            <Clock
              size={18}
              className={secondsLeft !== null && secondsLeft <= 5 ? "text-red-400" : "text-[var(--color-primary)]"}
            />
            <span className={secondsLeft !== null && secondsLeft <= 5 ? "text-red-400" : ""}>
              {secondsLeft ?? "—"}s
            </span>
          </div>
        )}
      </div>

      {/* Prompt */}
      <div className="glass rounded-3xl p-6 flex flex-col items-center gap-2 text-center">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">The prompt</p>
        <p className="text-xl font-bold">{state.prompt?.text ?? "—"}</p>
        {state.phase === "answering" && (
          <p className="text-sm text-gray-400">
            {state.answeredPlayerIds.length} / {survivorCount} answered
          </p>
        )}
      </div>

      {/* Round results */}
      <AnimatePresence>
        {state.phase === "roundEnd" && state.lastResults && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass rounded-2xl p-4 flex flex-col gap-2"
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold px-1">
              Round {state.roundNumber} results — next round starting…
            </p>
            {state.lastResults.map((r) => (
              <div
                key={r.playerId}
                className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${
                  r.survived ? "bg-[var(--color-primary)]/10" : "bg-red-500/10"
                }`}
              >
                <span className="font-semibold flex items-center gap-2">
                  {!r.survived && <Skull size={14} className="text-red-400" />}
                  {nameOf(r.playerId)}
                  {r.playerId === selfId ? " (you)" : ""}
                </span>
                <span className="text-sm text-gray-400 text-right">
                  {r.answer ? `"${r.answer}"` : "no answer"}
                  {!r.survived ? ` — ${lastManStandingReasonLabel(r.reason)}` : ""}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Players / eliminated */}
      <div className="flex flex-wrap gap-2">
        {state.order.map((id) => {
          const eliminated = state.eliminated.includes(id);
          const answered = state.answeredPlayerIds.includes(id);
          return (
            <span
              key={id}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${
                eliminated
                  ? "bg-red-500/10 text-red-400 line-through"
                  : answered
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "bg-white/5 text-gray-300"
              }`}
            >
              {eliminated && <Skull size={12} />}
              {nameOf(id)}
              {id === selfId ? " (you)" : ""}
            </span>
          );
        })}
      </div>

      {amEliminated && (
        <p className="text-sm text-gray-400 bg-white/5 rounded-xl px-4 py-2.5">
          You&apos;re out — watching the rest of the round play out.
        </p>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="fixed bottom-0 left-0 right-0 p-4 glass border-t border-white/10 flex justify-center"
      >
        <div className="w-full max-w-3xl flex gap-2">
          <input
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            disabled={state.phase !== "answering" || amEliminated || alreadyAnswered}
            placeholder={
              amEliminated
                ? "You're eliminated"
                : alreadyAnswered
                ? "Answer locked in — waiting on others…"
                : state.phase === "answering"
                ? "Type your answer…"
                : "Waiting for next round…"
            }
            className="flex-1 h-14 px-4 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none disabled:opacity-40 transition-colors"
          />
          <button
            type="submit"
            disabled={state.phase !== "answering" || amEliminated || alreadyAnswered || !guess.trim()}
            className="w-14 h-14 rounded-xl bg-[var(--color-primary)] text-black flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-[var(--color-primary-dark)] transition-colors"
            aria-label="Submit"
          >
            <Send size={20} />
          </button>
        </div>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Guess The Player — fully playable, 1v1 only (see server/guessThePlayerEngine.ts)
// ---------------------------------------------------------------------------

function GuessThePlayerGame() {
  const router = useRouter();
  const { room, selfId, sendChat } = useRoomStore();
  const { state, mySecret, lastGuesses, attach, sync, pick, guess } = useGuessThePlayerStore();
  const [chatText, setChatText] = useState("");
  const [guessText, setGuessText] = useState("");

  useEffect(() => {
    attach();
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function nameOf(id: string | null) {
    return room?.players.find((p) => p.socketId === id)?.displayName ?? "—";
  }

  function handleChatSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    sendChat(text);
    setChatText("");
  }

  function handleGuessSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = guessText.trim();
    if (!text) return;
    guess(text);
    setGuessText("");
  }

  if (!room) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-xl font-bold">No active room</p>
        <button
          onClick={() => router.push("/")}
          className="text-[var(--color-primary)] font-semibold hover:underline"
        >
          Back home
        </button>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-gray-400">Loading Guess The Player…</p>
      </main>
    );
  }

  const opponentId = state.order.find((id) => id !== selfId) ?? null;
  const iHavePicked = selfId ? state.pickedPlayerIds.includes(selfId) : false;
  const opponentHasPicked = opponentId ? state.pickedPlayerIds.includes(opponentId) : false;

  if (state.phase === "gameEnd") {
    const iWon = state.winnerId === selfId;
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass rounded-3xl p-10 max-w-md w-full flex flex-col items-center gap-4"
        >
          <Trophy size={48} className="text-[var(--color-accent)]" />
          <h1 className="text-3xl font-bold">
            {state.winnerId ? `${nameOf(state.winnerId)} wins!` : "No winner"}
          </h1>
          <p className="text-gray-400">
            {state.forfeited
              ? `${iWon ? "Your opponent" : nameOf(state.winnerId)} left the match — won by forfeit.`
              : "Guessed the opponent's secret pick correctly."}
          </p>
          {state.secrets && (
            <div className="flex items-center gap-6 mt-2">
              {state.order.map((id) => (
                <div key={id} className="flex flex-col items-center gap-2">
                  <PlayerAvatar name={state.secrets![id]} size={64} ring={id === state.winnerId} />
                  <span className="text-xs text-gray-400 max-w-[7rem] truncate">{nameOf(id)}&apos;s pick</span>
                  <span className="text-sm font-semibold">{state.secrets![id]}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => router.push(`/room/${room.code}`)}
            className="mt-2 h-12 px-6 rounded-xl bg-[var(--color-primary)] text-black font-bold hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Back to lobby
          </button>
        </motion.div>
      </main>
    );
  }

  if (state.phase === "picking") {
    return (
      <main className="min-h-screen px-4 pt-6 pb-16 max-w-lg mx-auto w-full flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push(`/room/${room.code}`)}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-semibold"
          >
            <ArrowLeft size={16} /> Lobby
          </button>
        </div>

        <div className="glass rounded-3xl p-6 flex flex-col items-center gap-3 text-center">
          <HelpCircle size={28} className="text-[var(--color-primary)]" />
          <h1 className="text-xl font-bold">Secretly pick your player</h1>
          <p className="text-sm text-gray-400">
            Your opponent will try to guess who it is by asking yes/no questions in chat.
            Only you can see who you picked.
          </p>
        </div>

        {iHavePicked ? (
          <div className="glass rounded-3xl p-6 flex flex-col items-center gap-3 text-center">
            {mySecret && <PlayerAvatar name={mySecret} size={72} ring />}
            <p className="font-bold">{mySecret}</p>
            <p className="text-sm text-gray-400">
              {opponentHasPicked ? "Starting…" : `Waiting for ${nameOf(opponentId)} to pick…`}
            </p>
          </div>
        ) : (
          <PlayerSearchPicker onPick={(name) => pick(name)} placeholder="Search for a player to hide…" />
        )}
      </main>
    );
  }

  // phase === "playing"
  return (
    <main className="min-h-screen px-4 pt-6 pb-32 max-w-2xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/room/${room.code}`)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-semibold"
        >
          <ArrowLeft size={16} /> Lobby
        </button>
        <span className="text-sm font-bold text-gray-300">vs {nameOf(opponentId)}</span>
      </div>

      <div className="glass rounded-2xl p-4 flex items-center gap-4">
        <span className="text-xs text-gray-400 uppercase tracking-wide font-semibold shrink-0">Your pick</span>
        {mySecret && <PlayerAvatar name={mySecret} size={44} />}
        <span className="font-semibold text-sm truncate">{mySecret}</span>
      </div>

      {/* Yes/no questions — the existing room chat, per spec */}
      <div className="glass rounded-2xl p-4 flex flex-col gap-2 flex-1 min-h-[16rem]">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Ask yes/no questions</p>
        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 max-h-64">
          {room.chat.map((m) => (
            <div key={m.id} className="text-sm">
              <span className="font-semibold text-[var(--color-primary)]">{m.from}:</span>{" "}
              <span className="text-gray-300">{m.text}</span>
            </div>
          ))}
        </div>
        <form onSubmit={handleChatSubmit} className="flex gap-2 pt-2">
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Does he play in the Premier League?"
            className="flex-1 h-11 px-3 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none text-sm"
          />
          <button
            type="submit"
            disabled={!chatText.trim()}
            className="w-11 h-11 rounded-xl bg-white/10 text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-white/20 transition-colors"
            aria-label="Send"
          >
            <Send size={18} />
          </button>
        </form>
      </div>

      {/* Guess log — separate from chat, since a guess is a deliberate action, not a question */}
      {lastGuesses.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {lastGuesses
            .slice(-5)
            .reverse()
            .map((g, i) => (
              <div key={i} className="text-xs text-gray-400 px-1">
                <span className="font-semibold text-gray-300">{g.displayName}</span> guessed “{g.guess}”
              </div>
            ))}
        </div>
      )}

      <form onSubmit={handleGuessSubmit} className="flex gap-2">
        <input
          value={guessText}
          onChange={(e) => setGuessText(e.target.value)}
          placeholder="Make your guess: who is it?"
          className="flex-1 h-14 px-4 rounded-xl bg-white/5 border-2 border-[var(--color-accent)]/40 focus:border-[var(--color-accent)] outline-none font-semibold"
        />
        <button
          type="submit"
          disabled={!guessText.trim()}
          className="h-14 px-5 rounded-xl bg-[var(--color-accent)] text-black font-bold flex items-center justify-center shrink-0 disabled:opacity-40 hover:brightness-95 transition-all"
        >
          Guess
        </button>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Football Pyramid — fully playable
//
// Unlike Who Am I?, any number of players can solve a round: guessing
// correctly scores you points and locks *your own* input for the rest of
// the round, but everyone else keeps guessing until every clue has been
// shown (+ grace) or everyone has solved it.
// ---------------------------------------------------------------------------

function FootballPyramidGame() {
  const router = useRouter();
  const { room, selfId } = useRoomStore();
  const { state, lastSolved, attach, sync, submit } = useFootballPyramidStore();
  const [guess, setGuess] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    attach();
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Clear the guess box whenever a new round starts (derived during render,
  // not an effect, to avoid a synchronous setState-in-effect cascade).
  const [guessRound, setGuessRound] = useState<number | null>(null);
  if (state && state.round !== guessRound) {
    setGuessRound(state.round);
    if (guess) setGuess("");
  }

  function nameOf(id: string | null) {
    return room?.players.find((p) => p.socketId === id)?.displayName ?? "—";
  }

  const alreadySolved = Boolean(state && selfId && state.solvedIds.includes(selfId));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text || state?.phase !== "clue" || alreadySolved) return;
    submit(text);
    setGuess("");
  }

  if (!room) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-xl font-bold">No active room</p>
        <button
          onClick={() => router.push("/")}
          className="text-[var(--color-primary)] font-semibold hover:underline"
        >
          Back home
        </button>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-gray-400">Loading Football Pyramid…</p>
      </main>
    );
  }

  const sortedScores = Object.entries(state.scores).sort(([, a], [, b]) => b - a);
  const secondsToNextClue = state.nextClueAt
    ? Math.max(0, Math.ceil((state.nextClueAt - now) / 1000))
    : null;

  if (state.phase === "gameEnd") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass rounded-3xl p-10 max-w-md w-full flex flex-col items-center gap-4"
        >
          <Trophy size={48} className="text-[var(--color-accent)]" />
          <h1 className="text-3xl font-bold">{nameOf(state.winnerId)} wins!</h1>
          <p className="text-gray-400">After {state.totalRounds} rounds of Football Pyramid</p>
          <div className="w-full flex flex-col gap-2 mt-2">
            {sortedScores.map(([id, score], i) => (
              <div
                key={id}
                className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${
                  i === 0 ? "bg-[var(--color-primary)]/15" : "bg-white/5"
                }`}
              >
                <span className="font-semibold">
                  {i + 1}. {nameOf(id)}
                  {id === selfId ? " (you)" : ""}
                </span>
                <span className="font-bold font-mono">{score} pts</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => router.push(`/room/${room.code}`)}
            className="mt-2 h-12 px-6 rounded-xl bg-[var(--color-primary)] text-black font-bold hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Back to lobby
          </button>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 pt-6 pb-32 max-w-3xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/room/${room.code}`)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm font-semibold"
        >
          <ArrowLeft size={16} /> Lobby
        </button>
        <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
          Round {state.round} / {state.totalRounds}
        </div>
        {state.phase === "clue" && (
          <div className="flex items-center gap-2 font-mono font-bold text-lg">
            <Clock
              size={18}
              className={
                secondsToNextClue !== null && secondsToNextClue <= 1
                  ? "text-red-400"
                  : "text-[var(--color-primary)]"
              }
            />
            <span>{secondsToNextClue ?? "—"}s</span>
          </div>
        )}
      </div>

      {/* Latest solve toast */}
      <AnimatePresence>
        {state.phase === "clue" && lastSolved && (
          <motion.div
            key={`${lastSolved.playerId}-${lastSolved.points}-${state.cluesRevealed}`}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-3 rounded-2xl px-5 py-3 bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/40"
          >
            <Sparkles className="text-[var(--color-primary)]" size={20} />
            <p className="font-bold">
              {lastSolved.displayName} got it! +{lastSolved.points} pts
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Round-end banner */}
      <AnimatePresence>
        {state.phase === "roundEnd" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`flex items-center gap-3 rounded-2xl px-5 py-4 ${
              state.solvedIds.length > 0
                ? "bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/40"
                : "bg-white/5 border border-white/10"
            }`}
          >
            {state.solvedIds.length > 0 ? (
              <Sparkles className="text-[var(--color-primary)]" size={22} />
            ) : (
              <HelpCircle className="text-gray-400" size={22} />
            )}
            <div>
              <p className="font-bold">
                {state.solvedIds.length > 0
                  ? `${state.solvedIds.length} player${state.solvedIds.length === 1 ? "" : "s"} got it this round!`
                  : "Nobody guessed it in time."}
              </p>
              <p className="text-sm text-gray-400">
                It was <span className="font-semibold text-white">{state.targetName}</span> — next round starting…
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clue pyramid */}
      <div className="glass rounded-3xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
            Clue {state.cluesRevealed} of {state.totalClues}
          </p>
          <div className="flex gap-1">
            {Array.from({ length: state.totalClues }).map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full ${
                  i < state.cluesRevealed ? "bg-[var(--color-primary)]" : "bg-white/10"
                }`}
              />
            ))}
          </div>
        </div>
        <AnimatePresence initial={false}>
          {state.clues.map((clue, i) => (
            <motion.div
              key={`${clue.label}-${i}`}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3"
            >
              <span className="text-sm text-gray-400 font-semibold">{clue.label}</span>
              <span className="font-bold">{clue.value}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Live scoreboard, with a checkmark for who's already solved this round */}
      <div className="flex flex-wrap gap-2">
        {sortedScores.map(([id, score]) => (
          <span
            key={id}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${
              state.solvedIds.includes(id)
                ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                : "bg-white/5 text-gray-300"
            }`}
          >
            {state.solvedIds.includes(id) && <Sparkles size={12} />}
            {nameOf(id)}
            {id === selfId ? " (you)" : ""}: {score}
          </span>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="fixed bottom-0 left-0 right-0 p-4 glass border-t border-white/10 flex justify-center"
      >
        <div className="w-full max-w-3xl flex gap-2">
          <input
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            disabled={state.phase !== "clue" || alreadySolved}
            placeholder={
              alreadySolved
                ? "You already scored this round — waiting on others…"
                : state.phase === "clue"
                ? "Who is it?…"
                : "Waiting for next round…"
            }
            className="flex-1 h-14 px-4 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none disabled:opacity-40 transition-colors"
          />
          <button
            type="submit"
            disabled={state.phase !== "clue" || alreadySolved || !guess.trim()}
            className="w-14 h-14 rounded-xl bg-[var(--color-primary)] text-black flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-[var(--color-primary-dark)] transition-colors"
            aria-label="Submit"
          >
            <Send size={20} />
          </button>
        </div>
      </form>
    </main>
  );
}

