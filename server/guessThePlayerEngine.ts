/**
 * Guess The Player — game engine, PROJECT_SPEC.md §5 "Guess The Player".
 *
 * "Classic 20-questions. No timer, no hints, no AI. Player A and Player B
 * each secretly pick a player (via search, resolved through searchPlayer,
 * shown as a real <PlayerAvatar/> only to its owner). Unlimited yes/no
 * questions asked in room chat, answered by the opponent. First correct
 * guess wins."
 *
 * Unlike The Chain / Who Am I? / Career Maze / Last Man Standing, this game
 * has no dataset dependency at all: the secret pick is any real player the
 * TWO PARTICIPANTS agree exists (resolved client-side via
 * /api/player-search → TheSportsDB, per §3 — the room server itself never
 * calls TheSportsDB, it only ever stores/compares the plain name string
 * that already went through that lookup). There is deliberately no
 * automated "is this actually a real player" check here — the spec is
 * explicit that this game has "no AI"; correctness is between the two
 * humans, exactly like a real-life 20-questions game.
 *
 * This session's implementation is scoped to **1v1 only**. The spec also
 * describes a 2v2 variant ("teammates share one hidden player"), but that
 * requires a team-assignment mechanism (`RoomPlayer.team`) that is declared
 * in server/index.ts's types but has no socket event to actually set it
 * anywhere in the codebase — see PROGRESS.md "Known gaps". Building fake
 * team assignment just for this one game felt like the wrong order of
 * operations; the real fix is a proper `room:assignTeam` (or similar)
 * event that every 2v2 game will eventually need, not something bolted on
 * here. `server/index.ts` rejects `room:start` for this game outside 1v1
 * mode with a clear error message rather than pretending to support it.
 */

import { normalizeName } from "./chainEngine";

/** Case/accent/whitespace-insensitive comparison, reusing the same
 * normalization every other game already uses for name matching.
 *
 * BUG FIX (live-problems.md): this used to require an exact full-name
 * match, so guessing "Ronaldo" against a secret pick of "Cristiano
 * Ronaldo" silently failed — the guess showed up in the guess log but no
 * win was ever declared, with no error either. This game has no dataset
 * to resolve free text against (see file header), so it can't reuse
 * chainEngine.ts's resolvePlayer() directly — instead, a single-word
 * guess is now also allowed to match just the LAST word of the other
 * name, which is the closest equivalent for two arbitrary free-text
 * strings and matches how people actually type in a fast party game.
 *
 * BUG FIX #2 (2026-07-31, reported live): the fix above only ever checked
 * the single word against the LAST word of the full name, so "Ronaldo"
 * worked but "Cristiano" (the first name) still silently failed to win —
 * same silent non-match, just on the other half of the name. A one-word
 * guess is now checked against EVERY word of the other name (first,
 * middle, or last), not just the final one, so either half of "Cristiano
 * Ronaldo" correctly wins. */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const aWords = na.split(" ");
  const bWords = nb.split(" ");
  if (aWords.length === 1 && bWords.includes(na)) return true;
  if (bWords.length === 1 && aWords.includes(nb)) return true;

  return false;
}

/** A pick is valid if it's non-empty after trimming — no dataset/API check
 * here by design (see file header). */
export function isValidPick(raw: string): boolean {
  return raw.trim().length > 0;
}
