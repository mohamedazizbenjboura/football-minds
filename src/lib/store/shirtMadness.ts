"use client";

/**
 * Client state for Shirt Number Madness — PROJECT_SPEC.md §5 "Shirt Number Madness".
 * Mirrors the server-authoritative state broadcast from server/index.ts;
 * this store holds nothing that isn't just a cache of the last server event.
 */

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

export type ShirtMadnessPhase = "answering" | "roundEnd" | "gameEnd";

export interface ShirtMadnessAnswerResult {
  playerId: string;
  answer: string | null;
  points: number;
  reason: "no-answer" | "not-found" | "wrong-number" | "duplicate" | null;
  resolvedName: string | null;
}

export interface ShirtMadnessPublicState {
  round: number;
  totalRounds: number;
  number: number;
  answeredPlayerIds: string[];
  roundEndsAt: number | null;
  lastResults: ShirtMadnessAnswerResult[] | null;
  phase: ShirtMadnessPhase;
  scores: Record<string, number>;
  winnerId: string | null; // set once phase === "gameEnd"
}

interface ShirtMadnessStore {
  state: ShirtMadnessPublicState | null;

  attach: () => void;
  sync: () => void;
  submit: (name: string) => void;
  reset: () => void;
}

export const useShirtMadnessStore = create<ShirtMadnessStore>((set) => ({
  state: null,

  attach: () => {
    const socket = getSocket();
    socket.off("shirtmadness:state");
    socket.on("shirtmadness:state", (state: ShirtMadnessPublicState) => set({ state }));
  },

  sync: () => {
    getSocket().emit("shirtmadness:sync", (state: ShirtMadnessPublicState | null) => {
      if (state) set({ state });
    });
  },

  submit: (name: string) => {
    getSocket().emit("shirtmadness:submit", { name });
  },

  reset: () => set({ state: null }),
}));
