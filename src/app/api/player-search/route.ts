import { NextRequest, NextResponse } from "next/server";
import { searchPlayers } from "@/lib/sportsdb";

export const runtime = "nodejs";

/**
 * Type-ahead player search for the "Guess The Player" secret-pick step
 * (PROJECT_SPEC.md §5 — "each secretly pick a player via search, resolved
 * through searchPlayer"). Returns a short list of candidates so the client
 * can let the picker choose the exact real player they mean, with a real
 * <PlayerAvatar/> preview per candidate — never a free-text guess at
 * spelling that the rest of the game then has to fuzzy-match.
 *
 * Unlike /api/player-image, this route is read-only lookup metadata (no
 * SVG/redirect response) so the client can render a picklist; the actual
 * avatar for any chosen name still goes exclusively through
 * <PlayerAvatar/> → /api/player-image, per §3's "no exceptions" rule.
 */

const MAX_RESULTS = 8;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const candidates = await searchPlayers(query);
  const results = candidates.slice(0, MAX_RESULTS).map((p) => ({
    name: p.strPlayer,
    team: p.strTeam ?? null,
    nationality: p.strNationality ?? null,
    position: p.strPosition ?? null,
  }));

  return NextResponse.json({ results });
}
