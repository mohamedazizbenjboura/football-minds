import { NextRequest, NextResponse } from "next/server";
import { getTeamBadge } from "@/lib/sportsdb";
import { clubFallbackSvg } from "@/lib/avatar";

export const runtime = "nodejs";

type CacheEntry = { url: string | null; color: string | null };
const cache = new Map<string, CacheEntry>();

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim();

  if (!name) {
    return NextResponse.json({ error: "Missing required `name` query param" }, { status: 400 });
  }

  const cacheKey = name.toLowerCase();
  let entry = cache.get(cacheKey);

  if (!entry) {
    const team = await getTeamBadge(name);
    entry = {
      url: team?.strBadge ?? null,
      color: team?.strColour1 ?? null,
    };
    cache.set(cacheKey, entry);
  }

  if (entry.url) {
    return NextResponse.redirect(entry.url, { status: 302 });
  }

  const svg = clubFallbackSvg({ name, primaryColor: entry.color });
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
