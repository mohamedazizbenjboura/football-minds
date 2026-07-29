/**
 * Thin server-side client for TheSportsDB free public API.
 *
 * Nothing outside `/api/player-image` and `/api/club-badge` should import this file —
 * per PROJECT_SPEC.md §3, game components never call TheSportsDB directly, they only
 * ever talk to <PlayerAvatar /> / <ClubBadge /> which in turn hit our own API routes.
 */

const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";

export interface SportsDbPlayer {
  idPlayer: string;
  strPlayer: string;
  strThumb: string | null;
  strCutout: string | null;
  strTeam: string | null;
  strNationality: string | null;
  strPosition: string | null;
}

export interface SportsDbTeam {
  idTeam: string;
  strTeam: string;
  strBadge: string | null;
  strTeamShort: string | null;
  strCountry: string | null;
  strColour1: string | null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      // TheSportsDB free tier is slow-changing data — safe to cache at the edge/CDN layer.
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Look up a player by (partial) name. Returns the best match, or null if
 * TheSportsDB has nothing — the caller (API route) is responsible for
 * falling back to a procedural avatar in that case.
 */
export async function searchPlayer(name: string): Promise<SportsDbPlayer | null> {
  const candidates = await searchPlayers(name);
  if (candidates.length === 0) return null;

  // Prefer an exact (case-insensitive) name match over the first fuzzy result.
  const exact = candidates.find(
    (p) => p.strPlayer?.toLowerCase() === name.trim().toLowerCase()
  );

  return exact ?? candidates[0];
}

/**
 * Look up all candidate players matching a (partial) name — unlike
 * `searchPlayer`, this returns the full candidate list rather than
 * collapsing to one best match. Used by `/api/player-search` to power a
 * type-ahead picker (PROJECT_SPEC.md §5 "Guess The Player" — "each secretly
 * pick a player via search, resolved through searchPlayer").
 */
export async function searchPlayers(name: string): Promise<SportsDbPlayer[]> {
  if (!name?.trim()) return [];

  const data = await fetchJson<{ player: SportsDbPlayer[] | null }>(
    `${SPORTSDB_BASE}/searchplayers.php?p=${encodeURIComponent(name.trim())}`
  );

  return data?.player ?? [];
}

/**
 * Look up a club/team badge by (partial) name.
 */
export async function getTeamBadge(teamName: string): Promise<SportsDbTeam | null> {
  if (!teamName?.trim()) return null;

  const data = await fetchJson<{ teams: SportsDbTeam[] | null }>(
    `${SPORTSDB_BASE}/searchteams.php?t=${encodeURIComponent(teamName.trim())}`
  );

  const candidates = data?.teams ?? [];
  if (candidates.length === 0) return null;

  const exact = candidates.find(
    (t) => t.strTeam?.toLowerCase() === teamName.trim().toLowerCase()
  );

  return exact ?? candidates[0];
}

/** Best available photo URL for a player result, or null. */
export function pickPlayerImage(player: SportsDbPlayer): string | null {
  return player.strCutout || player.strThumb || null;
}
