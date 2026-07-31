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

/**
 * `icon` tells the client how to visually render a clue "pack" (added for
 * Aziz's FIFA-unboxing-style redesign): a real flag image for nationality,
 * a real club crest for club clues, a status pill for active/retired, a
 * position badge, a trophy glyph, or plain text for everything else. The
 * server never renders anything itself — this is just a hint consumed by
 * <WhoAmIClueCard/> on the client.
 */
export type WhoAmIClueIcon = "flag" | "club" | "status" | "position" | "trophy" | "text";

export interface WhoAmIClue {
  label: string;
  value: string;
  icon: WhoAmIClueIcon;
}

/**
 * Round-count is now a host-picked lobby option (10/15/20 — Aziz's request),
 * not a fixed constant. 10 remains the default.
 */
export const WHO_AM_I_ROUND_OPTIONS = [10, 15, 20] as const;
export type WhoAmIRoundOption = (typeof WHO_AM_I_ROUND_OPTIONS)[number];
export const WHO_AM_I_ROUNDS_DEFAULT: WhoAmIRoundOption = 10;

export function isValidWhoAmIRounds(n: unknown): n is WhoAmIRoundOption {
  return typeof n === "number" && (WHO_AM_I_ROUND_OPTIONS as readonly number[]).includes(n);
}

/**
 * The player's current/most-recent club — pulled out as its own export so
 * server/index.ts can put it on the round-end reveal card without
 * duplicating this sort-and-pick logic.
 */
export function currentClubOf(p: WhoAmIPlayer): string {
  const sortedCareers = [...p.careers].sort((a, b) => a.startYear - b.startYear);
  return sortedCareers[sortedCareers.length - 1]?.club ?? "Unknown";
}

/** Fixed schedule length — also drives scoring (earlier guess = more clues left unseen = more points). */
export const WHO_AM_I_CLUE_COUNT = 9;

export function buildClues(p: WhoAmIPlayer): WhoAmIClue[] {
  const sortedCareers = [...p.careers].sort((a, b) => a.startYear - b.startYear);
  const currentClub = currentClubOf(p);
  const formerClub =
    sortedCareers.length > 1 ? sortedCareers[0].club : "Only one club on record";

  const trophies: string[] = [];
  if (p.worldCupWinner) trophies.push("World Cup winner");
  if (p.championsLeagueWinner) trophies.push("Champions League winner");
  const trophyValue = trophies.length > 0 ? trophies.join(", ") : "No major title in our data";

  return [
    { label: "Nationality", value: p.nationality, icon: "flag" },
    // Aziz's request: say plainly whether the player is still playing or retired.
    { label: "Status", value: p.retired ? "Retired" : "Active", icon: "status" },
    { label: "Age", value: String(CURRENT_YEAR - p.birthYear), icon: "text" },
    { label: "Position", value: POSITION_LABEL[p.position] ?? p.position, icon: "position" },
    // Substitutes for "League" — see file header note.
    { label: "Continent", value: p.continent, icon: "text" },
    { label: "Current / Most Recent Club", value: currentClub, icon: "club" },
    { label: "Former Club", value: formerClub, icon: formerClub === "Only one club on record" ? "text" : "club" },
    { label: "Strong Foot", value: p.foot === "BOTH" ? "Two-footed" : p.foot === "LEFT" ? "Left" : "Right", icon: "text" },
    { label: "Trophies", value: trophyValue, icon: "trophy" },
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
