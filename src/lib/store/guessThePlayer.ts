"use client";

/**
 * Client state for Guess The Player — PROJECT_SPEC.md §5.1 "Guess The Player".
 * Mirrors the server-authoritative public state broadcast from
 * server/index.ts, plus the private pieces that only ever arrive via a
 * direct emit to this socket (or this socket's team room), never the
 * room-wide broadcast — so a team's pick never leaks to the opposing team
 * through this store either.
 */

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

export type GuessThePlayerPhase = "picking" | "playing" | "gameEnd";

export interface GuessThePlayerPublicState {
  order: string[]; // every participating socketId, both teams combined
  teamOf: Record<string, 1 | 2>;
  leaders: { 1: string | null; 2: string | null };
  agreedIds: string[]; // teammates who've agreed to their team's CURRENT proposal
  locked: { 1: boolean; 2: boolean };
  phase: GuessThePlayerPhase;
  winnerTeam: 1 | 2 | null;
  winnerId: string | null;
  forfeited: boolean;
  secrets: Record<"1" | "2", string | null> | null; // revealed only once phase === "gameEnd"
}

export interface GuessThePlayerGuessEvent {
  playerId: string;
  displayName: string;
  guess: string;
}

export interface TeamChatMessage {
  id: string;
  from: string;
  text: string;
  ts: number;
}

interface GuessThePlayerStore {
  state: GuessThePlayerPublicState | null;
  myTeamProposal: string | null; // my OWN team's current proposed/locked secret, private
  lastGuesses: GuessThePlayerGuessEvent[];
  teamChat: TeamChatMessage[];

  attach: () => void;
  sync: () => void;
  syncTeamChat: () => void;
  pick: (name: string) => void;
  agree: () => void;
  guess: (name: string) => void;
  sendTeamChat: (text: string) => void;
  reset: () => void;
}

const MAX_GUESS_HISTORY = 50;

export const useGuessThePlayerStore = create<GuessThePlayerStore>((set) => ({
  state: null,
  myTeamProposal: null,
  lastGuesses: [],
  teamChat: [],

  attach: () => {
    const socket = getSocket();
    socket.off("guessplayer:state");
    socket.off("guessplayer:teamSecret");
    socket.off("guessplayer:guessMade");
    socket.off("teamchat:message");

    socket.on("guessplayer:state", (state: GuessThePlayerPublicState) => set({ state }));
    socket.on("guessplayer:teamSecret", (payload: { name: string | null }) =>
      set({ myTeamProposal: payload.name })
    );
    socket.on("guessplayer:guessMade", (event: GuessThePlayerGuessEvent) =>
      set((s) => ({ lastGuesses: [...s.lastGuesses, event].slice(-MAX_GUESS_HISTORY) }))
    );
    socket.on("teamchat:message", (message: TeamChatMessage) =>
      set((s) => ({ teamChat: [...s.teamChat, message] }))
    );
  },

  sync: () => {
    getSocket().emit("guessplayer:sync", (state: GuessThePlayerPublicState | null) => {
      if (state) set({ state });
    });
  },

  syncTeamChat: () => {
    getSocket().emit("teamchat:sync", (messages: TeamChatMessage[] | null) => {
      set({ teamChat: messages ?? [] });
    });
  },

  // Propose a candidate for my team (leader only — the server enforces
  // this, this just fires the event). For a team of 1 (1v1) this is
  // instant and final, exactly like the old flow.
  pick: (name: string) => {
    getSocket().emit("guessplayer:pick", { name });
  },

  // A non-leader teammate agreeing to the team's CURRENT proposal.
  agree: () => {
    getSocket().emit("guessplayer:agree");
  },

  guess: (name: string) => {
    getSocket().emit("guessplayer:guess", { name });
  },

  sendTeamChat: (text: string) => {
    getSocket().emit("teamchat:message", { text });
  },

  reset: () => set({ state: null, myTeamProposal: null, lastGuesses: [], teamChat: [] }),
}));
