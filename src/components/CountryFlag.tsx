"use client";

/**
 * Renders a real flag image for a nationality via flagcdn.com (free, no
 * API key, no rate limit that matters at party-game scale), with a
 * globe-emoji fallback for any country not yet in countryFlags.ts's map —
 * same "never a broken image" guarantee PROJECT_SPEC.md §3 requires of
 * <PlayerAvatar/> and <ClubBadge/>.
 */

import { countryCodeFor } from "@/lib/countryFlags";

interface CountryFlagProps {
  nationality: string;
  size?: number;
  className?: string;
  rounded?: boolean;
}

export default function CountryFlag({
  nationality,
  size = 40,
  className = "",
  rounded = true,
}: CountryFlagProps) {
  const code = countryCodeFor(nationality);
  const height = Math.round(size * 0.72);

  if (!code) {
    return (
      <div
        className={`flex items-center justify-center shrink-0 bg-white/5 ${rounded ? "rounded-lg" : ""} ${className}`}
        style={{ width: size, height }}
        title={nationality}
      >
        <span style={{ fontSize: size * 0.55 }}>🌍</span>
      </div>
    );
  }

  return (
    <div
      className={`relative shrink-0 overflow-hidden shadow-md ring-1 ring-white/15 ${rounded ? "rounded-lg" : ""} ${className}`}
      style={{ width: size, height }}
      title={nationality}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- external CDN, same pattern as PlayerAvatar/ClubBadge */}
      <img
        src={`https://flagcdn.com/w160/${code}.png`}
        alt={nationality}
        width={size}
        height={height}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
  );
}
