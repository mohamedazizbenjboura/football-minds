"use client";

/**
 * Client state for The Chain — PROJECT_SPEC.md §5 "The Chain".
 * Mirrors the server-authoritative state broadcast from server/index.ts;
 * this store holds nothing that isn't just a cache of the last server event.
 */

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

export type ChainPosition = "GK" | "DF" | "MF" | "FW";

export interface ChainEntry {
  name: string;
  nationality: string;
  position: ChainPosition;
  by: string;
}

export interface ChainModifier {
  id: string;
  description: string;
}

export interface ChainPublicState {
  chain: ChainEntry[];
  currentPlayerId: string | null;
  order: string[];
  eliminated: string[];
  modifier: ChainModifier | null;
  turnEndsAt: number | null;
  winnerId: string | null;
}

export interface ChainWrongAnswer {
  playerId: string;
  guess: string;
  reason: "not-found" | "already-used" | "not-teammates" | "modifier" | "timeout" | string;
}

interface ChainStore {
  state: ChainPublicState | null;
  lastWrong: ChainWrongAnswer | null;
  fireModeBanner: string | null;

  attach: () => void;
  sync: () => void;
  submit: (name: string) => void;
  clearFireModeBanner: () => void;
  reset: () => void;
}

export const useChainStore = create<ChainStore>((set) => ({
  state: null,
  lastWrong: null,
  fireModeBanner: null,

  attach: () => {
    const socket = getSocket();
    socket.off("chain:state");
    socket.off("chain:wrongAnswer");
    socket.off("chain:fireMode");

    socket.on("chain:state", (state: ChainPublicState) => set({ state }));
    socket.on("chain:wrongAnswer", (payload: ChainWrongAnswer) => set({ lastWrong: payload }));
    socket.on("chain:fireMode", (payload: { description: string }) =>
      set({ fireModeBanner: payload.description })
    );
  },

  sync: () => {
    getSocket().emit("chain:sync", (state: ChainPublicState | null) => {
      if (state) set({ state });
    });
  },

  submit: (name: string) => {
    getSocket().emit("chain:submit", { name });
  },

  clearFireModeBanner: () => set({ fireModeBanner: null }),
  reset: () => set({ state: null, lastWrong: null, fireModeBanner: null }),
}));
