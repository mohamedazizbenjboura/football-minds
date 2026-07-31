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
import { randomUUID } from "crypto";
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
const GUESS_THE_PLAYER_ASK_SECONDS = 30; // time the current asker has to choose Ask/Guess and submit it
const GUESS_THE_PLAYER_ANSWER_SECONDS = 20; // time the opposing team has to answer a pending question
// BUG FIX (live-problems.md): how long a disconnected socket (page reload,
// brief network blip) has to reconnect via room:rejoin before finalizeLeave
// actually removes them / ends the match by forfeit.
const RECONNECT_GRACE_MS = 20000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoomMode = "1v1" | "2v2" | "3v3" | "4v4" | "5v5" | "ffa";
// Every team-vs-team size Guess The Player supports (1v1 through 5v5).
// "ffa" is a separate, teamless mode used by every OTHER game.
const TEAM_MODES: RoomMode[] = ["1v1", "2v2", "3v3", "4v4", "5v5"];
const VALID_ROOM_MODES: RoomMode[] = [...TEAM_MODES, "ffa"];
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
  team?: 1 | 2; // which side of a team mode (2v2..10v10) they've joined in the lobby
  connected: boolean;
  // BUG FIX (live-problems.md — "No active room" after the router.push ->
  // window.location.href fix): a hard navigation always disconnects the
  // socket and reconnects as a brand-new socket.id. Without a persistent
  // per-player token, the server has no way to tell "the same player came
  // back" from "a stranger joined" and previously just deleted/forfeited
  // on every reload. The client generates this once per tab (sessionStorage,
  // so it's stable across a `window.location.href` reload but distinct per
  // tab) and replays it on room:rejoin.
  token: string;
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

interface GuessThePlayerQuestion {
  id: string;
  askerId: string;
  askerTeam: 1 | 2;
  text: string;
  // Only ever populated by members of the OPPOSING team from askerTeam.
  // Revealed live as each teammate answers ("sondage"/poll), not held back
  // until everyone's answered.
  answers: Record<string, "yes" | "no">;
}

interface GuessThePlayerGameState {
  // FEATURE (Aziz's request): team-based, covering every mode from 1v1 up
  // to 10v10 through ONE model — exactly two teams, each with N members
  // (N=1 for 1v1). Each team shares a single hidden secret. For a team of
  // size 1 the "propose" and "lock" steps collapse into the same
  // immediate pick-and-lock behavior 1v1 always had — no extra step, no
  // UI change for 1v1. For N>=2, the first player who joined that team
  // (in the lobby) is the leader: only the leader can propose a candidate;
  // every OTHER teammate must click "Agree" on the CURRENT proposal
  // before it locks in as the team's real secret. Proposing a different
  // candidate clears that team's prior agreements.
  order: string[]; // every participating socketId, both teams combined
  teamOf: Record<string, 1 | 2>; // snapshotted from RoomPlayer.team at game start
  proposedSecret: { 1: string | null; 2: string | null };
  agreedIds: Set<string>; // teammates (never the leader) who agreed to their team's CURRENT proposal
  locked: { 1: boolean; 2: boolean };
  secrets: { 1: string | null; 2: string | null }; // finalized once locked
  phase: "picking" | "playing" | "gameEnd";
  winnerTeam: 1 | 2 | null;
  winnerId: string | null; // the specific player whose guess won it (null on a no-winner forfeit)
  forfeited: boolean; // true if the game ended early because a whole team disconnected
  // FEATURE (Aziz's request): turn-based Q&A once the game reaches
  // "playing". `questionOrder` interleaves both team rosters one player at
  // a time (Team1[0], Team2[0], Team1[1], Team2[1], ...) so the turn to
  // ask always alternates teams. `askerIndex` is a raw pointer into that
  // array — use `currentAsker()` to resolve it to the next CONNECTED
  // player rather than reading questionOrder[askerIndex] directly, since a
  // disconnect shouldn't stall the turn order. `currentQuestion` is null
  // exactly when it's the current asker's turn to submit a question; once
  // they do, it holds that question until every currently-connected member
  // of the OPPOSING team has answered Yes/No, at which point it's pushed
  // onto `questionHistory` and the turn advances. Submitting a final guess
  // via `guessplayer:guess` is completely independent of all of this — any
  // player, on either team, may guess at any time regardless of turn.
  questionOrder: string[];
  askerIndex: number;
  currentQuestion: GuessThePlayerQuestion | null;
  questionHistory: GuessThePlayerQuestion[];
  // FEATURE (Aziz's request): every player turn is timed. `turnEndsAt` is
  // whichever deadline is currently active — the current asker's window to
  // choose Ask/Guess and submit it (GUESS_THE_PLAYER_ASK_SECONDS), or, once
  // they've asked, the opposing team's window to answer Yes/No
  // (GUESS_THE_PLAYER_ANSWER_SECONDS). Sent to clients for a countdown;
  // `timer` is the server-side setTimeout that actually enforces it.
  turnEndsAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
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
  // Small private lobby chat per team, used by Guess The Player's team
  // modes so the leader and teammates can agree on a pick without the
  // opposing team seeing the discussion. Unused (stays empty) in 1v1/ffa.
  teamChat: { 1: ChatMessage[]; 2: ChatMessage[] };
  started: boolean;
  createdAt: number;
  chain?: ChainGameState;
  whoAmI?: WhoAmIGameState;
  careerMaze?: CareerMazeGameState;
  lastManStanding?: LastManStandingGameState;
  guessThePlayer?: GuessThePlayerGameState;
  footballPyramid?: FootballPyramidGameState;
  shirtMadness?: ShirtMadnessGameState;
  // BUG FIX (live-problems.md): a socket that disconnects (page reload,
  // brief network blip) gets a grace window to reconnect via room:rejoin
  // before finalizeLeave actually removes them / ends the match. Keyed by
  // the OLD (now-disconnected) socketId.
  pendingDisconnects: Map<string, { token: string; timer: ReturnType<typeof setTimeout> }>;
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
  if (mode === "ffa") return MAX_PLAYERS;
  const m = /^(\d+)v(\d+)$/.exec(mode);
  if (m) return Number(m[1]) * 2;
  return MAX_PLAYERS;
}

function teamRoomName(code: string, team: 1 | 2): string {
  return `${code}:team${team}`;
}

// BUG FIX (live-problems.md): re-homes every reference to a disconnected
// player's OLD socketId onto their NEW socketId after a successful
// room:rejoin. Every game engine in this file keys its live state by
// socketId (turn order arrays, teamOf records, score maps, elimination
// sets, the currently-pending question, etc.) since socketId was always
// assumed stable for the lifetime of a match — which a hard page reload
// breaks. This is the one place that assumption gets repaired. Historical,
// already-archived data (Guess The Player's questionHistory, chat `from`
// which is name-based already) is deliberately left alone — only live,
// still-referenced state needs to follow the player to their new socket.
function swapSocketId(room: Room, oldId: string, newId: string) {
  const player = room.players.get(oldId);
  if (player) {
    room.players.delete(oldId);
    player.socketId = newId;
    player.connected = true;
    room.players.set(newId, player);
  }
  if (room.hostId === oldId) room.hostId = newId;
  socketRoom.delete(oldId);
  socketRoom.set(newId, room.code);

  const newSocket = io.sockets.sockets.get(newId);
  newSocket?.join(room.code);
  if (player?.team) newSocket?.join(teamRoomName(room.code, player.team));

  if (room.chain) {
    const c = room.chain;
    c.order = c.order.map((id) => (id === oldId ? newId : id));
    if (c.eliminated.has(oldId)) {
      c.eliminated.delete(oldId);
      c.eliminated.add(newId);
    }
    if (c.winnerId === oldId) c.winnerId = newId;
  }

  if (room.whoAmI?.scores.has(oldId)) {
    const v = room.whoAmI.scores.get(oldId)!;
    room.whoAmI.scores.delete(oldId);
    room.whoAmI.scores.set(newId, v);
  }
  if (room.whoAmI?.solvedBy === oldId) room.whoAmI.solvedBy = newId;
  if (room.whoAmI?.winnerId === oldId) room.whoAmI.winnerId = newId;

  if (room.careerMaze?.scores.has(oldId)) {
    const v = room.careerMaze.scores.get(oldId)!;
    room.careerMaze.scores.delete(oldId);
    room.careerMaze.scores.set(newId, v);
  }
  if (room.careerMaze?.solvedBy === oldId) room.careerMaze.solvedBy = newId;
  if (room.careerMaze?.winnerId === oldId) room.careerMaze.winnerId = newId;

  if (room.lastManStanding) {
    const l = room.lastManStanding;
    l.order = l.order.map((id) => (id === oldId ? newId : id));
    if (l.eliminated.has(oldId)) {
      l.eliminated.delete(oldId);
      l.eliminated.add(newId);
    }
    if (l.answers.has(oldId)) {
      const v = l.answers.get(oldId)!;
      l.answers.delete(oldId);
      l.answers.set(newId, v);
    }
    if (l.winnerId === oldId) l.winnerId = newId;
  }

  if (room.guessThePlayer) {
    const g = room.guessThePlayer;
    g.order = g.order.map((id) => (id === oldId ? newId : id));
    if (g.teamOf[oldId] !== undefined) {
      g.teamOf[newId] = g.teamOf[oldId];
      delete g.teamOf[oldId];
    }
    g.questionOrder = g.questionOrder.map((id) => (id === oldId ? newId : id));
    if (g.currentQuestion) {
      if (g.currentQuestion.askerId === oldId) g.currentQuestion.askerId = newId;
      if (g.currentQuestion.answers[oldId] !== undefined) {
        g.currentQuestion.answers[newId] = g.currentQuestion.answers[oldId];
        delete g.currentQuestion.answers[oldId];
      }
    }
    if (g.winnerId === oldId) g.winnerId = newId;
  }

  if (room.footballPyramid) {
    const fp = room.footballPyramid;
    if (fp.scores.has(oldId)) {
      const v = fp.scores.get(oldId)!;
      fp.scores.delete(oldId);
      fp.scores.set(newId, v);
    }
    if (fp.solvedIds.has(oldId)) {
      fp.solvedIds.delete(oldId);
      fp.solvedIds.add(newId);
    }
    if (fp.winnerId === oldId) fp.winnerId = newId;
  }

  if (room.shirtMadness) {
    const s = room.shirtMadness;
    if (s.scores.has(oldId)) {
      const v = s.scores.get(oldId)!;
      s.scores.delete(oldId);
      s.scores.set(newId, v);
    }
    if (s.answers.has(oldId)) {
      const v = s.answers.get(oldId)!;
      s.answers.delete(oldId);
      s.answers.set(newId, v);
    }
    if (s.winnerId === oldId) s.winnerId = newId;
  }
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
// Guess The Player — game logic (PROJECT_SPEC.md §5.1 "Guess The Player")
//
// Team-based across every supported mode, 1v1 through 5v5 (see
// `GuessThePlayerGameState`'s own header comment for the full model). Once
// both teams' secrets are locked in (instantly for 1v1, via the leader/
// agree flow for 2v2+), the phase flips to "playing" and turns to act
// alternate strictly between the two teams, one player at a time
// (`questionOrder`/`askerIndex`, see below). On their turn, and ONLY on
// their turn, the current asker picks exactly one of two actions:
// - Ask a question (`guessplayer:askQuestion`): opposing-team members
//   answer Yes/No (`guessplayer:answerQuestion`), revealed live as a poll;
//   once every connected opposing-team member has answered, the turn
//   advances.
// - Guess the opposing team's secret (`guessplayer:guess`): resolves
//   immediately — a correct guess wins the match for the whole team and
//   reveals both secrets; a miss simply advances the turn, same as a
//   fully-answered question.
// No other player — not a teammate whose turn it isn't, not anyone on the
// opposing team — may ask or guess out of turn. Each team's own
// proposed/locked secret is only ever emitted privately to that team's
// Socket.IO room (`guessplayer:teamSecret`, sent to
// `teamRoomName(code, team)`) — never the room-wide broadcast — so "shown
// as a real <PlayerAvatar/> only to its owner('s team)" actually holds
// server-side, not just in the UI.
// ---------------------------------------------------------------------------

function guessThePlayerTeamMembers(room: Room, team: 1 | 2): string[] {
  const g = room.guessThePlayer;
  if (!g) return [];
  return g.order.filter((id) => g.teamOf[id] === team);
}

// The leader is simply the first-joined (still-connected) member of that
// team — computed on demand so a leader who disconnects is automatically
// replaced by the next teammate, with no separate handoff step needed.
function guessThePlayerLeader(room: Room, team: 1 | 2): string | null {
  const members = guessThePlayerTeamMembers(room, team).filter((id) => room.players.has(id));
  return members[0] ?? null;
}

// FEATURE (Aziz's request): turns to ASK a question alternate strictly
// between the two teams, one player at a time — e.g. in 2v2:
// Team1[0], Team2[0], Team1[1], Team2[1], looping back to Team1[0]. Built
// once, right when the game flips from "picking" to "playing" (team
// rosters are locked in by then, so this never needs to change size later
// — only the pointer into it moves as players disconnect).
function buildGuessThePlayerQuestionOrder(room: Room): string[] {
  const team1 = guessThePlayerTeamMembers(room, 1);
  const team2 = guessThePlayerTeamMembers(room, 2);
  const order: string[] = [];
  const maxLen = Math.max(team1.length, team2.length);
  for (let i = 0; i < maxLen; i++) {
    if (team1[i]) order.push(team1[i]);
    if (team2[i]) order.push(team2[i]);
  }
  return order;
}

// Resolves `askerIndex` to the next actually-CONNECTED player in
// `questionOrder`, normalizing the stored index as a side effect so a
// disconnected asker's turn is silently handed to whoever's next rather
// than stalling the game. Returns null only if nobody in the order is
// connected anymore (which shouldn't happen — a fully-empty team already
// ends the match by forfeit before this could be reached).
function guessThePlayerCurrentAsker(room: Room): string | null {
  const g = room.guessThePlayer;
  if (!g || g.questionOrder.length === 0) return null;
  const n = g.questionOrder.length;
  for (let i = 0; i < n; i++) {
    const idx = (g.askerIndex + i) % n;
    const id = g.questionOrder[idx];
    if (room.players.has(id)) {
      g.askerIndex = idx;
      return id;
    }
  }
  return null;
}

function guessThePlayerAdvanceTurn(room: Room) {
  const g = room.guessThePlayer;
  if (!g || g.questionOrder.length === 0) return;
  g.askerIndex = (g.askerIndex + 1) % g.questionOrder.length;
  guessThePlayerCurrentAsker(room); // normalize immediately in case the new spot is disconnected too
}

// Every currently-connected member of the team OPPOSING `askingTeam` — the
// exact set required to answer a pending question before it resolves.
function guessThePlayerOpposingConnected(room: Room, askingTeam: 1 | 2): string[] {
  const opponent: 1 | 2 = askingTeam === 1 ? 2 : 1;
  return guessThePlayerTeamMembers(room, opponent).filter((id) => room.players.has(id));
}

// Once every required opposing-team member has answered the pending
// question (or that set is empty, e.g. they've all disconnected — this
// keeps the turn from stalling forever), archive it to history and
// advance the turn. No-ops if the question isn't fully answered yet.
function guessThePlayerMaybeResolveQuestion(io: Server, room: Room) {
  const g = room.guessThePlayer;
  if (!g || !g.currentQuestion) return;
  const required = guessThePlayerOpposingConnected(room, g.currentQuestion.askerTeam);
  const allAnswered = required.every((id) => g.currentQuestion!.answers[id] !== undefined);
  if (!allAnswered) return;

  g.questionHistory.push(g.currentQuestion);
  if (g.questionHistory.length > 30) g.questionHistory.shift();
  g.currentQuestion = null;
  guessThePlayerAdvanceTurn(room);
  // The next asker's turn just started — give them a fresh ask window
  // (Aziz's request: every turn is timed). Without this the countdown
  // only ever ran for the very first turn of the match.
  startGuessThePlayerAskTimer(io, room);
}

// --- Turn timer (Aziz's request) --------------------------------------
// Two back-to-back deadlines, reusing the same `g.timer`/`g.turnEndsAt`
// slot since only one is ever active at once: the ASK window (current
// asker choosing Ask/Guess and submitting it) and, once a question is
// actually asked, the ANSWER window (opposing team tapping Yes/No). Both
// timeouts are "soft" — nobody is eliminated, the turn just keeps moving,
// matching the no-penalty timeout pattern already used elsewhere (Who Am
// I?'s unsolved round, Football Pyramid's grace period).

function clearGuessThePlayerTimer(room: Room) {
  const g = room.guessThePlayer;
  if (g?.timer) {
    clearTimeout(g.timer);
    g.timer = null;
  }
}

function startGuessThePlayerAskTimer(io: Server, room: Room) {
  const g = room.guessThePlayer;
  if (!g || g.phase !== "playing") return;
  clearGuessThePlayerTimer(room);
  g.turnEndsAt = Date.now() + GUESS_THE_PLAYER_ASK_SECONDS * 1000;
  g.timer = setTimeout(
    () => handleGuessThePlayerAskTimeout(io, room),
    GUESS_THE_PLAYER_ASK_SECONDS * 1000
  );
}

function startGuessThePlayerAnswerTimer(io: Server, room: Room) {
  const g = room.guessThePlayer;
  if (!g || g.phase !== "playing") return;
  clearGuessThePlayerTimer(room);
  g.turnEndsAt = Date.now() + GUESS_THE_PLAYER_ANSWER_SECONDS * 1000;
  g.timer = setTimeout(
    () => handleGuessThePlayerAnswerTimeout(io, room),
    GUESS_THE_PLAYER_ANSWER_SECONDS * 1000
  );
}

// The current asker didn't ask or guess in time — silently pass the turn,
// no penalty, and start the next asker's own ask window.
function handleGuessThePlayerAskTimeout(io: Server, room: Room) {
  const g = room.guessThePlayer;
  if (!g || g.phase !== "playing" || g.currentQuestion) return; // already acted / no longer relevant
  guessThePlayerAdvanceTurn(room);
  startGuessThePlayerAskTimer(io, room);
  broadcastGuessThePlayerState(io, room);
}

// Anyone on the opposing team who hasn't answered by the deadline is
// counted as "No" by default so the poll can resolve and the turn keeps
// moving instead of stalling on one silent player.
function handleGuessThePlayerAnswerTimeout(io: Server, room: Room) {
  const g = room.guessThePlayer;
  if (!g || g.phase !== "playing" || !g.currentQuestion) return;
  const required = guessThePlayerOpposingConnected(room, g.currentQuestion.askerTeam);
  for (const id of required) {
    if (g.currentQuestion.answers[id] === undefined) {
      g.currentQuestion.answers[id] = "no";
    }
  }
  g.questionHistory.push(g.currentQuestion);
  if (g.questionHistory.length > 30) g.questionHistory.shift();
  g.currentQuestion = null;
  guessThePlayerAdvanceTurn(room);
  startGuessThePlayerAskTimer(io, room);
  broadcastGuessThePlayerState(io, room);
}

function initGuessThePlayerGame(room: Room) {
  const order = Array.from(room.players.keys());
  const teamOf: Record<string, 1 | 2> = {};

  if (room.mode === "1v1") {
    // 1v1 never goes through the lobby team-picker — the two joiners are
    // simply each their own team of one.
    order.forEach((id, i) => {
      teamOf[id] = i === 0 ? 1 : 2;
    });
  } else {
    for (const id of order) {
      teamOf[id] = room.players.get(id)?.team ?? 1;
    }
  }

  room.guessThePlayer = {
    order,
    teamOf,
    proposedSecret: { 1: null, 2: null },
    agreedIds: new Set(),
    locked: { 1: false, 2: false },
    secrets: { 1: null, 2: null },
    phase: "picking",
    winnerTeam: null,
    winnerId: null,
    forfeited: false,
    questionOrder: [],
    askerIndex: 0,
    currentQuestion: null,
    questionHistory: [],
    turnEndsAt: null,
    timer: null,
  };
}

function publicGuessThePlayerState(room: Room) {
  const g = room.guessThePlayer;
  if (!g) return null;
  return {
    order: g.order,
    teamOf: g.teamOf,
    leaders: { 1: guessThePlayerLeader(room, 1), 2: guessThePlayerLeader(room, 2) },
    // The proposal text itself is only ever sent privately to the owning
    // team's socket.io room (see guessplayer:teamSecret) — never broadcast
    // room-wide, so the opposing team can never see it mid-negotiation.
    agreedIds: Array.from(g.agreedIds),
    locked: g.locked,
    phase: g.phase,
    winnerTeam: g.winnerTeam,
    winnerId: g.winnerId,
    forfeited: g.forfeited,
    // Full reveal only once the game is over.
    secrets: g.phase === "gameEnd" ? g.secrets : null,
    // Turn-based Q&A (Aziz's request) — only meaningful once "playing".
    // `guessThePlayerCurrentAsker` also normalizes `askerIndex` past any
    // disconnected player as a side effect, so read it fresh every time.
    currentAskerId: g.phase === "playing" ? guessThePlayerCurrentAsker(room) : null,
    currentQuestion: g.currentQuestion,
    questionHistory: g.questionHistory,
    // Per-turn countdown (Aziz's request) — null once the game isn't
    // actively waiting on anyone (picking/gameEnd).
    turnEndsAt: g.phase === "playing" ? g.turnEndsAt : null,
  };
}

function broadcastGuessThePlayerState(io: Server, room: Room) {
  io.to(room.code).emit("guessplayer:state", publicGuessThePlayerState(room));
}

function endGuessThePlayerGame(
  io: Server,
  room: Room,
  winnerTeam: 1 | 2 | null,
  winnerId: string | null,
  forfeited: boolean
) {
  const g = room.guessThePlayer;
  if (!g || g.phase === "gameEnd") return;
  clearGuessThePlayerTimer(room); // no more turns to time once the match is over
  g.turnEndsAt = null;
  g.phase = "gameEnd";
  g.winnerTeam = winnerTeam;
  g.winnerId = winnerId;
  g.forfeited = forfeited;
  broadcastGuessThePlayerState(io, room);
}

// Locks a team's secret in once every non-leader teammate has agreed to the
// CURRENT proposal (a team of 1, e.g. 1v1, needs zero agreements — the
// leader's own proposal is instantly final, exactly like the old 1v1 flow).
// Flips the whole game to "playing" once BOTH teams are locked.
function tryLockGuessThePlayerTeam(io: Server, room: Room, team: 1 | 2) {
  const g = room.guessThePlayer;
  if (!g || g.locked[team] || !g.proposedSecret[team]) return;

  const members = guessThePlayerTeamMembers(room, team).filter((id) => room.players.has(id));
  const leader = members[0];
  const required = Math.max(0, members.length - 1);
  const agreedCount = members.filter((id) => id !== leader && g.agreedIds.has(id)).length;

  if (agreedCount >= required) {
    g.secrets[team] = g.proposedSecret[team];
    g.locked[team] = true;
    if (g.locked[1] && g.locked[2]) {
      g.phase = "playing";
      // Set up the alternating-turn question order right as the duel
      // begins (Aziz's request) — team rosters are final at this point.
      g.questionOrder = buildGuessThePlayerQuestionOrder(room);
      g.askerIndex = 0;
      guessThePlayerCurrentAsker(room); // normalize in the unlikely event slot 0 is already disconnected
      // Kick off the first turn's timer (Aziz's request: every turn is timed).
      startGuessThePlayerAskTimer(io, room);
    }
  }
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
    (
      payload: { displayName: string; mode: RoomMode; token?: string },
      ack?: (res: unknown) => void
    ) => {
      const displayName = (payload?.displayName ?? "").trim().slice(0, 24) || "Player";
      const mode: RoomMode = VALID_ROOM_MODES.includes(payload?.mode) ? payload.mode : "ffa";
      // BUG FIX (live-problems.md): accept a client-generated reconnect token
      // if one was sent (it wasn't yet, for a brand-new tab), otherwise mint
      // one here so the client always has something to persist for later
      // room:rejoin calls.
      const token = (payload?.token ?? "").trim() || randomUUID();

      const code = generateRoomCode();
      const room: Room = {
        code,
        mode,
        gameId: null,
        hostId: socket.id,
        players: new Map([
          [socket.id, { socketId: socket.id, displayName, ready: false, isHost: true, connected: true, token }],
        ]),
        chat: [],
        teamChat: { 1: [], 2: [] },
        started: false,
        createdAt: Date.now(),
        pendingDisconnects: new Map(),
      };

      rooms.set(code, room);
      socketRoom.set(socket.id, code);
      socket.join(code);

      ack?.({ ok: true, code, token });
      broadcastRoomState(io, room);
    }
  );

  socket.on(
    "room:join",
    (
      payload: { code: string; displayName: string; token?: string },
      ack?: (res: unknown) => void
    ) => {
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
      const token = (payload?.token ?? "").trim() || randomUUID();
      room.players.set(socket.id, {
        socketId: socket.id,
        displayName,
        ready: false,
        isHost: false,
        connected: true,
        token,
      });
      socketRoom.set(socket.id, code);
      socket.join(code);

      ack?.({ ok: true, code, token });
      broadcastRoomState(io, room);
    }
  );

  // BUG FIX (live-problems.md — "No active room" on Guess The Player after
  // Start Game, live only): the room:started redirect was changed from
  // router.push to window.location.href (see that fix's own writeup) to
  // avoid resolving a route against a stale JS bundle after a deploy. A
  // real page load is correct for that problem, but it always disconnects
  // and reconnects the socket under a brand-new socket.id — and every game
  // engine here keys all of its state (turn order, teamOf, scores, secrets)
  // by socketId. Previously the server had no concept of "the same player
  // reconnecting" at all: a disconnect went straight to finalizeLeave,
  // which (for a 1v1 Guess The Player match, both tabs reloading near-
  // simultaneously) deleted the empty room outright before the new page
  // even finished loading — so the client's next `room:join`/sync had
  // nothing to attach to and rendered "No active room". room:rejoin lets a
  // reconnecting socket reclaim its OLD player identity (same token,
  // stored in sessionStorage so it's stable across a reload but distinct
  // per tab) within RECONNECT_GRACE_MS of disconnecting, swapping every
  // reference to the old socketId over to the new one via swapSocketId
  // instead of losing the seat entirely.
  socket.on(
    "room:rejoin",
    (payload: { code: string; token: string }, ack?: (res: unknown) => void) => {
      const code = (payload?.code ?? "").trim().toUpperCase();
      const token = (payload?.token ?? "").trim();
      const room = rooms.get(code);
      if (!room || !token) {
        ack?.({ ok: false, error: "Room not found." });
        return;
      }

      // BUG FIX (live-tested 2026-07-31 — real 1v1 "No active room" on
      // Start Game): this used to also require `!p.connected`, on the
      // assumption the old socket's `disconnect` event (which sets
      // `connected: false`) would always reach the server before the new
      // page's `room:rejoin` request did. That's a race, not a guarantee —
      // `window.location.href` tears down the old page and starts loading
      // the new one at roughly the same time, and a same-machine websocket
      // close can easily lose that race against the new page's own connect
      // + rejoin round trip. When it did, `!p.connected` was still true on
      // the old entry, nothing matched, and the player saw "No active
      // room" despite reconnecting within milliseconds. A token is unique
      // per browser tab (sessionStorage) and never shared, so matching on
      // it alone — regardless of the old entry's connected flag — is safe:
      // if the old socket really is still alive, swapSocketId below simply
      // hands its identity to the new one, and the old socket's eventual
      // (now-redundant) disconnect event will find nothing to clean up
      // since its id is removed from `socketRoom` as part of the swap.
      let oldSocketId: string | null = null;
      for (const [id, p] of room.players.entries()) {
        if (p.token === token) {
          oldSocketId = id;
          break;
        }
      }
      if (!oldSocketId || oldSocketId === socket.id) {
        ack?.({
          ok: false,
          error: "Could not reconnect — the room may have moved on without you.",
        });
        return;
      }

      const pending = room.pendingDisconnects.get(oldSocketId);
      if (pending) clearTimeout(pending.timer);
      room.pendingDisconnects.delete(oldSocketId);

      swapSocketId(room, oldSocketId, socket.id);

      ack?.({ ok: true, code: room.code });
      broadcastRoomState(io, room);
      if (room.chain) broadcastChainState(io, room);
      if (room.whoAmI) broadcastWhoAmIState(io, room);
      if (room.careerMaze) broadcastCareerMazeState(io, room);
      if (room.lastManStanding) broadcastLastManStandingState(io, room);
      if (room.guessThePlayer) {
        broadcastGuessThePlayerState(io, room);
        const myTeam = room.guessThePlayer.teamOf[socket.id];
        if (myTeam) {
          io.to(socket.id).emit("guessplayer:teamSecret", {
            name: room.guessThePlayer.proposedSecret[myTeam],
          });
        }
      }
      if (room.footballPyramid) broadcastFootballPyramidState(io, room);
      if (room.shirtMadness) broadcastShirtMadnessState(io, room);
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
    if (!VALID_ROOM_MODES.includes(payload?.mode)) return;
    room.mode = payload.mode;
    // Changing modes invalidates any prior team assignments (a switch from
    // 5v5 to 2v2, say, could leave stale teams that no longer make sense,
    // and a switch away from a team mode entirely should clear them too).
    for (const p of room.players.values()) {
      p.team = undefined;
      const s = io.sockets.sockets.get(p.socketId);
      s?.leave(teamRoomName(room.code, 1));
      s?.leave(teamRoomName(room.code, 2));
    }
    room.teamChat = { 1: [], 2: [] };
    broadcastRoomState(io, room);
  });

  // Self-select (or, if you're the host, assign someone else) onto Team 1
  // or Team 2 ahead of a team-mode match. Shared infrastructure — not
  // specific to Guess The Player, so any future team-based game can reuse
  // it. A no-op outside team modes (1v1 doesn't need it, ffa has no teams).
  socket.on("room:assignTeam", (payload: { team: 1 | 2; playerId?: string }) => {
    const room = roomForSocket(socket.id);
    if (!room || room.started) return;
    if (!TEAM_MODES.includes(room.mode)) return;
    if (payload?.team !== 1 && payload?.team !== 2) return;

    const targetId = payload?.playerId && room.hostId === socket.id ? payload.playerId : socket.id;
    const target = room.players.get(targetId);
    if (!target) return;

    // A team can hold at most half the mode's capacity (e.g. 5 each in 5v5).
    const perTeamCap = capacityForMode(room.mode) / 2;
    const currentOnTeam = Array.from(room.players.values()).filter(
      (p) => p.team === payload.team && p.socketId !== targetId
    ).length;
    if (currentOnTeam >= perTeamCap) return;

    target.team = payload.team;

    // Guess The Player's `guessplayer:pick`/team-chat broadcasts target the
    // Socket.IO room `teamRoomName(code, team)` directly, so the socket
    // actually needs to be a member of it (and only it) for that to reach
    // the right people and nobody else.
    const targetSocket = io.sockets.sockets.get(targetId);
    targetSocket?.leave(teamRoomName(room.code, 1));
    targetSocket?.leave(teamRoomName(room.code, 2));
    targetSocket?.join(teamRoomName(room.code, payload.team));

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
    if (room.gameId === "guess-the-player" && !TEAM_MODES.includes(room.mode)) {
      ack?.({ ok: false, error: "Guess The Player needs a team mode (1v1 through 10v10)." });
      return;
    }
    if (room.gameId === "guess-the-player" && room.mode !== "1v1") {
      // 2v2+ requires every player to have picked a side, and both sides
      // to be non-empty, before a leader/teammate pick negotiation can
      // possibly make sense.
      const players = Array.from(room.players.values());
      const unassigned = players.filter((p) => p.team !== 1 && p.team !== 2);
      if (unassigned.length > 0) {
        ack?.({ ok: false, error: "Everyone needs to join Team 1 or Team 2 first." });
        return;
      }
      const team1Count = players.filter((p) => p.team === 1).length;
      const team2Count = players.filter((p) => p.team === 2).length;
      if (team1Count === 0 || team2Count === 0) {
        ack?.({ ok: false, error: "Both teams need at least one player." });
        return;
      }
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

  // Private per-team lobby chat, used ahead of Guess The Player's 2v2+
  // matches so a team can talk through who to pick without the opposing
  // team ever seeing it. Delivered only to `teamRoomName(code, team)` —
  // never the room-wide `chat:message` channel.
  socket.on("teamchat:sync", (ack?: (res: unknown) => void) => {
    const room = roomForSocket(socket.id);
    const player = room?.players.get(socket.id);
    const team = player?.team;
    ack?.(room && team ? room.teamChat[team] : []);
  });

  socket.on("teamchat:message", (payload: { text: string }) => {
    const room = roomForSocket(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player || !player.team) return;
    if (!TEAM_MODES.includes(room.mode)) return;

    const text = (payload?.text ?? "").trim().slice(0, 280);
    if (!text) return;

    const message: ChatMessage = {
      id: `${socket.id}-${Date.now()}`,
      from: player.displayName,
      text,
      ts: Date.now(),
    };
    const team = player.team;
    room.teamChat[team].push(message);
    if (room.teamChat[team].length > MAX_CHAT_HISTORY) room.teamChat[team].shift();

    io.to(teamRoomName(room.code, team)).emit("teamchat:message", message);
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
    // Re-send the caller's team's current proposal too, in case they
    // reconnected mid-match (private state a room-wide broadcast never
    // carries, so a fresh `room:state` alone wouldn't restore it).
    const g = room?.guessThePlayer;
    const myTeam = g?.teamOf[socket.id];
    if (g && myTeam) {
      io.to(socket.id).emit("guessplayer:teamSecret", { name: g.proposedSecret[myTeam] });
    }
  });

  // Propose a candidate for MY team. Only the team leader may call this —
  // for a team of 1 (1v1) that's instant and final, exactly like the old
  // 1v1 flow; for N>=2 it's a proposal teammates must agree to.
  socket.on("guessplayer:pick", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const g = room?.guessThePlayer;
    if (!room || !g || g.phase !== "picking") return;

    const myTeam = g.teamOf[socket.id];
    if (!myTeam || g.locked[myTeam]) return;
    if (guessThePlayerLeader(room, myTeam) !== socket.id) return;

    const raw = (payload?.name ?? "").trim();
    if (!isValidPick(raw)) return;

    g.proposedSecret[myTeam] = raw;
    // A fresh proposal invalidates any agreements teammates gave the old one.
    for (const id of Array.from(g.agreedIds)) {
      if (g.teamOf[id] === myTeam) g.agreedIds.delete(id);
    }

    io.to(teamRoomName(room.code, myTeam)).emit("guessplayer:teamSecret", { name: raw });

    tryLockGuessThePlayerTeam(io, room, myTeam);
    broadcastGuessThePlayerState(io, room);
  });

  // A non-leader teammate agreeing to their team's CURRENT proposal.
  socket.on("guessplayer:agree", () => {
    const room = roomForSocket(socket.id);
    const g = room?.guessThePlayer;
    if (!room || !g || g.phase !== "picking") return;

    const myTeam = g.teamOf[socket.id];
    if (!myTeam || g.locked[myTeam]) return;
    if (guessThePlayerLeader(room, myTeam) === socket.id) return; // leader auto-agrees by proposing
    if (!g.proposedSecret[myTeam]) return; // nothing proposed yet

    g.agreedIds.add(socket.id);
    tryLockGuessThePlayerTeam(io, room, myTeam);
    broadcastGuessThePlayerState(io, room);
  });

  // FEATURE UPDATE (Aziz's request): guessing is no longer free-for-all —
  // it is now the current asker's EXCLUSIVE alternative to asking a
  // question, gated by the exact same turn as `guessplayer:askQuestion`.
  // Only the current asker may call this, and only when no question is
  // currently pending (i.e. they haven't already used this turn to ask).
  // A correct guess wins the game immediately, same as before. A miss now
  // consumes the turn — it advances to the next asker exactly as a fully-
  // answered question would, instead of leaving turn state untouched.
  socket.on("guessplayer:guess", (payload: { name: string }) => {
    const room = roomForSocket(socket.id);
    const g = room?.guessThePlayer;
    if (!room || !g || g.phase !== "playing") return;
    if (g.currentQuestion) return; // this turn's already been spent asking a pending question
    if (guessThePlayerCurrentAsker(room) !== socket.id) return; // only the current asker may guess, and only on their turn

    const myTeam = g.teamOf[socket.id];
    if (!myTeam) return;
    const opponentTeam: 1 | 2 = myTeam === 1 ? 2 : 1;
    const opponentSecret = g.secrets[opponentTeam];
    if (!opponentSecret) return;

    const raw = (payload?.name ?? "").trim();
    if (!raw) return;

    io.to(room.code).emit("guessplayer:guessMade", {
      playerId: socket.id,
      displayName: room.players.get(socket.id)?.displayName ?? "Player",
      guess: raw,
    });

    if (namesMatch(raw, opponentSecret)) {
      endGuessThePlayerGame(io, room, myTeam, socket.id, false);
    } else {
      // A miss still uses up the turn, same as a question that's been
      // fully answered — pass the turn to the next player in the order,
      // and give them a fresh ask window (Aziz's request: every turn is
      // timed).
      guessThePlayerAdvanceTurn(room);
      startGuessThePlayerAskTimer(io, room);
      broadcastGuessThePlayerState(io, room);
    }
  });

  // Ask a question — only the current asker may call this, and only when
  // no question is currently pending an answer (Aziz's request: strict
  // turn order, one question resolved at a time before the next is asked).
  socket.on("guessplayer:askQuestion", (payload: { text: string }) => {
    const room = roomForSocket(socket.id);
    const g = room?.guessThePlayer;
    if (!room || !g || g.phase !== "playing") return;
    if (g.currentQuestion) return; // a question is already pending an answer
    if (guessThePlayerCurrentAsker(room) !== socket.id) return; // not your turn

    const text = (payload?.text ?? "").trim().slice(0, 300);
    if (!text) return;

    g.currentQuestion = {
      id: `${Date.now()}-${socket.id}`,
      askerId: socket.id,
      askerTeam: g.teamOf[socket.id],
      text,
      answers: {},
    };

    // Question asked — switch from the asker's own ask-window deadline to
    // the opposing team's answer-window deadline (Aziz's request: every
    // turn is timed, including waiting on an answer).
    startGuessThePlayerAnswerTimer(io, room);

    // Covers the edge case where the opposing team has nobody currently
    // connected — resolves (and advances the turn) immediately instead of
    // leaving the question stuck forever waiting on an empty answer set.
    guessThePlayerMaybeResolveQuestion(io, room);
    broadcastGuessThePlayerState(io, room);
  });

  // Answer the pending question with a Yes/No tap — only a currently-
  // connected member of the OPPOSING team may answer, once each. Answers
  // are revealed live in the broadcast state as they come in (the "poll"),
  // not held back until everyone's answered.
  socket.on("guessplayer:answerQuestion", (payload: { answer: "yes" | "no" }) => {
    const room = roomForSocket(socket.id);
    const g = room?.guessThePlayer;
    if (!room || !g || g.phase !== "playing" || !g.currentQuestion) return;

    const myTeam = g.teamOf[socket.id];
    if (!myTeam || myTeam === g.currentQuestion.askerTeam) return; // only the opposing team answers
    if (g.currentQuestion.answers[socket.id]) return; // already answered this question

    const answer = payload?.answer;
    if (answer !== "yes" && answer !== "no") return;

    g.currentQuestion.answers[socket.id] = answer;
    guessThePlayerMaybeResolveQuestion(io, room);
    broadcastGuessThePlayerState(io, room);
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

  socket.on("room:leave", () => finalizeLeave(socket.id));
  // BUG FIX (live-problems.md): an explicit "Leave" click means it forever
  // — that still goes straight to finalizeLeave, no grace. A bare
  // `disconnect` (page reload, tab close, brief network blip — the server
  // can't tell which) gets a grace window first, since a reload is exactly
  // what room:started's window.location.href redirect intentionally causes.
  socket.on("disconnect", () => scheduleGracefulLeave(socket.id));
});

// BUG FIX (live-problems.md): starts the reconnect grace window for a
// disconnected socket instead of removing them immediately. The player
// stays in `room.players` (just `connected: false`) so every existing
// "are they still here" check across the game engines keeps working
// unchanged during the grace window; only if nobody claims their token via
// room:rejoin before RECONNECT_GRACE_MS elapses does finalizeLeave actually
// run.
function scheduleGracefulLeave(socketId: string) {
  const room = roomForSocket(socketId);
  if (!room) return;
  const player = room.players.get(socketId);
  if (!player) return;

  player.connected = false;
  broadcastRoomState(io, room);

  const timer = setTimeout(() => {
    room.pendingDisconnects.delete(socketId);
    finalizeLeave(socketId);
  }, RECONNECT_GRACE_MS);
  room.pendingDisconnects.set(socketId, { token: player.token, timer });
}

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

// BUG FIX (live-problems.md): renamed from handleLeave — this now runs
// either immediately (explicit room:leave) or after a disconnected socket's
// RECONNECT_GRACE_MS window expires without a matching room:rejoin
// (scheduleGracefulLeave). Takes a plain socketId since by the time the
// grace timer fires, the original Socket object may be long gone.
function finalizeLeave(socketId: string) {
  const room = roomForSocket(socketId);
  if (!room) return;

  room.players.delete(socketId);
  socketRoom.delete(socketId);
  const s = io.sockets.sockets.get(socketId);
  s?.leave(room.code);
  s?.leave(teamRoomName(room.code, 1));
  s?.leave(teamRoomName(room.code, 2));

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
  if (room.chain && !room.chain.winnerId && !room.chain.eliminated.has(socketId)) {
    eliminateChainPlayer(io, room, socketId);
  }

  // Mid-match disconnect during Last Man Standing: mark eliminated so they
  // stop counting toward "everyone answered", and resolve/end as needed.
  if (room.lastManStanding && room.lastManStanding.phase !== "gameEnd") {
    const l = room.lastManStanding;
    l.eliminated.add(socketId);
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

  // Mid-match disconnect during Guess The Player. 1v1: the other player
  // leaving ends the duel outright by forfeit, exactly as before. Team
  // modes (2v2+): only forfeit if a WHOLE team is now empty of connected
  // players — a single teammate leaving a bigger team shouldn't end the
  // match for the rest of their side. If a team goes empty mid-"picking"
  // (before a secret ever locked in), there's no opponent to forfeit
  // to/from in any meaningful sense either, so just end with no winner.
  if (room.guessThePlayer && room.guessThePlayer.phase !== "gameEnd") {
    const g = room.guessThePlayer;
    const team1Left = guessThePlayerTeamMembers(room, 1).some((id) => room.players.has(id));
    const team2Left = guessThePlayerTeamMembers(room, 2).some((id) => room.players.has(id));
    if (!team1Left && !team2Left) {
      endGuessThePlayerGame(io, room, null, null, true);
    } else if (!team1Left) {
      endGuessThePlayerGame(io, room, 2, guessThePlayerLeader(room, 2), true);
    } else if (!team2Left) {
      endGuessThePlayerGame(io, room, 1, guessThePlayerLeader(room, 1), true);
    } else if (g.phase === "picking") {
      // Both teams still have players — the leader who just left may have
      // been mid-proposal; re-run the lock check in case the departure
      // changes who's required to agree (e.g. the required-agreement count
      // just dropped because the team is smaller now).
      tryLockGuessThePlayerTeam(io, room, 1);
      tryLockGuessThePlayerTeam(io, room, 2);
      broadcastGuessThePlayerState(io, room);
    } else if (g.phase === "playing") {
      // Both teams still have players. If a question was pending and the
      // departing player was one of the required answerers, the required
      // set just shrank — check whether that's enough to resolve it now.
      // Either way, re-resolve the current asker so a departing asker's
      // turn is silently handed to the next connected player rather than
      // stalling the game (Aziz's request: turns must keep moving).
      const askerBefore = guessThePlayerCurrentAsker(room);
      if (g.currentQuestion) guessThePlayerMaybeResolveQuestion(io, room);
      const askerAfter = guessThePlayerCurrentAsker(room);
      // If the asker changed (departing player was the asker, or was a
      // required answerer whose departure just resolved the question),
      // give the new asker a fresh ask window rather than leaving the old
      // deadline (which may already be an answer-window timer) running.
      if (askerAfter !== askerBefore || (!g.currentQuestion && g.turnEndsAt === null)) {
        startGuessThePlayerAskTimer(io, room);
      }
      broadcastGuessThePlayerState(io, room);
    }
  }

  // Host left — hand off to whoever's been in the room longest.
  if (room.hostId === socketId) {
    const next = Array.from(room.players.values())[0];
    room.hostId = next.socketId;
    next.isHost = true;
  }

  broadcastRoomState(io, room);
}

httpServer.listen(PORT, () => {
  console.log(`[socket] Football Minds room server listening on :${PORT}`);
});
