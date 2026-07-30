"use client";

/**
 * The hero "player wall" — a fanned spread of FUT-style superstar cards,
 * Ronaldo dead center, the way a FIFA cover reveal fans out its cast.
 * Reuses the exact same /api/player-image pipeline as every other player
 * visual in the app (PROJECT_SPEC.md §3) — real TheSportsDB photo when
 * available, a generated fallback otherwise — so this never risks a
 * broken image. Cards (not raw cutout silhouettes) are the right call here
 * because TheSportsDB's photos are square headshots, not transparent
 * cutouts — a card frame reads as intentional, a naked silhouette would
 * show a visible photo edge.
 */

import { motion } from "framer-motion";

interface Superstar {
  name: string;
  /** Fan rotation, degrees. 0 = dead center. */
  rotate: number;
  /** Relative card scale, center should be 1 (largest). */
  scale: number;
  /** Card accent border color. */
  accent: string;
  /** Hide below this breakpoint so the fan never crowds on small phones. */
  minBreakpoint?: "sm" | "md";
}

// Ordered left to right; Ronaldo is the center card by request.
const SUPERSTARS: Superstar[] = [
  { name: "Lionel Messi", rotate: -18, scale: 0.74, accent: "#ffea00", minBreakpoint: "md" },
  { name: "Neymar Jr", rotate: -11, scale: 0.82, accent: "#00e676", minBreakpoint: "sm" },
  { name: "Kylian Mbappe", rotate: -5, scale: 0.92, accent: "#ffea00" },
  { name: "Cristiano Ronaldo", rotate: 0, scale: 1.12, accent: "#00e676" },
  { name: "Erling Haaland", rotate: 5, scale: 0.92, accent: "#2b5cff" },
  { name: "Kevin De Bruyne", rotate: 11, scale: 0.82, accent: "#ffea00", minBreakpoint: "sm" },
  { name: "Mohamed Salah", rotate: 18, scale: 0.74, accent: "#00e676", minBreakpoint: "md" },
];

const BREAKPOINT_CLASS: Record<string, string> = {
  sm: "hidden sm:flex",
  md: "hidden md:flex",
};

export default function HeroPlayerWall() {
  return (
    <div className="relative w-full max-w-6xl mx-auto mt-6 select-none">
      <div className="flex items-end justify-center gap-2 sm:gap-3 md:gap-4 px-2 pb-2">
        {SUPERSTARS.map((player, index) => {
          const visibilityClass = player.minBreakpoint
            ? BREAKPOINT_CLASS[player.minBreakpoint]
            : "flex";
          const isCenter = player.rotate === 0;
          return (
            <motion.div
              key={player.name}
              initial={{ opacity: 0, y: 70, rotate: 0 }}
              animate={{ opacity: 1, y: 0, rotate: player.rotate }}
              transition={{
                duration: 0.75,
                delay: 0.12 + Math.abs(index - 3) * 0.07,
                ease: [0.16, 1, 0.3, 1],
              }}
              whileHover={{
                y: -14,
                rotate: 0,
                scale: player.scale * 1.06,
                zIndex: 20,
                transition: { duration: 0.25 },
              }}
              style={{
                transformOrigin: "bottom center",
                zIndex: 10 - Math.abs(index - 3),
              }}
              className={`fut-card relative ${visibilityClass} flex-col shrink-0 ${
                isCenter ? "z-20" : ""
              }`}
            >
              <div
                className="fut-card-frame relative rounded-2xl overflow-hidden"
                style={{
                  width: `${86 * player.scale}px`,
                  height: `${112 * player.scale}px`,
                  ["--card-accent" as string]: player.accent,
                }}
              >
                {/* Floor glow */}
                <div
                  className="floor-glow absolute -bottom-6 left-1/2 -translate-x-1/2 w-[150%] h-8 rounded-full pointer-events-none -z-10"
                  style={{ ["--glow-color" as string]: player.accent }}
                />
                <img
                  src={`/api/player-image?${new URLSearchParams({ name: player.name }).toString()}`}
                  alt={player.name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                <div className="fut-card-sheen absolute inset-0 pointer-events-none" />
                <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/85 via-black/40 to-transparent">
                  <p
                    className="text-[8px] sm:text-[9px] md:text-[10px] font-bold uppercase tracking-wide text-white truncate text-center"
                    style={{ fontSize: isCenter ? "11px" : undefined }}
                  >
                    {player.name}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
