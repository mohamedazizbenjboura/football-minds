/**
 * Shirt Number Madness — game engine, PROJECT_SPEC.md §5 "Shirt Number Madness".
 *
 * "A legendary number is announced (e.g. 'Number 7'). Everyone types one
 * player who's worn it. Duplicate answers score zero; unique answers score
 * points. Category pool covers numbers 1, 9, 10, 11, underrated 8, captain's
 * 5, etc."
 *
 * Same dataset as every other game so far (server/data/players.json) — see
 * PROGRESS.md for why this is a curated ~famous-player list and not the
 * production Football Knowledge Database from foot_database.md yet. One
 * consequence specific to this game: the real spec (foot_database.md §16
 * "Shirt Numbers") tracks a *history* of numbers per player per club per
 * season (players change numbers across their career — Ronaldo wore 7 at
 * United and Real Madrid, but different numbers elsewhere). That table isn't
 * wired up yet, so this engine uses each player's single current/best-known
 * `shirtNumber` field on server/data/players.json instead — a real
 * simplification, not a bug, and one line to swap once player_numbers exists.
 *
 * Unlike Last Man Standing (which this game's "everyone answers
 * simultaneously, duplicates get punished" shape most resembles), a
 * duplicate here scores zero rather than eliminating — nobody is ever
 * knocked out of Shirt Number Madness, it's a pure scoring game across
 * several rounds, matching the spec's wording exactly ("duplicate answers
 * score zero; unique answers score points", no mention of elimination).
 */

import { loadPlayers, resolvePlayer, type ChainPlayer } from "./chainEngine";

export type ShirtMadnessPlayer = ChainPlayer;

// A number needs enough distinct real players wearing it in our dataset for
// a round to have actual variety (too few and everyone collides on the same
// 1-2 names, making every round a guaranteed zero-score wash).
const MIN_QUALIFYING_PLAYERS = 3;

let _numberPool: number[] | null = null;

function buildNumberPool(): number[] {
  const players = loadPlayers();
  const counts = new Map<number, number>();
  for (const p of players) {
    counts.set(p.shirtNumber, (counts.get(p.shirtNumber) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= MIN_QUALIFYING_PLAYERS)
    .map(([number]) => number)
    .sort((a, b) => a - b);
}

function numberPool(): number[] {
  if (!_numberPool) _numberPool = buildNumberPool();
  return _numberPool;
}

/** Random shirt number not already used this match, so a session doesn't repeat one. */
export function randomShirtNumber(usedNumbers: Set<number>): number | null {
  const pool = numberPool();
  const eligible = pool.filter((n) => !usedNumbers.has(n));
  const source = eligible.length > 0 ? eligible : pool; // pool exhausted — allow repeats rather than crash
  if (source.length === 0) return null;
  return source[Math.floor(Math.random() * source.length)];
}

export type ShirtMadnessVerdict =
  | { ok: true; player: ShirtMadnessPlayer }
  | { ok: false; reason: "no-answer" | "not-found" | "wrong-number" };

/** Resolve a raw submitted answer against the round's announced number. */
export function verifyShirtAnswer(number: number, raw: string | null): ShirtMadnessVerdict {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, reason: "no-answer" };

  const player = resolvePlayer(text);
  if (!player) return { ok: false, reason: "not-found" };
  if (player.shirtNumber !== number) return { ok: false, reason: "wrong-number" };

  return { ok: true, player };
}
