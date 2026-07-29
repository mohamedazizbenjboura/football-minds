/**
 * Procedural fallback visuals — PROJECT_SPEC.md §3.
 *
 * When TheSportsDB has no photo/badge for a given name, we generate an SVG
 * on the fly so the client never renders a broken image. These are returned
 * directly as `image/svg+xml` responses from the API routes, so from the
 * <PlayerAvatar/> / <ClubBadge/> components' point of view every lookup
 * "succeeds" — there is no error state to design for.
 */

// A small deterministic palette so two lookups for the same name always
// produce the same fallback (stable across re-renders / re-fetches).
const GRADIENTS: Array<[string, string]> = [
  ["#00E676", "#00C853"],
  ["#1DE9B6", "#00BFA5"],
  ["#40C4FF", "#0091EA"],
  ["#FFEA00", "#FFC400"],
  ["#FF6E40", "#FF3D00"],
  ["#B388FF", "#7C4DFF"],
  ["#69F0AE", "#00E676"],
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function gradientFor(seed: string, preferredHex?: string | null): [string, string] {
  if (preferredHex && /^#?[0-9a-fA-F]{6}$/.test(preferredHex)) {
    const hex = preferredHex.startsWith("#") ? preferredHex : `#${preferredHex}`;
    return [hex, darken(hex, 0.35)];
  }
  const [a, b] = GRADIENTS[hashString(seed) % GRADIENTS.length];
  return [a, b];
}

function darken(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.floor(((num >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.floor(((num >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.floor((num & 0xff) * (1 - amount)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function initials(name: string, max = 2): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, max).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const POSITION_ICON_PATHS: Record<string, string> = {
  // Simple, recognizable glyphs — kept minimal so they read at avatar size.
  GK: "M50 20 L70 35 L62 65 L38 65 L30 35 Z", // gloves/diamond
  DF: "M50 20 L75 30 L75 55 A25 25 0 0 1 25 55 L25 30 Z", // shield
  MF: "M30 50 L70 50 M50 30 L50 70", // compass cross (playmaker)
  FW: "M50 25 L65 55 L50 45 L35 55 Z", // arrow up
};

export interface PlayerFallbackOptions {
  name: string;
  position?: string | null;
  clubColor?: string | null;
}

export function playerFallbackSvg({ name, position, clubColor }: PlayerFallbackOptions): string {
  const [c1, c2] = gradientFor(name, clubColor);
  const label = initials(name);
  const posKey = (position || "").toUpperCase();
  const icon = POSITION_ICON_PATHS[posKey];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="50" fill="url(#g)"/>
  <text x="50" y="58" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700"
        fill="rgba(11,18,32,0.92)" text-anchor="middle">${escapeXml(label)}</text>
  ${icon ? `<path d="${icon}" fill="none" stroke="rgba(11,18,32,0.35)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
</svg>`;
}

export interface ClubFallbackOptions {
  name: string;
  primaryColor?: string | null;
}

export function clubFallbackSvg({ name, primaryColor }: ClubFallbackOptions): string {
  const [c1, c2] = gradientFor(name, primaryColor);
  const label = initials(name, 3);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <path d="M50 4 L92 20 V50 C92 76 74 92 50 98 C26 92 8 76 8 50 V20 Z" fill="url(#g)" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <text x="50" y="60" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800"
        fill="rgba(11,18,32,0.92)" text-anchor="middle">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
