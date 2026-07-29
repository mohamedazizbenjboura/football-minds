/**
 * Football Pyramid — game engine, PROJECT_SPEC.md §5 "Football Pyramid".
 *
 * "Progressive reveal: Nationality → Position → League → Current Club →
 * Strong Foot → Height → Age → Number → Former Club → Awards. Guess
 * anytime; earlier correct guesses score more."
 *
 * Same dataset as The Chain / Who Am I? / Career Maze / Last Man Standing
 * (server/data/players.json) — see PROGRESS.md for why this is a curated
 * ~famous-player list and not the production Football Knowledge Database
 * from foot_database.md yet. Three fields the spec's clue order calls for
 * don't exist in that dataset (`league`, `height_cm`, shirt `number` —
 * foot_database.md §11/§16 aren't wired up), so this engine documents and
 * substitutes for each, same pattern as whoAmIEngine.ts:
 *   - League      → Continent (identical substitute to Who Am I?, for the
 *                    same reason: no league_id per player yet)
 *   - Height       → merged with Number into one "Years As A Pro" clue,
 *                    computed from the real career span already in the
 *                    dataset, rather than inventing a fake height/number
 *   - Number       → merged into "Years As A Pro" (see above)
 *   - Awards       → "Trophies" (same wording/data source as Who Am I?'s
 *                    trophies clue: World Cup / Champions League booleans)
 * Swap these back to the real fields once leagues, physical attributes, and
 * shirt-number history exist in the production database.
 *
 * Unlike Who Am I? (first correct guess wins the round and ends it), this
 * game is explicitly "guess anytime" for *every* player — each player can
 * score once per round, the moment they guess correctly, and the round
 * keeps running for everyone else until all clues are shown (+ grace) or
 * everyone still playing has already solved it. This file only builds
 * clues/targets/verifies guesses; the per-round lifecycle (multi-solver
 * scoring, timers) lives in server/index.ts, same split as every other game.
 */

import { loadPlayers, resolvePlayer, type ChainPlayer } from "./chainEngine";

const CURRENT_YEAR = 2026;

export type FootballPyramidPlayer = ChainPlayer;

const POSITION_LABEL: Record<string, string> = {
  GK: "Goalkeeper",
  DF: "Defender",
  MF: "Midfielder",
  FW: "Forward",
};

export interface FootballPyramidClue {
  label: string;
  value: string;
}

/** Fixed schedule length — also drives scoring (earlier guess = more clues left unseen = more points). */
export const FOOTBALL_PYRAMID_CLUE_COUNT = 9;

export function buildClues(p: FootballPyramidPlayer): FootballPyramidClue[] {
  const sortedCareers = [...p.careers].sort((a, b) => a.startYear - b.startYear);
  const currentClub = sortedCareers[sortedCareers.length - 1]?.club ?? "Unknown";
  const formerClub =
    sortedCareers.length > 1 ? sortedCareers[0].club : "Only one club on record";
  const firstProYear = sortedCareers[0]?.startYear ?? p.birthYear + 18;
  const yearsAsPro = Math.max(CURRENT_YEAR - firstProYear, 0);

  const trophies: string[] = [];
  if (p.worldCupWinner) trophies.push("World Cup winner");
  if (p.championsLeagueWinner) trophies.push("Champions League winner");
  const trophyValue = trophies.length > 0 ? trophies.join(", ") : "No major title in our data";

  return [
    { label: "Nationality", value: p.nationality },
    { label: "Position", value: POSITION_LABEL[p.position] ?? p.position },
    // Substitute for "League" — see file header note.
    { label: "Continent", value: p.continent },
    { label: "Current / Most Recent Club", value: currentClub },
    { label: "Strong Foot", value: p.foot === "BOTH" ? "Two-footed" : p.foot === "LEFT" ? "Left" : "Right" },
    // Substitute merging "Height" + "Number" — see file header note.
    { label: "Years As A Pro", value: `${yearsAsPro}` },
    { label: "Age", value: String(CURRENT_YEAR - p.birthYear) },
    { label: "Former Club", value: formerClub },
    // Substitute for "Awards" — see file header note.
    { label: "Trophies", value: trophyValue },
  ];
}

/** Random player not already used this match, so a session doesn't repeat a target. */
export function randomFootballPyramidTarget(excludeNames: Set<string>): FootballPyramidPlayer | null {
  const players = loadPlayers();
  const pool = players.filter((p) => !excludeNames.has(p.name));
  const source = pool.length > 0 ? pool : players; // dataset exhausted — allow repeats rather than crash
  return source[Math.floor(Math.random() * source.length)] ?? null;
}

export function isCorrectFootballPyramidGuess(target: FootballPyramidPlayer, guess: string): boolean {
  const resolved = resolvePlayer(guess);
  return resolved !== null && resolved.name === target.name;
}
