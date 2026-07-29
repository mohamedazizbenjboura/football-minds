/**
 * Who Am I? — game engine, PROJECT_SPEC.md §5 "Who Am I?".
 *
 * Same dataset as The Chain (server/data/players.json) — see PROGRESS.md
 * for why this is a curated ~famous-player list and not the production
 * Football Knowledge Database from foot_database.md yet.
 *
 * One deviation from the spec's exact clue order is noted where it happens
 * below: the spec's schedule is Nationality → Age → Position → League →
 * Current Club → Former Club → Strong Foot → Trophies, but the current
 * dataset has no `league` field per player (foot_database.md §11 "Leagues"
 * isn't wired up — clubs are just strings on career stints, not linked to a
 * league record). Continent is substituted in that slot so the clue count
 * and pacing still match the spec; this should be swapped back to a real
 * League clue once `leagues`/`clubs.league_id` exist.
 */

import { loadPlayers, resolvePlayer, type ChainPlayer } from "./chainEngine";

const CURRENT_YEAR = 2026;

export type WhoAmIPlayer = ChainPlayer;

const POSITION_LABEL: Record<string, string> = {
  GK: "Goalkeeper",
  DF: "Defender",
  MF: "Midfielder",
  FW: "Forward",
};

export interface WhoAmIClue {
  label: string;
  value: string;
}

/** Fixed schedule length — also drives scoring (earlier guess = more clues left unseen = more points). */
export const WHO_AM_I_CLUE_COUNT = 8;

export function buildClues(p: WhoAmIPlayer): WhoAmIClue[] {
  const sortedCareers = [...p.careers].sort((a, b) => a.startYear - b.startYear);
  const currentClub = sortedCareers[sortedCareers.length - 1]?.club ?? "Unknown";
  const formerClub =
    sortedCareers.length > 1 ? sortedCareers[0].club : "Only one club on record";

  const trophies: string[] = [];
  if (p.worldCupWinner) trophies.push("World Cup winner");
  if (p.championsLeagueWinner) trophies.push("Champions League winner");
  const trophyValue = trophies.length > 0 ? trophies.join(", ") : "No major title in our data";

  return [
    { label: "Nationality", value: p.nationality },
    { label: "Age", value: String(CURRENT_YEAR - p.birthYear) },
    { label: "Position", value: POSITION_LABEL[p.position] ?? p.position },
    // Substitutes for "League" — see file header note.
    { label: "Continent", value: p.continent },
    { label: "Current / Most Recent Club", value: currentClub },
    { label: "Former Club", value: formerClub },
    { label: "Strong Foot", value: p.foot === "BOTH" ? "Two-footed" : p.foot === "LEFT" ? "Left" : "Right" },
    { label: "Trophies", value: trophyValue },
  ];
}

/** Random player not already used this match, so a session doesn't repeat a target. */
export function randomWhoAmITarget(excludeNames: Set<string>): WhoAmIPlayer | null {
  const players = loadPlayers();
  const pool = players.filter((p) => !excludeNames.has(p.name));
  const source = pool.length > 0 ? pool : players; // if we somehow exhaust the dataset, allow repeats rather than crash
  return source[Math.floor(Math.random() * source.length)] ?? null;
}

export function isCorrectWhoAmIGuess(target: WhoAmIPlayer, guess: string): boolean {
  const resolved = resolvePlayer(guess);
  return resolved !== null && resolved.name === target.name;
}
