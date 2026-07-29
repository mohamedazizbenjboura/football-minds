"use client";

/**
 * Renders any club, by name, as a real crest when TheSportsDB has one, or a
 * procedural monogram crest otherwise. Same rule as PlayerAvatar — this is
 * the only sanctioned way to show a club anywhere in the app.
 */

interface ClubBadgeProps {
  name: string;
  size?: number;
  className?: string;
}

export default function ClubBadge({ name, size = 40, className = "" }: ClubBadgeProps) {
  const src = `/api/club-badge?${new URLSearchParams({ name }).toString()}`;

  return (
    <div
      className={`relative shrink-0 flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      title={name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className="w-full h-full object-contain drop-shadow-md"
        loading="lazy"
      />
    </div>
  );
}
