"use client";

/**
 * Client state for Who Am I? — PROJECT_SPEC.md §5 "Who Am I?".
 * Mirrors the server-authoritative state broadcast from server/index.ts;
 * this store holds nothing that isn't just a cache of the last server event.
 */

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

export type WhoAmIClueIcon = "flag" | "club" | "status" | "position" | "trophy" | "text";

export interface WhoAmIClue {
  label: string;
  value: string;
  icon: WhoAmIClueIcon;
}

export type WhoAmIPhase = "clue" | "roundEnd" | "gameEnd";

export interface WhoAmIPublicState {
  round: number;
  totalRounds: number;
  clues: WhoAmIClue[];
  cluesRevealed: number;
  totalClues: number;
  phase: WhoAmIPhase;
  solvedBy: string | null;
  targetName: string | null; // only non-null once the round is over
  // FIFA-pack-style reveal card fields (Aziz's request) — same reveal
  // guard as targetName: null until the round is actually over.
  targetNationality: string | null;
  targetPosition: "GK" | "DF" | "MF" | "FW" | null;
  targetClub: string | null;
  targetRetired: boolean | null;
  scores: Record<string, number>;
  nextClueAt: number | null;
  nextRoundAt: number | null; // set once the round ends, for the 10s "next round" prep countdown
  winnerId: string | null; // only set once phase === "gameEnd"
}

export interface WhoAmISolved {
  playerId: string;
  displayName: string;
  points: number;
  targetName: string;
}

interface WhoAmIStore {
  state: WhoAmIPublicState | null;
  lastSolved: WhoAmISolved | null;

  attach: () => void;
  sync: () => void;
  submit: (name: string) => void;
  reset: () => void;
}

export const useWhoAmIStore = create<WhoAmIStore>((set) => ({
  state: null,
  lastSolved: null,

  attach: () => {
    const socket = getSocket();
    socket.off("whoami:state");
    socket.off("whoami:solved");

    socket.on("whoami:state", (state: WhoAmIPublicState) => set({ state }));
    socket.on("whoami:solved", (payload: WhoAmISolved) => set({ lastSolved: payload }));
  },

  sync: () => {
    getSocket().emit("whoami:sync", (state: WhoAmIPublicState | null) => {
      if (state) set({ state });
    });
  },

  submit: (name: string) => {
    getSocket().emit("whoami:submit", { name });
  },

  reset: () => set({ state: null, lastSolved: null }),
}));
