/**
 * Last Man Standing — game engine, PROJECT_SPEC.md §5 "Last Man Standing".
 *
 * "Prompt like 'Name a player who played for Chelsea.' Everyone answers
 * simultaneously; duplicate answers eliminate everyone who wrote them,
 * unique answers survive. Repeats until one player remains. Prompts pulled
 * from a category pool (club, nationality+position combos, league, honors,
 * captaincy, etc.)."
 *
 * Same dataset as The Chain / Who Am I? / Career Maze (server/data/players.json)
 * — see PROGRESS.md for why this is a curated ~famous-player list and not the
 * production Football Knowledge Database from foot_database.md yet. One
 * consequence noted there applies here too: prompt categories are built
 * dynamically off this dataset (clubs/nationalities that actually appear in
 * it), not off foot_database.md's full leagues/honors/captaincy tables,
 * since those aren't wired up yet. League and captaincy-specific prompts
 * from the spec's example list aren't possible until §11 (Leagues) and a
 * captaincy field exist — swap those in once the real database lands.
 */

import { loadPlayers, resolvePlayer, type ChainPlayer } from "./chainEngine";

export type LastManStandingPlayer = ChainPlayer;

export interface LastManStandingPrompt {
  id: string;
  text: string;
  /** Whether a resolved player satisfies this prompt's category. */
  test: (p: LastManStandingPlayer) => boolean;
}

const POSITION_LABEL: Record<string, string> = {
  GK: "goalkeeper",
  DF: "defender",
  MF: "midfielder",
  FW: "forward",
};

// A category needs enough distinct qualifying players for the round to be
// an actual puzzle (too few and everyone's forced onto the same 1-2 names,
// which makes "duplicate eliminates everyone" feel unfair rather than fun).
const MIN_QUALIFYING_PLAYERS = 4;

let _pool: LastManStandingPrompt[] | null = null;

function buildPromptPool(): LastManStandingPrompt[] {
  const players = loadPlayers();
  const prompts: LastManStandingPrompt[] = [];

  // --- Club prompts ---------------------------------------------------
  const clubCounts = new Map<string, number>();
  for (const p of players) {
    const clubs = new Set(p.careers.map((c) => c.club));
    for (const club of clubs) clubCounts.set(club, (clubCounts.get(club) ?? 0) + 1);
  }
  for (const [club, count] of clubCounts.entries()) {
    if (count < MIN_QUALIFYING_PLAYERS) continue;
    prompts.push({
      id: `club:${club}`,
      text: `Name a player who played for ${club}.`,
      test: (p) => p.careers.some((c) => c.club === club),
    });
  }

  // --- Nationality prompts ---------------------------------------------
  const natCounts = new Map<string, number>();
  for (const p of players) natCounts.set(p.nationality, (natCounts.get(p.nationality) ?? 0) + 1);
  for (const [nat, count] of natCounts.entries()) {
    if (count < MIN_QUALIFYING_PLAYERS) continue;
    prompts.push({
      id: `nat:${nat}`,
      text: `Name a player from ${nat}.`,
      test: (p) => p.nationality === nat,
    });
  }

  // --- Continent prompts -------------------------------------------------
  const continentCounts = new Map<string, number>();
  for (const p of players) continentCounts.set(p.continent, (continentCounts.get(p.continent) ?? 0) + 1);
  for (const [continent, count] of continentCounts.entries()) {
    if (count < MIN_QUALIFYING_PLAYERS) continue;
    prompts.push({
      id: `continent:${continent}`,
      text: `Name a player from ${continent}.`,
      test: (p) => p.continent === continent,
    });
  }

  // --- Position prompts ---------------------------------------------------
  const posCounts = new Map<string, number>();
  for (const p of players) posCounts.set(p.position, (posCounts.get(p.position) ?? 0) + 1);
  for (const [pos, count] of posCounts.entries()) {
    if (count < MIN_QUALIFYING_PLAYERS) continue;
    const label = POSITION_LABEL[pos] ?? pos.toLowerCase();
    prompts.push({
      id: `pos:${pos}`,
      text: `Name a ${label}.`,
      test: (p) => p.position === pos,
    });
  }

  // --- Preferred foot -------------------------------------------------
  for (const foot of ["LEFT", "RIGHT"] as const) {
    const count = players.filter((p) => p.foot === foot).length;
    if (count < MIN_QUALIFYING_PLAYERS) continue;
    prompts.push({
      id: `foot:${foot}`,
      text: `Name a ${foot === "LEFT" ? "left" : "right"}-footed player.`,
      test: (p) => p.foot === foot,
    });
  }

  // --- Honors ------------------------------------------------------------
  const wcCount = players.filter((p) => p.worldCupWinner).length;
  if (wcCount >= MIN_QUALIFYING_PLAYERS) {
    prompts.push({
      id: "trophy:worldcup",
      text: "Name a World Cup winner.",
      test: (p) => p.worldCupWinner,
    });
  }
  const clCount = players.filter((p) => p.championsLeagueWinner).length;
  if (clCount >= MIN_QUALIFYING_PLAYERS) {
    prompts.push({
      id: "trophy:championsleague",
      text: "Name a Champions League winner.",
      test: (p) => p.championsLeagueWinner,
    });
  }

  // --- Career status -------------------------------------------------
  const retiredCount = players.filter((p) => p.retired).length;
  if (retiredCount >= MIN_QUALIFYING_PLAYERS) {
    prompts.push({
      id: "status:retired",
      text: "Name a retired player.",
      test: (p) => p.retired,
    });
  }
  const activeCount = players.filter((p) => !p.retired).length;
  if (activeCount >= MIN_QUALIFYING_PLAYERS) {
    prompts.push({
      id: "status:active",
      text: "Name a player who is still playing.",
      test: (p) => !p.retired,
    });
  }

  return prompts;
}

function promptPool(): LastManStandingPrompt[] {
  if (!_pool) _pool = buildPromptPool();
  return _pool;
}

/** Random prompt not already used this match, so a session doesn't repeat a category. */
export function randomPrompt(usedIds: Set<string>): LastManStandingPrompt | null {
  const pool = promptPool();
  const eligible = pool.filter((p) => !usedIds.has(p.id));
  const source = eligible.length > 0 ? eligible : pool; // pool exhausted — allow repeats rather than crash
  if (source.length === 0) return null;
  return source[Math.floor(Math.random() * source.length)];
}

export type LastManStandingVerdict =
  | { ok: true; player: LastManStandingPlayer }
  | { ok: false; reason: "no-answer" | "not-found" | "doesnt-match" };

/** Resolve a raw submitted answer against a prompt's category. */
export function verifyAnswer(
  prompt: LastManStandingPrompt,
  raw: string | null
): LastManStandingVerdict {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, reason: "no-answer" };

  const player = resolvePlayer(text);
  if (!player) return { ok: false, reason: "not-found" };
  if (!prompt.test(player)) return { ok: false, reason: "doesnt-match" };

  return { ok: true, player };
}
