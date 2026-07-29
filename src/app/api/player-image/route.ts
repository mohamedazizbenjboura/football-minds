import { NextRequest, NextResponse } from "next/server";
import { searchPlayer, pickPlayerImage } from "@/lib/sportsdb";
import { playerFallbackSvg } from "@/lib/avatar";

export const runtime = "nodejs";

// In-memory cache — per PROJECT_SPEC.md §3 ("cache results in-memory, and
// later in Postgres if we want a permanent cache table"). Resets on cold
// start; that's fine, TheSportsDB is cheap to re-hit.
type CacheEntry = { url: string | null; position: string | null; club: string | null };
const cache = new Map<string, CacheEntry>();

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim();
  const position = request.nextUrl.searchParams.get("position") ?? undefined;

  if (!name) {
    return NextResponse.json({ error: "Missing required `name` query param" }, { status: 400 });
  }

  const cacheKey = name.toLowerCase();
  let entry = cache.get(cacheKey);

  if (!entry) {
    const player = await searchPlayer(name);
    entry = {
      url: player ? pickPlayerImage(player) : null,
      position: player?.strPosition ?? null,
      club: player?.strTeam ?? null,
    };
    cache.set(cacheKey, entry);
  }

  if (entry.url) {
    // Real photo found — redirect the browser straight to TheSportsDB's CDN
    // so we never proxy/buffer image bytes through our own server.
    return NextResponse.redirect(entry.url, { status: 302 });
  }

  // No real photo — generate a deterministic procedural avatar instead of
  // ever surfacing a broken image to the client.
  const svg = playerFallbackSvg({ name, position: position ?? entry.position });
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
