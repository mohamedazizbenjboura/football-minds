"use client";

/**
 * Client state for Football Pyramid — PROJECT_SPEC.md §5 "Football Pyramid".
 * Mirrors the server-authoritative state broadcast from server/index.ts;
 * this store holds nothing that isn't just a cache of the last server event.
 *
 * Unlike Who Am I? (one winner per round), any number of players can solve
 * a round here — `lastSolved` is just the most recent solve event for the
 * toast/banner, `state.solvedIds` is the authoritative list of who's already
 * scored this round.
 */

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

export interface FootballPyramidClue {
  label: string;
  value: string;
}

export type FootballPyramidPhase = "clue" | "roundEnd" | "gameEnd";

export interface FootballPyramidPublicState {
  round: number;
  totalRounds: number;
  clues: FootballPyramidClue[];
  cluesRevealed: number;
  totalClues: number;
  phase: FootballPyramidPhase;
  solvedIds: string[];
  targetName: string | null; // only non-null once the round is over
  scores: Record<string, number>;
  nextClueAt: number | null;
  winnerId: string | null; // only set once phase === "gameEnd"
}

export interface FootballPyramidSolved {
  playerId: string;
  displayName: string;
  points: number;
}

interface FootballPyramidStore {
  state: FootballPyramidPublicState | null;
  lastSolved: FootballPyramidSolved | null;

  attach: () => void;
  sync: () => void;
  submit: (name: string) => void;
  reset: () => void;
}

export const useFootballPyramidStore = create<FootballPyramidStore>((set) => ({
  state: null,
  lastSolved: null,

  attach: () => {
    const socket = getSocket();
    socket.off("pyramid:state");
    socket.off("pyramid:solved");

    socket.on("pyramid:state", (state: FootballPyramidPublicState) => set({ state }));
    socket.on("pyramid:solved", (payload: FootballPyramidSolved) => set({ lastSolved: payload }));
  },

  sync: () => {
    getSocket().emit("pyramid:sync", (state: FootballPyramidPublicState | null) => {
      if (state) set({ state });
    });
  },

  submit: (name: string) => {
    getSocket().emit("pyramid:submit", { name });
  },

  reset: () => set({ state: null, lastSolved: null }),
}));
