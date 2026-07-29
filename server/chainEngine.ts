/**
 * The Chain — game engine, PROJECT_SPEC.md §5 "The Chain" (the flagship game).
 *
 * This is the first real game logic wired into the room server. It reads a
 * small curated real-player dataset (`server/data/players.json`) instead of
 * a live Postgres connection — see PROGRESS.md for why: the full Football
 * Knowledge Database (foot_database.md) isn't wired up yet, so this dataset
 * exists purely to make the flagship game genuinely playable end-to-end.
 *
 * Rule of thumb still holds: nothing in here is persisted. Round state lives
 * entirely in memory, owned by server/index.ts, and is thrown away when the
 * room closes.
 */

import { readFileSync } from "fs";
import { join } from "path";

export type Foot = "LEFT" | "RIGHT" | "BOTH";
export type ChainPosition = "GK" | "DF" | "MF" | "FW";

export interface CareerStint {
  club: string;
  startYear: number;
  endYear: number;
}

export interface ChainPlayer {
  name: string;
  nationality: string;
  continent: string;
  position: ChainPosition;
  foot: Foot;
  birthYear: number;
  retired: boolean;
  worldCupWinner: boolean;
  championsLeagueWinner: boolean;
  careers: CareerStint[];
}

const CURRENT_YEAR = 2026;

let _players: ChainPlayer[] | null = null;

export function loadPlayers(): ChainPlayer[] {
  if (_players) return _players;
  const raw = readFileSync(join(__dirname, "data", "players.json"), "utf-8");
  _players = JSON.parse(raw) as ChainPlayer[];
  return _players;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents so "Ibrahimovic"/"Ibrahimović" both match
    .replace(/[^a-z\s]/g, "")
    .trim();
}

/** Resolve free-text user input to a dataset player, or null if no match. */
export function resolvePlayer(input: string): ChainPlayer | null {
  const target = normalizeName(input);
  if (!target) return null;
  const players = loadPlayers();

  const exact = players.find((p) => normalizeName(p.name) === target);
  if (exact) return exact;

  // Loose match on last name alone (e.g. "Messi", "Ronaldo") since that's
  // how people actually type in a fast-paced party game.
  const byLastName = players.find((p) => {
    const parts = normalizeName(p.name).split(" ");
    return parts[parts.length - 1] === target;
  });
  return byLastName ?? null;
}

/** Two players are teammates if any of their career stints overlap at the same club. */
export function wereTeammates(a: ChainPlayer, b: ChainPlayer): boolean {
  for (const stintA of a.careers) {
    for (const stintB of b.careers) {
      if (
        stintA.club === stintB.club &&
        stintA.startYear <= stintB.endYear &&
        stintB.startYear <= stintA.endYear
      ) {
        return true;
      }
    }
  }
  return false;
}

export interface FireModeModifier {
  id: string;
  description: string;
  test: (p: ChainPlayer) => boolean;
}

export const FIRE_MODE_MODIFIERS: FireModeModifier[] = [
  { id: "left-footed", description: "Only left-footed players", test: (p) => p.foot === "LEFT" },
  { id: "defenders", description: "Only defenders", test: (p) => p.position === "DF" },
  { id: "goalkeepers", description: "Only goalkeepers", test: (p) => p.position === "GK" },
  { id: "south-americans", description: "Only South Americans", test: (p) => p.continent === "South America" },
  { id: "retired", description: "Only retired players", test: (p) => p.retired },
  { id: "ucl-winners", description: "Only Champions League winners", test: (p) => p.championsLeagueWinner },
  { id: "world-cup-winners", description: "Only World Cup winners", test: (p) => p.worldCupWinner },
  { id: "veterans", description: "Only players 35 or older", test: (p) => CURRENT_YEAR - p.birthYear >= 35 },
];

export function randomModifier(excludeId?: string): FireModeModifier {
  const pool = FIRE_MODE_MODIFIERS.filter((m) => m.id !== excludeId);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** A good starting player: someone with several club stints, so the chain has lots of directions to go. */
export function randomStartingPlayer(): ChainPlayer {
  const players = loadPlayers();
  const wellTravelled = players.filter((p) => p.careers.length >= 2);
  const pool = wellTravelled.length > 0 ? wellTravelled : players;
  return pool[Math.floor(Math.random() * pool.length)];
}
