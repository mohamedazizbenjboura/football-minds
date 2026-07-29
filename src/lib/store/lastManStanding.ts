"use client";

/**
 * Client state for Last Man Standing — PROJECT_SPEC.md §5 "Last Man Standing".
 * Mirrors the server-authoritative state broadcast from server/index.ts;
 * this store holds nothing that isn't just a cache of the last server event.
 */

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

export type LastManStandingPhase = "answering" | "roundEnd" | "gameEnd";

export interface LastManStandingPromptPublic {
  id: string;
  text: string;
}

export interface LastManStandingAnswerResult {
  playerId: string;
  answer: string | null;
  survived: boolean;
  reason: "no-answer" | "not-found" | "doesnt-match" | "duplicate" | null;
  resolvedName: string | null;
}

export interface LastManStandingPublicState {
  roundNumber: number;
  prompt: LastManStandingPromptPublic | null;
  order: string[];
  eliminated: string[];
  answeredPlayerIds: string[];
  roundEndsAt: number | null;
  lastResults: LastManStandingAnswerResult[] | null;
  phase: LastManStandingPhase;
  winnerId: string | null; // set once phase === "gameEnd"; stays null for a no-survivors draw
}

interface LastManStandingStore {
  state: LastManStandingPublicState | null;

  attach: () => void;
  sync: () => void;
  submit: (name: string) => void;
  reset: () => void;
}

export const useLastManStandingStore = create<LastManStandingStore>((set) => ({
  state: null,

  attach: () => {
    const socket = getSocket();
    socket.off("lastmanstanding:state");
    socket.on("lastmanstanding:state", (state: LastManStandingPublicState) => set({ state }));
  },

  sync: () => {
    getSocket().emit("lastmanstanding:sync", (state: LastManStandingPublicState | null) => {
      if (state) set({ state });
    });
  },

  submit: (name: string) => {
    getSocket().emit("lastmanstanding:submit", { name });
  },

  reset: () => set({ state: null }),
}));
