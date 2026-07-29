"use client";

/**
 * Client state for Guess The Player — PROJECT_SPEC.md §5 "Guess The Player".
 * Mirrors the server-authoritative public state broadcast from
 * server/index.ts, plus one piece of genuinely private state (`mySecret`)
 * that only ever arrives via a direct emit to this socket, never the
 * room-wide broadcast — so a player's own pick never leaks to their
 * opponent through this store either.
 */

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

export type GuessThePlayerPhase = "picking" | "playing" | "gameEnd";

export interface GuessThePlayerPublicState {
  order: string[]; // exactly 2 socketIds, 1v1 only
  pickedPlayerIds: string[]; // who has locked in a pick (not what they picked)
  phase: GuessThePlayerPhase;
  winnerId: string | null;
  forfeited: boolean;
  secrets: Record<string, string> | null; // revealed only once phase === "gameEnd"
}

export interface GuessThePlayerGuessEvent {
  playerId: string;
  displayName: string;
  guess: string;
}

interface GuessThePlayerStore {
  state: GuessThePlayerPublicState | null;
  mySecret: string | null;
  lastGuesses: GuessThePlayerGuessEvent[];

  attach: () => void;
  sync: () => void;
  pick: (name: string) => void;
  guess: (name: string) => void;
  reset: () => void;
}

const MAX_GUESS_HISTORY = 50;

export const useGuessThePlayerStore = create<GuessThePlayerStore>((set) => ({
  state: null,
  mySecret: null,
  lastGuesses: [],

  attach: () => {
    const socket = getSocket();
    socket.off("guessplayer:state");
    socket.off("guessplayer:yourSecret");
    socket.off("guessplayer:guessMade");

    socket.on("guessplayer:state", (state: GuessThePlayerPublicState) => set({ state }));
    socket.on("guessplayer:yourSecret", (payload: { name: string }) => set({ mySecret: payload.name }));
    socket.on("guessplayer:guessMade", (event: GuessThePlayerGuessEvent) =>
      set((s) => ({ lastGuesses: [...s.lastGuesses, event].slice(-MAX_GUESS_HISTORY) }))
    );
  },

  sync: () => {
    getSocket().emit("guessplayer:sync", (state: GuessThePlayerPublicState | null) => {
      if (state) set({ state });
    });
  },

  pick: (name: string) => {
    getSocket().emit("guessplayer:pick", { name });
  },

  guess: (name: string) => {
    getSocket().emit("guessplayer:guess", { name });
  },

  reset: () => set({ state: null, mySecret: null, lastGuesses: [] }),
}));
