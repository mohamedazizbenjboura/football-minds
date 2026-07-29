"use client";

/**
 * Client state for Career Maze — PROJECT_SPEC.md §5 "Career Maze".
 * Mirrors the server-authoritative state broadcast from server/index.ts;
 * this store holds nothing that isn't just a cache of the last server event.
 */

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

export interface TimelineStop {
  club: string;
  startYear: number;
  endYear: number;
}

export type CareerMazePhase = "guess" | "roundEnd" | "gameEnd";

export interface CareerMazePublicState {
  round: number;
  totalRounds: number;
  timeline: TimelineStop[];
  phase: CareerMazePhase;
  solvedBy: string | null;
  targetName: string | null; // only non-null once the round is over
  scores: Record<string, number>;
  roundEndsAt: number | null;
  winnerId: string | null; // only set once phase === "gameEnd"
}

export interface CareerMazeSolved {
  playerId: string;
  displayName: string;
  points: number;
  targetName: string;
}

interface CareerMazeStore {
  state: CareerMazePublicState | null;
  lastSolved: CareerMazeSolved | null;

  attach: () => void;
  sync: () => void;
  submit: (name: string) => void;
  reset: () => void;
}

export const useCareerMazeStore = create<CareerMazeStore>((set) => ({
  state: null,
  lastSolved: null,

  attach: () => {
    const socket = getSocket();
    socket.off("careermaze:state");
    socket.off("careermaze:solved");

    socket.on("careermaze:state", (state: CareerMazePublicState) => set({ state }));
    socket.on("careermaze:solved", (payload: CareerMazeSolved) => set({ lastSolved: payload }));
  },

  sync: () => {
    getSocket().emit("careermaze:sync", (state: CareerMazePublicState | null) => {
      if (state) set({ state });
    });
  },

  submit: (name: string) => {
    getSocket().emit("careermaze:submit", { name });
  },

  reset: () => set({ state: null, lastSolved: null }),
}));
