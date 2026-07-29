"use client";

/**
 * Type-ahead player picker — used by Guess The Player's secret-pick step
 * (PROJECT_SPEC.md §5 — "each secretly pick a player via search, resolved
 * through searchPlayer"). Queries /api/player-search (TheSportsDB, server-
 * side) and shows each candidate with a real <PlayerAvatar/> so the picker
 * can confirm they found the exact player they mean before locking it in.
 */

import { useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import PlayerAvatar from "./PlayerAvatar";

interface SearchResult {
  name: string;
  team: string | null;
  nationality: string | null;
  position: string | null;
}

interface PlayerSearchPickerProps {
  onPick: (name: string) => void;
  placeholder?: string;
}

export default function PlayerSearchPicker({ onPick, placeholder }: PlayerSearchPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (q.length < 2) {
      // Nothing to fetch for a too-short query; the render below already
      // hides any stale results/loading indicator once the query drops
      // under 2 characters, so there's no state to correct here.
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const requestId = ++requestIdRef.current;
      try {
        const res = await fetch(`/api/player-search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (requestId === requestIdRef.current) {
          setResults(data.results ?? []);
        }
      } catch {
        if (requestId === requestIdRef.current) setResults([]);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? "Search for a player…"}
          className="w-full h-12 pl-10 pr-10 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none text-sm"
        />
        {loading && (
          <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />
        )}
      </div>

      {query.trim().length >= 2 && results.length > 0 && (
        <div className="glass rounded-2xl overflow-hidden flex flex-col divide-y divide-white/5 max-h-72 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.name}
              onClick={() => {
                onPick(r.name);
                setQuery("");
                setResults([]);
              }}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
            >
              <PlayerAvatar name={r.name} size={36} />
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-sm truncate">{r.name}</span>
                <span className="text-xs text-gray-400 truncate">
                  {[r.team, r.nationality].filter(Boolean).join(" · ") || "—"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {query.trim().length >= 2 && !loading && results.length === 0 && (
        <button
          onClick={() => {
            const name = query.trim();
            if (!name) return;
            onPick(name);
            setQuery("");
            setResults([]);
          }}
          className="text-xs text-left text-gray-400 px-1 hover:text-[var(--color-primary)] transition-colors"
        >
          No matches found — use &quot;{query.trim()}&quot; anyway
        </button>
      )}
    </div>
  );
}
