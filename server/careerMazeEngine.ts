/**
 * Career Maze — game engine, PROJECT_SPEC.md §5 "Career Maze".
 *
 * "Random player's full club history shown immediately as a large animated
 * vertical timeline. Timer starts on reveal. Fastest correct guess wins."
 *
 * Same dataset as The Chain / Who Am I? (server/data/players.json) — see
 * PROGRESS.md for why this is a curated ~famous-player list and not the
 * production Football Knowledge Database from foot_database.md yet.
 */

import { loadPlayers, resolvePlayer, type ChainPlayer, type CareerStint } from "./chainEngine";

export type CareerMazePlayer = ChainPlayer;

export interface TimelineStop {
  club: string;
  startYear: number;
  endYear: number;
}

/** Full career timeline, oldest club first — this is what's shown to guessers, never the name. */
export function buildTimeline(p: CareerMazePlayer): TimelineStop[] {
  return [...p.careers]
    .sort((a: CareerStint, b: CareerStint) => a.startYear - b.startYear)
    .map((c) => ({ club: c.club, startYear: c.startYear, endYear: c.endYear }));
}

/**
 * Random player with a real, multi-stop career — a 1-club timeline gives
 * almost no puzzle, so Career Maze specifically favours well-travelled
 * players (mirrors chainEngine's randomStartingPlayer bias for the same
 * reason).
 */
export function randomCareerMazeTarget(excludeNames: Set<string>): CareerMazePlayer | null {
  const players = loadPlayers();
  const eligible = players.filter((p) => !excludeNames.has(p.name) && p.careers.length >= 2);
  const pool = eligible.length > 0 ? eligible : players.filter((p) => !excludeNames.has(p.name));
  const source = pool.length > 0 ? pool : players; // dataset exhausted — allow repeats rather than crash
  return source[Math.floor(Math.random() * source.length)] ?? null;
}

export function isCorrectCareerMazeGuess(target: CareerMazePlayer, guess: string): boolean {
  const resolved = resolvePlayer(guess);
  return resolved !== null && resolved.name === target.name;
}
