/**
 * Socket.io room server — PROJECT_SPEC.md §4 "Room System" + §5 "The Chain".
 *
 * Everything here is in-memory only. Nothing about a live room (players,
 * ready state, chat, current game, scores mid-round) ever touches Postgres —
 * per the spec's rule of thumb: "if it's true right now, in this room, it
 * lives in Socket.io memory." Progression (XP/coins/achievements) is written
 * to Postgres by the Next.js API layer *after* a match ends, not from here.
 *
 * PROJECT_SPEC.md §1 is explicit that this must run as a free-hosted
 * service (Render or Fly.io), not a machine someone has to keep on. See
 * render.yaml + DEPLOYMENT.md at the repo root for the actual deploy steps.
 * `PORT` (what Render/Fly inject) takes priority over the local-dev-only
 * `SOCKET_PORT`; `CLIENT_ORIGIN` accepts a comma-separated list so both the
 * local dev URL and the deployed Vercel URL can be allowed at once.
 *
 * Run standalone: `npm run socket` (tsx watch server/index.ts)
 * Run alongside Next: `npm run dev:all`
 * Run in production (what Render's startCommand invokes): `npm run start:socket`
 */

import { createServer } from "http";
import { Server, type Socket } from "socket.io";
import {
  resolvePlayer,
  wereTeammates,
  randomModifier,
  randomStartingPlayer,
  normalizeName,
  type ChainPlayer,
  type FireModeModifier,
} from "./chainEngine";
import {
  buildClues,
  randomWhoAmITarget,
  isCorrectWhoAmIGuess,
  WHO_AM_I_CLUE_COUNT,
  type WhoAmIPlayer,
} from "./whoAmIEngine";
import {
  buildTimeline,
  randomCareerMazeTarget,
  isCorrectCareerMazeGuess,
  type CareerMazePlayer,
  type TimelineStop,
} from "./careerMazeEngine";
import {
  randomPrompt,
  verifyAnswer,
  type LastManStandingPrompt,
  type LastManStandingPlayer,
} from "./lastManStandingEngine";
import { namesMatch, isValidPick } from "./guessThePlayerEngine";
import {
  buildClues as buildPyramidClues,
  randomFootballPyramidTarget,
  isCorrectFootballPyramidGuess,
  FOOTBALL_PYRAMID_CLUE_COUNT,
  type FootballPyramidPlayer,
  type FootballPyramidClue,
} from "./footballPyramidEngine";
import {
  randomShirtNumber,
  verifyShirtAnswer,
  type ShirtMadnessPlayer,
} from "./shirtMadnessEngine";

// Render/Fly inject PORT at runtime — that must win over the local-dev default.
const PORT = Number(process.env.PORT ?? process.env.SOCKET_PORT ?? 4001);
// Comma-separated so local dev (http://localhost:3000) and the deployed
// Vercel URL can both be allowed simultaneously without a code change.
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CHAIN_TURN_SECONDS = 10;
const WHO_AM_I_ROUNDS = 5;
const WHO_AM_I_CLUE_INTERVAL_MS = 4000; // time between each clue reveal
const WHO_AM_I_ROUND_END_DELAY_MS = 4000; // pause after a round resolves before the next round starts
const WHO_AM_I_POST_LAST_CLUE_MS = 6000; // grace period after the final clue before the round is marked unsolved
const CAREER_MAZE_ROUNDS = 5;
const CAREER_MAZE_ROUND_SECONDS = 20; // time to guess after the full timeline is revealed
const CAREER_MAZE_ROUND_END_DELAY_MS = 4000; // pause after a round resolves before the next round starts
const LAST_MAN_STANDING_ANSWER_SECONDS = 20; // time everyone has to submit one answer per round
const LAST_MAN_STANDING_ROUND_END_DELAY_MS = 5000; // pause showing eliminations before the next round/prompt
const FOOTBALL_PYRAMID_ROUNDS = 5;
const FOOTBALL_PYRAMID_CLUE_INTERVAL_MS = 4000; // time between each clue reveal
const FOOTBALL_PYRAMID_ROUND_END_DELAY_MS = 4000; // pause after a round resolves before the next round starts
const FOOTBALL_PYRAMID_POST_LAST_CLUE_MS = 6000; // grace period after the final clue before the round closes
const SHIRT_MADNESS_ROUNDS = 5;
const SHIRT_MADNESS_ANSWER_SECONDS = 15; // time everyone has to submit one player per round
const SHIRT_MADNESS_ROUND_END_DELAY_MS = 5000; // pause showing round results before the next number/game end

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoomMode = "1v1" | "2v2" | "ffa";
type GameId =
  | "guess-the-player"
  | "who-am-i"
  | "career-maze"
  | "football-pyramid"
  | "last-man-standing"
  | "the-chain"
  | "shirt-madness";

interface RoomPlayer {
  socketId: string;
  displayName: string;
  ready: boolean;
  isHost: boolean;
  team?: 1 | 2; // used for 2v2
  connected: boolean;
}

interface ChatMessage {
  id: string;
  from: string;
  text: string;
  emoji?: string;
  ts: number;
}

interface ChainEntry {
  name: string;
  nationality: string;
  position: string;
  by: string; // display name of whoever named this player ("Starting player" for the seed)
}

interface ChainGameState {
  order: string[]; // socketIds, fixed turn order for this match
  eliminated: Set<string>;
  currentIndex: number;
  chain: ChainEntry[]; // public, sent to clients
  chainPlayers: ChainPlayer[]; // parallel full data, server-only (teammate checks)
  usedNames: Set<string>;
  modifier: FireModeModifier | null;
  successfulTurns: number;
  turnEndsAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  winnerId: string | null;
}

interface WhoAmIGameState {
  round: number;
  totalRounds: number;
  target: WhoAmIPlayer;
  clues: ReturnType<typeof buildClues>;
  cluesRevealed: number;
  usedNames: Set<string>;
  scores: Map<string, number>;
  solvedBy: string | null; // socketId of whoever solved this round, null if unsolved/still open
  phase: "clue" | "roundEnd" | "gameEnd";
  timer: ReturnType<typeof setTimeout> | null;
  nextClueAt: number | null;
  winnerId: string | null; // only set once phase === "gameEnd"
}

interface CareerMazeGameState {
  round: number;
  totalRounds: number;
  target: CareerMazePlayer;
  timeline: TimelineStop[];
  usedNames: Set<string>;
  scores: Map<string, number>;
  solvedBy: string | null;
  revealedAt: number; // Date.now() when this round's timeline was shown, for elapsed-time scoring
  roundEndsAt: number | null;
  phase: "guess" | "roundEnd" | "gameEnd";
  timer: ReturnType<typeof setTimeout> | null;
  winnerId: string | null;
}

interface LastManStandingAnswerResult {
  playerId: string;
  answer: string | null;
  survived: boolean;
  reason: "no-answer" | "not-found" | "doesnt-match" | "duplicate" | null;
  resolvedName: string | null;
}

interface LastManStandingGameState {
  order: string[]; // socketIds, fixed order for stable display
  eliminated: Set<string>;
  usedPromptIds: Set<string>;
  prompt: LastManStandingPrompt | null;
  answers: Map<string, string>; // socketId -> raw submitted text, this round only
  roundNumber: number;
  roundEndsAt: number | null;
  lastResults: LastManStandingAnswerResult[] | null; // set once a round resolves
  phase: "answering" | "roundEnd" | "gameEnd";
  timer: ReturnType<typeof setTimeout> | null;
  winnerId: string | null; // null both before the game ends and in a no-survivors draw
}

interface GuessThePlayerGameState {
  order: string[]; // exactly 2 socketIds — 1v1 only this session, see guessThePlayerEngine.ts header
  secrets: Map<string, string>; // socketId -> the OPPONENT-facing secret they picked for themselves
  phase: "picking" | "playing" | "gameEnd";
  winnerId: string | null;
  forfeited: boolean; // true if the game ended by an opponent disconnecting rather than a correct guess
}

interface FootballPyramidGameState {
  round: number;
  totalRounds: number;
  target: FootballPyramidPlayer;
  clues: FootballPyramidClue[];
  cluesRevealed: number;
  usedNames: Set<string>;
  scores: Map<string, number>;
  solvedIds: Set<string>; // socketIds who already scored this round — locked out from guessing again
  phase: "clue" | "roundEnd" | "gameEnd";
  timer: ReturnType<typeof setTimeout> | null;
  nextClueAt: number | null;
  winnerId: string | null; // only set once phase === "gameEnd"
}

interface ShirtMadnessAnswerResult {
  playerId: string;
  answer: string | null;
  points: number;
  reason: "no-answer" | "not-found" | "wrong-number" | "duplicate" | null;
  resolvedName: string | null;
}

interface ShirtMadnessGameState {
  round: number;
  totalRounds: number;
  number: number;
  usedNumbers: Set<number>;
  answers: Map<string, string>; // socketId -> raw submitted text, this round only
  scores: Map<string, number>;
  roundEndsAt: number | null;
  lastResults: ShirtMadnessAnswerResult[] | null;
  phase: "answering" | "roundEnd" | "gameEnd";
  timer: ReturnType<typeof setTimeout> | null;
  winnerId: string | null;
}

interface Room {
  code: string;
  mode: RoomMode;
  gameId: GameId | null;
  hostId: string;
  players: Map<string, RoomPlayer>;
  chat: ChatMessage[];
  started: boolean;
  createdAt: number;
  chain?: ChainGameState;
  whoAmI?: WhoAmIGameState;
  careerMaze?: CareerMazeGameState;
  lastManStanding?: LastManStandingGameState;
  guessThePlayer?: GuessThePlayerGameState;
  footballPyramid?: FootballPyramidGameState;
  shirtMadness?: ShirtMadnessGameState;
}

const MAX_PLAYERS = 50;
const MAX_CHAT_HISTORY = 100;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

const rooms = new Map<string, Room>();
// socket.id -> room code, so disconnects can find the right room in O(1)
const socketRoom = new Map<string, string>();

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------

function generateRoomCode(): string {
  let code: string;
  do {
    code = Array.from(
      { length: 6 },
      () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function publicRoomState(room: Room) {
  return {
    code: room.code,
    mode: room.mode,
    gameId: room.gameId,
    hostId: room.hostId,
    started: room.started,
    players: Array.from(room.players.values()),
    chat: room.chat,
  };
}

function broadcastRoomState(io: Server, room: Room) {
  io.to(room.code).emit("room:state", publicRoomState(room));
}

function capacityForMode(mode: RoomMode): number {
  if (mode === "1v1") return 2;
  if (mode === "2v2") return 4;
  return MAX_PLAYERS;
}

// ---------------------------------------------------------------------------
// The Chain — game logic (PROJECT_SPEC.md §5 "The Chain")
// ---------------------------------------------------------------------------

function initChainGame(room: Room) {
  const order = Array.from(room.players.keys());
  const start = randomStartingPlayer();

  const state: ChainGameState = {
    order,
    eliminated: new Set(),
    currentIndex: 0,
    chain: [
      { name: start.name, nationality: start.nationality, position: start.position, by: "Starting player" },
    ],
    chainPlayers: [start],
    usedNames: new Set([normalizeName(start.name)]),
    modifier: null,
    successfulTurns: 0,
    turnEndsAt: 0,
    timer: null,
    winnerId: null,
  };

  room.chain = state;
  armChainTimer(room);
}

function publicChainState(room: Room) {
  const c = room.chain;
  if (!c) return null;
  return {
    chain: c.chain,
    currentPlayerId: c.winnerId ? null : c.order[c.currentIndex],
    order: c.order,
    eliminated: Array.from(c.eliminated),
    modifier: c.modifier ? { id: c.modifier.id, description: c.modifier.description } : null,
    turnEndsAt: c.winnerId ? null : c.turnEndsAt,
    winnerId: c.winnerId,
  };
}

function broadcastChainState(io: Server, room: Room) {
  io.to(room.code).emit("chain:state", publicChainState(room));
}

function chainSurvivors(c: ChainGameState): number {
  return c.order.length - c.eliminated.size;
}

function armChainTimer(room: Room) {
  const c = room.chain;
  if (!c || c.winnerId) return;
  if (c.timer) clearTimeout(c.timer);
  c.turnEndsAt = Date.now() + CHAIN_TURN_SECONDS * 1000;
  c.timer = setTimeout(() => handleChainTimeout(io, room), CHAIN_TURN_SECONDS * 1000);
}

function advanceChainTurn(io: Server, room: Room) {
  const c = room.chain;
  if (!c) return;
  if (chainSurvivors(c) <= 1) {
    endChainGame(io, room);
    return;
  }
  let next = c.currentIndex;
  do {
    next = (next + 1) % c.order.length;
  } while (c.eliminated.has(c.order[next]));
  c.currentIndex = next;
  armChainTimer(room);
}

function eliminateChainPlayer(io: Server, room: Room, socketId: string) {
  const c = room.chain;
  if (!c || c.winnerId || c.eliminated.has(socketId)) return;

  c.eliminated.add(socketId);

  if (chainSurvivors(c) <= 1) {
    endChainGame(io, room);
    return;
  }
  if (c.order[c.currentIndex] === socketId) {
    advanceChainTurn(io, room);
  }
  broadcastChainState(io, room);
}

function endChainGame(io: Server, room: Room) {
  const c = room.chain;
  if (!c) return;
  if (c.timer) clearTimeout(c.timer);
  c.timer = null;
  const survivors = c.order.filter((id) => !c.eliminated.has(id));
  c.winnerId = survivors[0] ?? null;
  broadcastChainState(io, room);
}

function handleChainTimeout(io: Server, room: Room) {
  const c = room.chain;
  if (!c || c.winnerId) return;
  const current = c.order[c.currentIndex];
  if (c.eliminated.has(current)) return;
  io.to(room.code).emit("chain:wrongAnswer", { playerId: current, guess: "", reason: "timeout" });
  eliminateChainPlayer(io, room, current);
}

// ---------------------------------------------------------------------------
// Who Am I? — game logic (PROJECT_SPEC.md §5 "Who Am I?")
//
// Clues reveal on a fixed schedule (WHO_AM_I_CLUE_INTERVAL_MS apart). Anyone
// can guess at any time via `whoami:submit`; the first correct guess wins
// the round and scores points inversely proportional to how many clues had
// already been shown (guess early, score more). If nobody solves it before
// the last clue plus a grace period, the round ends unsolved (0 points) and
// the target is revealed. After WHO_AM_I_ROUNDS rounds the game ends and the
// highest total score wins.
// ---------------------------------------------------------------------------

function initWhoAmIGame(room: Room) {
  const scores = new Map<string, number>();
  for (const id of room.players.keys()) scores.set(id, 0);

  room.whoAmI = {
    round: 0,
    totalRounds: WHO_AM_I_ROUNDS,
    target: null as unknown as WhoAmIPlayer, // set by startWhoAmIRound below
    clues: [],
    cluesRevealed: 0,
    usedNames: new Set(),
    scores,
    solvedBy: null,
    phase: "clue",
    timer: null,
    nextClueAt: null,
    winnerId: null,
  };
  startWhoAmIRound(io, room);
}

function startWhoAmIRound(io: Server, room: Room) {
  const w = room.whoAmI;
  if (!w) return;

  const target = randomWhoAmITarget(w.usedNames);
  if (!target) {
    // Dataset exhausted (shouldn't happen at WHO_AM_I_ROUNDS=5 with ~40+ players) — end early rather than crash.
    endWhoAmIGame(io, room);
    return;
  }
  w.usedNames.add(target.name);
  w.round += 1;
  w.target = target;
  w.clues = buildClues(target);
  w.cluesRevealed = 1; // first clue is visible immediately when the round starts
  w.solvedBy = null;
  w.phase = "clue";
  armWhoAmIClueTimer(io, room);
  broadcastWhoAmIState(io, room);
}

function armWhoAmIClueTimer(io: Server, room: Room) {
  const w = room.whoAmI;
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);

  if (w.cluesRevealed < WHO_AM_I_CLUE_COUNT) {
    w.nextClueAt = Date.now() + WHO_AM_I_CLUE_INTERVAL_MS;
    w.timer = setTimeout(() => revealNextWhoAmIClue(io, room), WHO_AM_I_CLUE_INTERVAL_MS);
  } else {
    // All clues shown — give a final grace window before ending the round unsolved.
    w.nextClueAt = null;
    w.timer = setTimeout(() => endWhoAmIRoundUnsolved(io, room), WHO_AM_I_POST_LAST_CLUE_MS);
  }
}

function revealNextWhoAmIClue(io: Server, room: Room) {
  const w = room.whoAmI;
  if (!w || w.phase !== "clue") return;
  w.cluesRevealed = Math.min(w.cluesRevealed + 1, WHO_AM_I_CLUE_COUNT);
  armWhoAmIClueTimer(io, room);
  broadcastWhoAmIState(io, room);
}

function whoAmIPoints(cluesRevealed: number): number {
  // 1 clue revealed (guessed instantly) = 100pts, down to a 20pt floor once every clue is out.
  return Math.max(100 - (cluesRevealed - 1) * 12, 20);
}

function endWhoAmIRoundUnsolved(io: Server, room: Room) {
  const w = room.whoAmI;
  if (!w || w.phase !== "clue") return;
  w.phase = "roundEnd";
  w.solvedBy = null;
  broadcastWhoAmIState(io, room);
  scheduleNextWhoAmIRoundOrEnd(io, room);
}

function scheduleNextWhoAmIRoundOrEnd(io: Server, room: Room) {
  const w = room.whoAmI;
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);

  if (w.round >= w.totalRounds) {
    w.timer = setTimeout(() => endWhoAmIGame(io, room), WHO_AM_I_ROUND_END_DELAY_MS);
  } else {
    w.timer = setTimeout(() => startWhoAmIRound(io, room), WHO_AM_I_ROUND_END_DELAY_MS);
  }
}

function endWhoAmIGame(io: Server, room: Room) {
  const w = room.whoAmI;
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  w.timer = null;
  w.phase = "gameEnd";

  let bestId: string | null = null;
  let bestScore = -1;
  for (const [id, score] of w.scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  w.winnerId = bestId;
  broadcastWhoAmIState(io, room);
}

function publicWhoAmIState(room: Room) {
  const w = room.whoAmI;
  if (!w) return null;
  const revealTarget = w.phase !== "clue"; // reveal the answer once the round is over (solved or not)
  return {
    round: w.round,
    totalRounds: w.totalRounds,
    clues: w.clues.slice(0, w.cluesRevealed),
    cluesRevealed: w.cluesRevealed,
    totalClues: WHO_AM_I_CLUE_COUNT,
    phase: w.phase,
    solvedBy: w.solvedBy,
    targetName: revealTarget ? w.target.name : null,
    scores: Object.fromEntries(w.scores),
    nextClueAt: w.nextClueAt,
    winnerId: w.winnerId,
  };
}

function broadcastWhoAmIState(io: Server, room: Room) {
  io.to(room.code).emit("whoami:state", publicWhoAmIState(room));
}

// ---------------------------------------------------------------------------
// Career Maze — game logic (PROJECT_SPEC.md §5 "Career Maze")
//
// The full club-history timeline is revealed immediately (unlike Who Am I?'s
// gradual clues) and a single round timer starts ticking. Anyone can guess
// at any time via `careermaze:submit`; the first correct guess wins the
// round, scored by how fast they answered (faster = more points). If the
// round timer runs out unsolved, the target is revealed and the game moves
// on. After CAREER_MAZE_ROUNDS rounds the highest total score wins.
// ---------------------------------------------------------------------------

function initCareerMazeGame(room: Room) {
  const scores = new Map<string, number>();
  for (const id of room.players.keys()) scores.set(id, 0);

  room.careerMaze = {
    round: 0,
    totalRounds: CAREER_MAZE_ROUNDS,
    target: null as unknown as CareerMazePlayer, // set by startCareerMazeRound below
    timeline: [],
    usedNames: new Set(),
    scores,
    solvedBy: null,
    revealedAt: 0,
    roundEndsAt: null,
    phase: "guess",
    timer: null,
    winnerId: null,
  };
  startCareerMazeRound(io, room);
}

function startCareerMazeRound(io: Server, room: Room) {
  const cm = room.careerMaze;
  if (!cm) return;

  const target = randomCareerMazeTarget(cm.usedNames);
  if (!target) {
    // Dataset exhausted (shouldn't happen at CAREER_MAZE_ROUNDS=5 with ~40+ players) — end early rather than crash.
    endCareerMazeGame(io, room);
    return;
  }
  cm.usedNames.add(target.name);
  cm.round += 1;
  cm.target = target;
  cm.timeline = buildTimeline(target);
  cm.solvedBy = null;
  cm.revealedAt = Date.now();
  cm.roundEndsAt = cm.revealedAt + CAREER_MAZE_ROUND_SECONDS * 1000;
  cm.phase = "guess";

  if (cm.timer) clearTimeout(cm.timer);
  cm.timer = setTimeout(() => endCareerMazeRoundUnsolved(io, room), CAREER_MAZE_ROUND_SECONDS * 1000);

  broadcastCareerMazeState(io, room);
}

function careerMazePoints(revealedAt: number): number {
  const elapsedSeconds = (Date.now() - revealedAt) / 1000;
  // Instant guess ≈ 100pts, decaying to a 20pt floor once the full 20s window is used.
  return Math.max(100 - Math.floor(elapsedSeconds * 4), 20);
}

function endCareerMazeRoundUnsolved(io: Server, room: Room) {
  const cm = room.careerMaze;
  if (!cm || cm.phase !== "guess") return;
  cm.phase = "roundEnd";
  cm.solvedBy = null;
  broadcastCareerMazeState(io, room);
  scheduleNextCareerMazeRoundOrEnd(io, room);
}

function scheduleNextCareerMazeRoundOrEnd(io: Server, room: Room) {
  const cm = room.careerMaze;
  if (!cm) return;
  if (cm.timer) clearTimeout(cm.timer);

  if (cm.round >= cm.totalRounds) {
    cm.timer = setTimeout(() => endCareerMazeGame(io, room), CAREER_MAZE_ROUND_END_DELAY_MS);
  } else {
    cm.timer = setTimeout(() => startCareerMazeRound(io, room), CAREER_MAZE_ROUND_END_DELAY_MS);
  }
}

function endCareerMazeGame(io: Server, room: Room) {
  const cm = room.careerMaze;
  if (!cm) return;
  if (cm.timer) clearTimeout(cm.timer);
  cm.timer = null;
  cm.phase = "gameEnd";

  let bestId: string | null = null;
  let bestScore = -1;
  for (const [id, score] of cm.scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  cm.winnerId = bestId;
  broadcastCareerMazeState(io, room);
}

function publicCareerMazeState(room: Room) {
  const cm = room.careerMaze;
  if (!cm) return null;
  const revealTarget = cm.phase !== "guess";
  return {
    round: cm.round,
    totalRounds: cm.totalRounds,
    timeline: cm.timeline,
    phase: cm.phase,
    solvedBy: cm.solvedBy,
    targetName: revealTarget ? cm.target.name : null,
    scores: Object.fromEntries(cm.scores),
    roundEndsAt: cm.roundEndsAt,
    winnerId: cm.winnerId,
  };
}

function broadcastCareerMazeState(io: Server, room: Room) {
  io.to(room.code).emit("careermaze:state", publicCareerMazeState(room));
}

// ---------------------------------------------------------------------------
// Last Man Standing — game logic (PROJECT_SPEC.md §5 "Last Man Standing")
//
// Round-based, not turn-based: every survivor gets LAST_MAN_STANDING_ANSWER_SECONDS
// to submit one answer to the current prompt via `lastmanstanding:submit`. A
// round resolves either the moment every survivor has answered, or when the
// timer runs out (silence counts as an invalid answer). On resolution: no
// answer / an unrecognized name / a name that doesn't satisfy the prompt all
// eliminate that player; among the remaining valid answers, any player whose
// answer names the same real player as someone else is eliminated too
// (duplicates), the rest survive. Repeats with a fresh prompt until 0 or 1
// players remain.
// ---------------------------------------------------------------------------

function initLastManStandingGame(room: Room) {
  const order = Array.from(room.players.keys());

  room.lastManStanding = {
    order,
    eliminated: new Set(),
    usedPromptIds: new Set(),
    prompt: null,
    answers: new Map(),
    roundNumber: 0,
    roundEndsAt: null,
    lastResults: null,
    phase: "answering",
    timer: null,
    winnerId: null,
  };
  startLastManStandingRound(io, room);
}

function lastManStandingSurvivors(room: Room): string[] {
  const l = room.lastManStanding;
  if (!l) return [];
  // A player only counts as "active" if they're both un-eliminated AND still
  // in the room — a mid-round disconnect must not stall the round forever.
  return l.order.filter((id) => !l.eliminated.has(id) && room.players.has(id));
}

function startLastManStandingRound(io: Server, room: Room) {
  const l = room.lastManStanding;
  if (!l) return;

  const survivors = lastManStandingSurvivors(room);
  if (survivors.length <= 1) {
    endLastManStandingGame(io, room, survivors[0] ?? null);
    return;
  }

  const prompt = randomPrompt(l.usedPromptIds);
  if (!prompt) {
    // Prompt pool somehow empty (shouldn't happen with the current dataset) — end rather than crash.
    endLastManStandingGame(io, room, survivors[0] ?? null);
    return;
  }
  l.usedPromptIds.add(prompt.id);
  l.prompt = prompt;
  l.answers = new Map();
  l.lastResults = null;
  l.roundNumber += 1;
  l.phase = "answering";

  if (l.timer) clearTimeout(l.timer);
  l.roundEndsAt = Date.now() + LAST_MAN_STANDING_ANSWER_SECONDS * 1000;
  l.timer = setTimeout(() => resolveLastManStandingRound(io, room), LAST_MAN_STANDING_ANSWER_SECONDS * 1000);

  broadcastLastManStandingState(io, room);
}

function resolveLastManStandingRound(io: Server, room: Room) {
  const l = room.lastManStanding;
  if (!l || l.phase !== "answering" || !l.prompt) return;
  if (l.timer) clearTimeout(l.timer);
  l.timer = null;

  const survivors = lastManStandingSurvivors(room);
  const verdicts = new Map<string, { player: LastManStandingPlayer; raw: string }>();
  const results: LastManStandingAnswerResult[] = [];

  for (const id of survivors) {
    const raw = l.answers.get(id) ?? null;
    const verdict = verifyAnswer(l.prompt, raw);
    if (!verdict.ok) {
      results.push({ playerId: id, answer: raw, survived: false, reason: verdict.reason, resolvedName: null });
      continue;
    }
    verdicts.set(id, { player: verdict.player, raw: raw as string });
  }

  // Group the remaining valid answers by resolved player name to find duplicates.
  const byName = new Map<string, string[]>(); // normalized resolved name -> [socketId]
  for (const [id, v] of verdicts.entries()) {
    const key = v.player.name;
    const arr = byName.get(key) ?? [];
    arr.push(id);
    byName.set(key, arr);
  }

  for (const [name, ids] of byName.entries()) {
    const isDuplicate = ids.length > 1;
    for (const id of ids) {
      results.push({
        playerId: id,
        answer: verdicts.get(id)!.raw,
        survived: !isDuplicate,
        reason: isDuplicate ? "duplicate" : null,
        resolvedName: name,
      });
      if (isDuplicate) l.eliminated.add(id);
    }
  }
  for (const r of results) {
    if (!r.survived && r.reason !== "duplicate") l.eliminated.add(r.playerId);
  }

  l.lastResults = results;
  l.phase = "roundEnd";
  l.roundEndsAt = null;
  broadcastLastManStandingState(io, room);

  const remaining = lastManStandingSurvivors(room);
  if (l.timer) clearTimeout(l.timer);
  if (remaining.length <= 1) {
    l.timer = setTimeout(
      () => endLastManStandingGame(io, room, remaining[0] ?? null),
      LAST_MAN_STANDING_ROUND_END_DELAY_MS
    );
  } else {
    l.timer = setTimeout(() => startLastManStandingRound(io, room), LAST_MAN_STANDING_ROUND_END_DELAY_MS);
  }
}

function endLastManStandingGame(io: Server, room: Room, winnerId: string | null) {
  const l = room.lastManStanding;
  if (!l) return;
  if (l.timer) clearTimeout(l.timer);
  l.timer = null;
  l.phase = "gameEnd";
  l.winnerId = winnerId;
  broadcastLastManStandingState(io, room);
}

function publicLastManStandingState(room: Room) {
  const l = room.lastManStanding;
  if (!l) return null;
  return {
    roundNumber: l.roundNumber,
    prompt: l.prompt ? { id: l.prompt.id, text: l.prompt.text } : null,
    order: l.order,
    eliminated: Array.from(l.eliminated),
    answeredPlayerIds: Array.from(l.answers.keys()),
    roundEndsAt: l.roundEndsAt,
    lastResults: l.lastResults,
    phase: l.phase,
    winnerId: l.winnerId,
  };
}

function broadcastLastManStandingState(io: Server, room: Room) {
  io.to(room.code).emit("lastmanstanding:state", publicLastManStandingState(room));
}

// ---------------------------------------------------------------------------
// Guess The Player — game logic (PROJECT_SPEC.md §5 "Guess The Player")
//
// 1v1 only this session (see guessThePlayerEngine.ts header for why). Both
// players secretly pick a player during the "picking" phase via
// `guessplayer:pick`; once both have picked, the phase flips to "playing"
// and either player can submit a guess at any time via `guessplayer:guess`
// — there's no turn order, this is a free-for-all 20-questions duel, with
// the actual yes/no questions happening over the existing room chat
// (`chat:message`), not a game-specific event. A guess that matches the
// OPPONENT'S secret (case/accent-insensitive) wins immediately and reveals
// both secrets to the room. Each player's own pick is only ever emitted
// privately to their own socket (`guessplayer:yourSecret`) — never in the
// room-wide broadcast — so "shown as a real <PlayerAvatar/> only to its
// owner" actually holds server-side, not just in the UI.
// ---------------------------------------------------------------------------

function initGuessThePlayerGame(room: Room) {
  const order = Array.from(room.players.keys());
  room.guessThePlayer = {
    order,
    secrets: new Map(),
    phase: "picking",
    winnerId: null,
    forfeited: false,
  };
}

function publicGuessThePlayerState(room: Room) {
  const g = room.guessThePlayer;
  if (!g) return null;
  return {
    order: g.order,
    pickedPlayerIds: Array.from(g.secrets.keys()),
    phase: g.phase,
    winnerId: g.winnerId,
    forfeited: g.forfeited,
    // Only revealed once the game is over — never mid-match.
    secrets: g.phase === "gameEnd" ? Object.fromEntries(g.secrets) : null,
  };
}

function broadcastGuessThePlayerState(io: Server, room: Room) {
  io.to(room.code).emit("guessplayer:state", publicGuessThePlayerState(room));
}

function opponentIdInDuel(g: GuessThePlayerGameState, socketId: string): string | null {
  return g.order.find((id) => id !== socketId) ?? null;
}

function endGuessThePlayerGame(io: Server, room: Room, winnerId: string | null, forfeited: boolean) {
  const g = room.guessThePlayer;
  if (!g || g.phase === "gameEnd") return;
  g.phase = "gameEnd";
  g.winnerId = winnerId;
  g.forfeited = forfeited;
  broadcastGuessThePlayerState(io, room);
}

// ---------------------------------------------------------------------------
// Football Pyramid — game logic (PROJECT_SPEC.md §5 "Football Pyramid")
//
// Clues reveal on a fixed schedule, same cadence as Who Am I?. The key
// difference: this is "guess anytime" for *every* player, not first-guess-
// wins. Each player can score at most once per round via `pyramid:submit`
// — the moment their guess is correct they're awarded points based on how
// many clues had already been shown (guess early, score more) and are then
// locked out of guessing again this round (wrong guesses before that stay
// silent, no penalty, try again). The round keeps going for everyone else
// until every clue has been shown plus a grace window, or every player still
// in the room has already solved it — whichever comes first. After
// FOOTBALL_PYRAMID_ROUNDS rounds the highest total score wins.
// ---------------------------------------------------------------------------

function initFootballPyramidGame(room: Room) {
  const scores = new Map<string, number>();
  for (const id of room.players.keys()) scores.set(id, 0);

  room.footballPyramid = {
    round: 0,
    totalRounds: FOOTBALL_PYRAMID_ROUNDS,
    target: null as unknown as FootballPyramidPlayer, // set by startFootballPyramidRound below
    clues: [],
    cluesRevealed: 0,
    usedNames: new Set(),
    scores,
    solvedIds: new Set(),
    phase: "clue",
    timer: null,
    nextClueAt: null,
    winnerId: null,
  };
  startFootballPyramidRound(io, room);
}

function startFootballPyramidRound(io: Server, room: Room) {
  const fp = room.footballPyramid;
  if (!fp) return;

  const target = randomFootballPyramidTarget(fp.usedNames);
  if (!target) {
    // Dataset exhausted (shouldn't happen at FOOTBALL_PYRAMID_ROUNDS=5 with ~40+ players) — end early rather than crash.
    endFootballPyramidGame(io, room);
    return;
  }
  fp.usedNames.add(target.name);
  fp.round += 1;
  fp.target = target;
  fp.clues = buildPyramidClues(target);
  fp.cluesRevealed = 1; // first clue is visible immediately when the round starts
  fp.solvedIds = new Set();
  fp.phase = "clue";
  armFootballPyramidClueTimer(io, room);
  broadcastFootballPyramidState(io, room);
}

function armFootballPyramidClueTimer(io: Server, room: Room) {
  const fp = room.footballPyramid;
  if (!fp) return;
  if (fp.timer) clearTimeout(fp.timer);

  if (fp.cluesRevealed < FOOTBALL_PYRAMID_CLUE_COUNT) {
    fp.nextClueAt = Date.now() + FOOTBALL_PYRAMID_CLUE_INTERVAL_MS;
    fp.timer = setTimeout(() => revealNextFootballPyramidClue(io, room), FOOTBALL_PYRAMID_CLUE_INTERVAL_MS);
  } else {
    // All clues shown — give a final grace window before closing the round.
    fp.nextClueAt = null;
    fp.timer = setTimeout(() => endFootballPyramidRound(io, room), FOOTBALL_PYRAMID_POST_LAST_CLUE_MS);
  }
}

function revealNextFootballPyramidClue(io: Server, room: Room) {
  const fp = room.footballPyramid;
  if (!fp || fp.phase !== "clue") return;
  fp.cluesRevealed = Math.min(fp.cluesRevealed + 1, FOOTBALL_PYRAMID_CLUE_COUNT);
  armFootballPyramidClueTimer(io, room);
  broadcastFootballPyramidState(io, room);
}

function footballPyramidPoints(cluesRevealed: number): number {
  // 1 clue revealed (guessed instantly) = 100pts, down to a 20pt floor once every clue is out.
  return Math.max(100 - (cluesRevealed - 1) * 10, 20);
}

function footballPyramidActivePlayerCount(room: Room): number {
  return Array.from(room.players.keys()).length;
}

function endFootballPyramidRound(io: Server, room: Room) {
  const fp = room.footballPyramid;
  if (!fp || fp.phase !== "clue") return;
  fp.phase = "roundEnd";
  if (fp.timer) clearTimeout(fp.timer);
  fp.timer = null;
  broadcastFootballPyramidState(io, room);
  scheduleNextFootballPyramidRoundOrEnd(io, room);
}

function scheduleNextFootballPyramidRoundOrEnd(io: Server, room: Room) {
  const fp = room.footballPyramid;
  if (!fp) return;
  if (fp.timer) clearTimeout(fp.timer);

  if (fp.round >= fp.totalRounds) {
    fp.timer = setTimeout(() => endFootballPyramidGame(io, room), FOOTBALL_PYRAMID_ROUND_END_DELAY_MS);
  } else {
    fp.timer = setTimeout(() => startFootballPyramidRound(io, room), FOOTBALL_PYRAMID_ROUND_END_DELAY_MS);
  }
}

function endFootballPyramidGame(io: Server, room: Room) {
  const fp = room.footballPyramid;
  if (!fp) return;
  if (fp.timer) clearTimeout(fp.timer);
  fp.timer = null;
  fp.phase = "gameEnd";

  let bestId: string | null = null;
  let bestScore = -1;
  for (const [id, score] of fp.scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  fp.winnerId = bestId;
  broadcastFootballPyramidState(io, room);
}

function publicFootballPyramidState(room: Room) {
  const fp = room.footballPyramid;
  if (!fp) return null;
  const revealTarget = fp.phase !== "clue";
  return {
    round: fp.round,
    totalRounds: fp.totalRounds,
    clues: fp.clues.slice(0, fp.cluesRevealed),
    cluesRevealed: fp.cluesRevealed,
    totalClues: FOOTBALL_PYRAMID_CLUE_COUNT,
    phase: fp.phase,
    solvedIds: Array.from(fp.solvedIds),
    targetName: revealTarget ? fp.target.name : null,
    scores: Object.fromEntries(fp.scores),
    nextClueAt: fp.nextClueAt,
    winnerId: fp.winnerId,
  };
}

function broadcastFootballPyramidState(io: Server, room: Room) {
  io.to(room.code).emit("pyramid:state", publicFootballPyramidState(room));
}

// ---------------------------------------------------------------------------
// Shirt Number Madness — game logic (PROJECT_SPEC.md §5 "Shirt Number Madness")
//
// Round-based, same "everyone answers simultaneously" shape as Last Man
// Standing via `shirtmadness:submit`, but nobody is ever eliminated — this
// is a pure scoring game across SHIRT_MADNESS_ROUNDS rounds. A number is
// announced; each survivor-in-the-room gets SHIRT_MADNESS_ANSWER_SECONDS to
// name one real player who wore it. A round resolves the moment everyone
// currently in the room has answered, or when the timer runs out (silence =
// no points). Among valid answers (a real player who really wore that
// number), anyone whose answer names the same player as someone else scores
// zero for that round (a "duplicate", per spec wording); every other valid
// answer scores flat points. After SHIRT_MADNESS_ROUNDS rounds the highest
// total score wins.
// ---------------------------------------------------------------------------

const SHIRT_MADNESS_POINTS = 100;

function initShirtMadnessGame(room: Room) {
  const scores = new Map<string, number>();
  for (const id of room.players.keys()) scores.set(id, 0);

  room.shirtMadness = {
    round: 0,
    totalRounds: SHIRT_MADNESS_ROUNDS,
    number: 0,
    usedNumbers: new Set(),
    answers: new Map(),
    scores,
    roundEndsAt: null,
    lastResults: null,
    phase: "answering",
    timer: null,
    winnerId: null,
  };
  startShirtMadnessRound(io, room);
}

function shirtMadnessActivePlayerIds(room: Room): string[] {
  return Array.from(room.players.keys());
}

function startShirtMadnessRound(io: Server, room: Room) {
  const s = room.shirtMadness;
  if (!s) return;

  const number = randomShirtNumber(s.usedNumbers);
  if (number === null) {
    // Number pool exhausted (shouldn't happen at SHIRT_MADNESS_ROUNDS=5) — end early rather than crash.
    endShirtMadnessGame(io, room);
    return;
  }
  s.usedNumbers.add(number);
  s.round += 1;
  s.number = number;
  s.answers = new Map();
  s.lastResults = null;
  s.phase = "answering";

  if (s.timer) clearTimeout(s.timer);
  s.roundEndsAt = Date.now() + SHIRT_MADNESS_ANSWER_SECONDS * 1000;
  s.timer = setTimeout(() => resolveShirtMadnessRound(io, room), SHIRT_MADNESS_ANSWER_SECONDS * 1000);

  broadcastShirtMadnessState(io, room);
}

function resolveShirtMadnessRound(io: Server, room: Room) {
  const s = room.shirtMadness;
  if (!s || s.phase !== "answering") return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;

  const activeIds = shirtMadnessActivePlayerIds(room);
  const verdicts = new Map<string, { player: ShirtMadnessPlayer; raw: string }>();
  const results: ShirtMadnessAnswerResult[] = [];

  for (const id of activeIds) {
    const raw = s.answers.get(id) ?? null;
    const verdict = verifyShirtAnswer(s.number, raw);
    if (!verdict.ok) {
      results.push({ playerId: id, answer: raw, points: 0, reason: verdict.reason, resolvedName: null });
      continue;
    }
    verdicts.set(id, { player: verdict.player, raw: raw as string });
  }

  // Group valid answers by resolved player name to find duplicates.
  const byName = new Map<string, string[]>();
  for (const [id, v] of verdicts.entries()) {
    const arr = byName.get(v.player.name) ?? [];
    arr.push(id);
    byName.set(v.player.name, arr);
  }

  for (const [name, ids] of byName.entries()) {
    const isDuplicate = ids.length > 1;
    const points = isDuplicate ? 0 : SHIRT_MADNESS_POINTS;
    for (const id of ids) {
      results.push({
        playerId: id,
        answer: verdicts.get(id)!.raw,
        points,
        reason: isDuplicate ? "duplicate" : null,
        resolvedName: name,
      });
      if (points > 0) s.scores.set(id, (s.scores.get(id) ?? 0) + points);
    }
  }

  s.lastResults = results;
  s.phase = "roundEnd";
  s.roundEndsAt = null;
  broadcastShirtMadnessState(io, room);
  scheduleNextShirtMadnessRoundOrEnd(io, room);
}

function scheduleNextShirtMadnessRoundOrEnd(io: Server, room: Room) {
  const s = room.shirtMadness;
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);

  if (s.round >= s.totalRounds) {
    s.timer = setTimeout(() => endShirtMadnessGame(io, room), SHIRT_MADNESS_ROUND_END_DELAY_MS);
  } else {
    s.timer = setTimeout(() => startShirtMadnessRound(io, room), SHIRT_MADNESS_ROUND_END_DELAY_MS);
  }
}

function endShirtMadnessGame(io: Server, room: Room) {
  const s = room.shirtMadness;
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  s.phase = "gameEnd";

  let bestId: string | null = null;
  let bestScore = -1;
  for (const [id, score] of s.scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  s.winnerId = bestId;
  broadcastShirtMadnessState(io, room);
}

function publicShirtMadnessState(room: Room) {
  const s = room.shirtMadness;
  if (!s) return null;
  return {
    round: s.round,
    totalRounds: s.totalRounds,
    number: s.number,
    answeredPlayerIds: Array.from(s.answers.keys()),
    roundEndsAt: s.roundEndsAt,
    lastResults: s.lastResults,
    phase: s.phase,
    scores: Object.fromEntries(s.scores),
    winnerId: s.winnerId,
  };
}

function broadcastShirtMadnessState(io: Server, room: Room) {
  io.to(room.code).emit("shirtmadness:state", publicShirtMadnessState(room));
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const httpServer = createServer((req, res) => {
  // Health check for Render/Fly (and anyone curious) — engine.io only
  // intercepts requests under its own `/socket.io` path, so this callback
  // handling "/" and "/health" directly does not conflict with it.
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Football Minds socket server is running.");
  }
});
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGINS,
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket: Socket) => {
  socket.on(
    "room:create",
    (payload: { displayName: string; mode: RoomMode }, ack?: (res: unknown) => void) => {
      const displayName = (payload?.displayName ?? "").trim().slice(0, 24) || "Player";
      const mode: RoomMode = ["1v1", "2v2", "ffa"].includes(payload?.mode)
        ? payload.mode
        : "ffa";

      const code = generateRoomCode();
      const room: Room = {
        code,
        mode,
        gameId: null,
        hostId: socket.id,
        players: new Map([
          [socket.id, { socketId: socket.id, displayName, ready: false, isHost: true, connected: true }],
        ]),
        chat: [],
        started: false,
        createdAt: Date.now(),
      };

      rooms.set(code, room);
      socketRoom.set(socket.id, code);
      socket.join(code);

      ack?.({ ok: true, code });
      broadcastRoomState(io, room);
    }
  );

  socket.on(
    "room:join",
    (payload: { code: string; displayName: string }, ack?: (res: unknown) => void) => {
      const code = (payload?.code ?? "").trim().toUpperCase();
      const room = rooms.get(code);

      if (!room) {
        ack?.({ ok: false, error: "Room not found." });
        return;
      }
      if (room.started) {
        ack?.({ ok: false, error: "This game has already started." });
        return;
      }
      if (room.players.size >= capacityForMode(room.mode)) {
        ack?.({ ok: false, error: "Room is full." });
        return;
      }

      const displayName = (payload?.displayName ?? "").trim().slice(0, 24) || "Player";
      room.players.set(socket.id, {
        socketId: socket.id,
        displayName,
        ready: false,
        isHost: false,
        connected: true,
      });
      socketRoom.set(socket.id, code);
      socket.join(code);

      ack?.({ ok: true, code });
      broadcastRoomState(io, room);
    }
  );

  socket.on("room:ready", (payload: { ready: boolean }) => {
    const room = roomForSocket(socket.id);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.ready = Boolean(payload?.ready);
    broadcastRoomState(io, room);
  });

  socket.on("room:changeMode", (payload: { mode: RoomMode }) => {
    const room = roomForSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (!["1v1", "2v2", "ffa"].includes(payload?.mode)) return;
    room.mode = payload.mode;
    broadcastRoomState(io, room);
  });

  socket.on("room:changeGame", (payload: { gameId: GameId }) => {
    const room = roomForSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    room.gameId = payload.gameId;
    broadcastRoomState(io, room);
  });

  socket.on("room:kick", (payload: { playerId: string }) => {
    const room = roomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    const target = payload?.playerId;
    if (!target || target === socket.id || !room.players.has(target)) return;

    room.players.delete(target);
    socketRoom.delete(target);
    io.sockets.sockets.get(target)?.leave(room.code);
    io.to(target).emit("room:kicked");
    broadcastRoomState(io, room);
  });

  socket.on("room:start", (ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) {
      ack?.({ ok: false, error: "Only the host can start the game." });
      return;
    }
    if (!room.gameId) {
      ack?.({ ok: false, error: "Pick a game first." });
      return;
    }
    if (room.gameId === "guess-the-player" && room.mode !== "1v1") {
      ack?.({ ok: false, error: "Guess The Player currently only supports 1v1 mode." });
      return;
    }
    const everyoneReady = Array.from(room.players.values())
      .filter((p) => !p.isHost)
      .every((p) => p.ready);
    if (!everyoneReady) {
      ack?.({ ok: false, error: "Not everyone is ready yet." });
      return;
    }

    room.started = true;

    if (room.gameId === "the-chain") {
      initChainGame(room);
    } else if (room.gameId === "who-am-i") {
      initWhoAmIGame(room);
    } else if (room.gameId === "career-maze") {
      initCareerMazeGame(room);
    } else if (room.gameId === "last-man-standing") {
      initLastManStandingGame(room);
    } else if (room.gameId === "guess-the-player") {
      initGuessThePlayerGame(room);
    } else if (room.gameId === "football-pyramid") {
      initFootballPyramidGame(room);
    } else if (room.gameId === "shirt-madness") {
      initShirtMadnessGame(room);
    }

    ack?.({ ok: true });
    io.to(room.code).emit("room:started", { gameId: room.gameId });
    broadcastRoomState(io, room);
    if (room.chain) broadcastChainState(io, room);
    if (room.whoAmI) broadcastWhoAmIState(io, room);
    if (room.careerMaze) broadcastCareerMazeState(io, room);
    if (room.lastManStanding) broadcastLastManStandingState(io, room);
    if (room.guessThePlayer) broadcastGuessThePlayerState(io, room);
    if (room.footballPyramid) broadcastFootballPyramidState(io, room);
    if (room.shirtMadness) broadcastShirtMadnessState(io, room);
  });

  // Fired from a game's winner screen. Resets the room back to a fresh
  // pre-match state so the host can pick a game and start again, instead
  // of every client's room page permanently redirecting back into the
  // just-finished game (room.started never being cleared was the actual
  // bug — see PROGRESS.md's 2026-07-29 "live two-tab playtest" entry).
  socket.on("room:backToLobby", (_payload: unknown, ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    if (!room) {
      ack?.({ ok: false, error: "Room not found." });
      return;
    }
    if (!isRoomGameOver(room)) {
      ack?.({ ok: false, error: "The match hasn't finished yet." });
      return;
    }

    room.started = false;
    room.chain = undefined;
    room.whoAmI = undefined;
    room.careerMaze = undefined;
    room.lastManStanding = undefined;
    room.guessThePlayer = undefined;
    room.footballPyramid = undefined;
    room.shirtMadness = undefined;

    ack?.({ ok: true });
    broadcastRoomState(io, room);
  });

  socket.on("chat:message", (payload: { text: string; emoji?: string }) => {
    const room = roomForSocket(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player) return;

    const text = (payload?.text ?? "").trim().slice(0, 280);
    if (!text && !payload?.emoji) return;

    const message: ChatMessage = {
      id: `${socket.id}-${Date.now()}`,
      from: player.displayName,
      text,
      emoji: payload?.emoji,
      ts: Date.now(),
    };
    room.chat.push(message);
    if (room.chat.length > MAX_CHAT_HISTORY) room.chat.shift();

    io.to(room.code).emit("chat:message", message);
  });

  // --- The Chain ---------------------------------------------------------

  socket.on("chain:sync", (ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    ack?.(room?.chain ? publicChainState(room) : null);
  });

  socket.on("chain:submit", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const c = room?.chain;
    if (!room || !c || c.winnerId) return;
    if (c.order[c.currentIndex] !== socket.id) return; // not your turn
    if (c.eliminated.has(socket.id)) return;

    const raw = (payload?.name ?? "").trim();
    const player = resolvePlayer(raw);
    const last = c.chainPlayers[c.chainPlayers.length - 1];
    const displayName = room.players.get(socket.id)?.displayName ?? "Player";

    let reason: string | null = null;
    if (!player) {
      reason = "not-found";
    } else if (c.usedNames.has(normalizeName(player.name))) {
      reason = "already-used";
    } else if (!wereTeammates(last, player)) {
      reason = "not-teammates";
    } else if (c.modifier && !c.modifier.test(player)) {
      reason = "modifier";
    }

    if (reason) {
      io.to(room.code).emit("chain:wrongAnswer", { playerId: socket.id, guess: raw, reason });
      eliminateChainPlayer(io, room, socket.id);
      return;
    }

    const p = player!;
    c.chain.push({ name: p.name, nationality: p.nationality, position: p.position, by: displayName });
    c.chainPlayers.push(p);
    c.usedNames.add(normalizeName(p.name));
    c.successfulTurns++;

    // Fire Mode: once every survivor has successfully taken at least one
    // turn, a random restriction kicks in for the rest of the match.
    if (!c.modifier && c.successfulTurns >= c.order.length) {
      c.modifier = randomModifier();
      io.to(room.code).emit("chain:fireMode", { description: c.modifier.description });
    }

    advanceChainTurn(io, room);
    broadcastChainState(io, room);
  });

  // --- Who Am I? ----------------------------------------------------------

  socket.on("whoami:sync", (ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    ack?.(room?.whoAmI ? publicWhoAmIState(room) : null);
  });

  socket.on("whoami:submit", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const w = room?.whoAmI;
    if (!room || !w) return;
    if (w.phase !== "clue") return; // round already resolved, guess is too late

    const raw = (payload?.name ?? "").trim();
    if (!raw) return;
    if (!isCorrectWhoAmIGuess(w.target, raw)) return; // wrong guesses are silent — no penalty, just try again

    // First correct guess wins the round.
    w.phase = "roundEnd";
    w.solvedBy = socket.id;
    if (w.timer) clearTimeout(w.timer);
    w.timer = null;

    const points = whoAmIPoints(w.cluesRevealed);
    w.scores.set(socket.id, (w.scores.get(socket.id) ?? 0) + points);

    io.to(room.code).emit("whoami:solved", {
      playerId: socket.id,
      displayName: room.players.get(socket.id)?.displayName ?? "Player",
      points,
      targetName: w.target.name,
    });
    broadcastWhoAmIState(io, room);
    scheduleNextWhoAmIRoundOrEnd(io, room);
  });

  // --- Career Maze ---------------------------------------------------------

  socket.on("careermaze:sync", (ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    ack?.(room?.careerMaze ? publicCareerMazeState(room) : null);
  });

  socket.on("careermaze:submit", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const cm = room?.careerMaze;
    if (!room || !cm) return;
    if (cm.phase !== "guess") return; // round already resolved, guess is too late

    const raw = (payload?.name ?? "").trim();
    if (!raw) return;
    if (!isCorrectCareerMazeGuess(cm.target, raw)) return; // wrong guesses are silent — no penalty, just try again

    // First correct guess wins the round.
    cm.phase = "roundEnd";
    cm.solvedBy = socket.id;
    if (cm.timer) clearTimeout(cm.timer);
    cm.timer = null;

    const points = careerMazePoints(cm.revealedAt);
    cm.scores.set(socket.id, (cm.scores.get(socket.id) ?? 0) + points);

    io.to(room.code).emit("careermaze:solved", {
      playerId: socket.id,
      displayName: room.players.get(socket.id)?.displayName ?? "Player",
      points,
      targetName: cm.target.name,
    });
    broadcastCareerMazeState(io, room);
    scheduleNextCareerMazeRoundOrEnd(io, room);
  });

  // --- Last Man Standing ---------------------------------------------------

  socket.on("lastmanstanding:sync", (ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    ack?.(room?.lastManStanding ? publicLastManStandingState(room) : null);
  });

  socket.on("lastmanstanding:submit", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const l = room?.lastManStanding;
    if (!room || !l) return;
    if (l.phase !== "answering") return; // round already resolved, answer is too late
    if (l.eliminated.has(socket.id)) return;
    if (l.answers.has(socket.id)) return; // one answer per round, no changing your mind

    const raw = (payload?.name ?? "").trim();
    if (!raw) return;
    l.answers.set(socket.id, raw);

    // Resolve early the moment every survivor has answered, instead of
    // always waiting out the full timer.
    const survivors = lastManStandingSurvivors(room);
    const allAnswered = survivors.every((id) => l.answers.has(id));
    if (allAnswered) {
      resolveLastManStandingRound(io, room);
    } else {
      broadcastLastManStandingState(io, room);
    }
  });

  // --- Guess The Player ---------------------------------------------------

  socket.on("guessplayer:sync", (ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    ack?.(room?.guessThePlayer ? publicGuessThePlayerState(room) : null);
    // Re-send the caller's own secret too, in case they reconnected mid-match
    // (private state that a room-wide broadcast never carries).
    const mine = room?.guessThePlayer?.secrets.get(socket.id);
    if (mine) io.to(socket.id).emit("guessplayer:yourSecret", { name: mine });
  });

  socket.on("guessplayer:pick", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const g = room?.guessThePlayer;
    if (!room || !g || g.phase !== "picking") return;
    if (g.secrets.has(socket.id)) return; // already locked in, no changing your mind

    const raw = (payload?.name ?? "").trim();
    if (!isValidPick(raw)) return;

    g.secrets.set(socket.id, raw);
    io.to(socket.id).emit("guessplayer:yourSecret", { name: raw });

    if (g.secrets.size >= g.order.length) {
      g.phase = "playing";
    }
    broadcastGuessThePlayerState(io, room);
  });

  socket.on("guessplayer:guess", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const g = room?.guessThePlayer;
    if (!room || !g || g.phase !== "playing") return;

    const raw = (payload?.name ?? "").trim();
    if (!raw) return;

    const opponentId = opponentIdInDuel(g, socket.id);
    const opponentSecret = opponentId ? g.secrets.get(opponentId) : undefined;

    io.to(room.code).emit("guessplayer:guessMade", {
      playerId: socket.id,
      displayName: room.players.get(socket.id)?.displayName ?? "Player",
      guess: raw,
    });

    if (opponentSecret && namesMatch(raw, opponentSecret)) {
      endGuessThePlayerGame(io, room, socket.id, false);
    }
  });

  // --- Football Pyramid ---------------------------------------------------

  socket.on("pyramid:sync", (ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    ack?.(room?.footballPyramid ? publicFootballPyramidState(room) : null);
  });

  socket.on("pyramid:submit", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const fp = room?.footballPyramid;
    if (!room || !fp) return;
    if (fp.phase !== "clue") return; // round already closed, guess is too late
    if (fp.solvedIds.has(socket.id)) return; // already scored this round, no repeat scoring

    const raw = (payload?.name ?? "").trim();
    if (!raw) return;
    if (!isCorrectFootballPyramidGuess(fp.target, raw)) return; // wrong guesses are silent — no penalty, just try again

    const points = footballPyramidPoints(fp.cluesRevealed);
    fp.solvedIds.add(socket.id);
    fp.scores.set(socket.id, (fp.scores.get(socket.id) ?? 0) + points);

    io.to(room.code).emit("pyramid:solved", {
      playerId: socket.id,
      displayName: room.players.get(socket.id)?.displayName ?? "Player",
      points,
    });
    broadcastFootballPyramidState(io, room);

    // Everyone currently in the room has scored this round — no reason to
    // keep waiting out the clue schedule/grace window.
    if (fp.solvedIds.size >= footballPyramidActivePlayerCount(room)) {
      endFootballPyramidRound(io, room);
    }
  });

  // --- Shirt Number Madness ------------------------------------------------

  socket.on("shirtmadness:sync", (ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    ack?.(room?.shirtMadness ? publicShirtMadnessState(room) : null);
  });

  socket.on("shirtmadness:submit", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const s = room?.shirtMadness;
    if (!room || !s) return;
    if (s.phase !== "answering") return; // round already resolved, answer is too late
    if (s.answers.has(socket.id)) return; // one answer per round, no changing your mind

    const raw = (payload?.name ?? "").trim();
    if (!raw) return;
    s.answers.set(socket.id, raw);

    // Resolve early the moment everyone currently in the room has answered.
    const activeIds = shirtMadnessActivePlayerIds(room);
    const allAnswered = activeIds.every((id) => s.answers.has(id));
    if (allAnswered) {
      resolveShirtMadnessRound(io, room);
    } else {
      broadcastShirtMadnessState(io, room);
    }
  });

  socket.on("room:leave", () => handleLeave(socket));
  socket.on("disconnect", () => handleLeave(socket));
});

// True once the currently-active game (if any) has reached a real end
// state, so `room:backToLobby` can't be used to bail out of a match still
// in progress and reset everyone's screen out from under them.
function isRoomGameOver(room: Room): boolean {
  if (!room.started) return true;
  if (room.chain) return Boolean(room.chain.winnerId);
  if (room.whoAmI) return room.whoAmI.phase === "gameEnd";
  if (room.careerMaze) return room.careerMaze.phase === "gameEnd";
  if (room.lastManStanding) return room.lastManStanding.phase === "gameEnd";
  if (room.guessThePlayer) return room.guessThePlayer.phase === "gameEnd";
  if (room.footballPyramid) return room.footballPyramid.phase === "gameEnd";
  if (room.shirtMadness) return room.shirtMadness.phase === "gameEnd";
  // room.started is true but no per-game state object exists yet — treat
  // as over rather than trap the room in an unrecoverable state.
  return true;
}

function roomForSocket(socketId: string): Room | undefined {
  const code = socketRoom.get(socketId);
  return code ? rooms.get(code) : undefined;
}

function handleLeave(socket: Socket) {
  const room = roomForSocket(socket.id);
  if (!room) return;

  room.players.delete(socket.id);
  socketRoom.delete(socket.id);
  socket.leave(room.code);

  if (room.players.size === 0) {
    if (room.chain?.timer) clearTimeout(room.chain.timer);
    if (room.whoAmI?.timer) clearTimeout(room.whoAmI.timer);
    if (room.careerMaze?.timer) clearTimeout(room.careerMaze.timer);
    if (room.lastManStanding?.timer) clearTimeout(room.lastManStanding.timer);
    if (room.footballPyramid?.timer) clearTimeout(room.footballPyramid.timer);
    if (room.shirtMadness?.timer) clearTimeout(room.shirtMadness.timer);
    rooms.delete(room.code);
    return;
  }

  // Mid-match disconnect during The Chain counts as an elimination so the
  // game doesn't stall waiting on a turn that will never come.
  if (room.chain && !room.chain.winnerId && !room.chain.eliminated.has(socket.id)) {
    eliminateChainPlayer(io, room, socket.id);
  }

  // Mid-match disconnect during Last Man Standing: mark eliminated so they
  // stop counting toward "everyone answered", and resolve/end as needed.
  if (room.lastManStanding && room.lastManStanding.phase !== "gameEnd") {
    const l = room.lastManStanding;
    l.eliminated.add(socket.id);
    if (l.phase === "answering") {
      const survivors = lastManStandingSurvivors(room);
      if (survivors.length <= 1 || survivors.every((id) => l.answers.has(id))) {
        resolveLastManStandingRound(io, room);
      }
    }
  }

  // Mid-match disconnect during Shirt Number Madness: the departing player
  // simply stops counting toward "everyone answered" (no elimination in
  // this game) — resolve the round early if that was the last holdout.
  if (room.shirtMadness && room.shirtMadness.phase === "answering") {
    const s = room.shirtMadness;
    const activeIds = shirtMadnessActivePlayerIds(room);
    if (activeIds.length === 0 || activeIds.every((id) => s.answers.has(id))) {
      resolveShirtMadnessRound(io, room);
    }
  }

  // Mid-match disconnect during Guess The Player: 1v1 only, so the other
  // player leaving ends the duel outright — declare the remaining player
  // the winner by forfeit rather than leaving the game stuck forever.
  if (room.guessThePlayer && room.guessThePlayer.phase !== "gameEnd") {
    const remaining = room.guessThePlayer.order.find((id) => id !== socket.id && room.players.has(id));
    endGuessThePlayerGame(io, room, remaining ?? null, true);
  }

  // Host left — hand off to whoever's been in the room longest.
  if (room.hostId === socket.id) {
    const next = Array.from(room.players.values())[0];
    room.hostId = next.socketId;
    next.isHost = true;
  }

  broadcastRoomState(io, room);
}

httpServer.listen(PORT, () => {
  console.log(`[socket] Football Minds room server listening on :${PORT}`);
});
