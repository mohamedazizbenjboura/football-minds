"use client";

/**
 * Renders any player, by name, as a real photo when TheSportsDB has one,
 * or a procedural monogram otherwise. Per PROJECT_SPEC.md §3 this is the
 * ONLY way game components should ever show a player — never plain text,
 * never a direct TheSportsDB call.
 */

interface PlayerAvatarProps {
  name: string;
  position?: "GK" | "DF" | "MF" | "FW" | null;
  size?: number;
  className?: string;
  ring?: boolean;
}

export default function PlayerAvatar({
  name,
  position,
  size = 56,
  className = "",
  ring = false,
}: PlayerAvatarProps) {
  const params = new URLSearchParams({ name });
  if (position) params.set("position", position);
  const src = `/api/player-image?${params.toString()}`;

  return (
    <div
      className={`relative shrink-0 rounded-full overflow-hidden bg-[var(--color-surface)] ${
        ring ? "ring-2 ring-[var(--color-primary)]/60" : ""
      } ${className}`}
      style={{ width: size, height: size }}
      title={name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- source is
          our own route, which redirects to an external CDN or returns SVG;
          next/image can't optimize either case usefully. */}
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
  );
}
