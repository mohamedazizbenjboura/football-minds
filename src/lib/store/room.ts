"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

// Guess The Player supports every team size 1v1..10v10 (PROJECT_SPEC.md
// §4/§5.1); every other game still only ever uses 1v1/2v2/ffa, but the
// room itself doesn't restrict mode by game, so the type covers all of them.
export type RoomMode =
  | "1v1"
  | "2v2"
  | "3v3"
  | "4v4"
  | "5v5"
  | "ffa";
// Every mode with two real sides — used to gate team-assignment UI on/off.
export const TEAM_MODES: RoomMode[] = [
  "1v1",
  "2v2",
  "3v3",
  "4v4",
  "5v5",
];

export interface RoomPlayer {
  socketId: string;
  displayName: string;
  ready: boolean;
  isHost: boolean;
  team?: 1 | 2;
  connected: boolean;
}

export interface ChatMessage {
  id: string;
  from: string;
  text: string;
  emoji?: string;
  ts: number;
}

export interface RoomState {
  code: string;
  mode: RoomMode;
  gameId: string | null;
  hostId: string;
  started: boolean;
  players: RoomPlayer[];
  chat: ChatMessage[];
}

interface RoomStore {
  room: RoomState | null;
  connecting: boolean;
  error: string | null;
  selfId: string | null;

  createRoom: (displayName: string, mode: RoomMode) => Promise<string | null>;
  joinRoom: (code: string, displayName: string) => Promise<boolean>;
  leaveRoom: () => void;
  setReady: (ready: boolean) => void;
  changeMode: (mode: RoomMode) => void;
  // Self-select onto Team 1/2 ahead of a team-mode match (host may pass a
  // playerId to assign someone else instead).
  assignTeam: (team: 1 | 2, playerId?: string) => void;
  changeGame: (gameId: string) => void;
  kick: (playerId: string) => void;
  startGame: () => Promise<string | null>;
  backToLobby: () => Promise<boolean>;
  sendChat: (text: string, emoji?: string) => void;
  clearError: () => void;
}

export const useRoomStore = create<RoomStore>((set, get) => {
  function attachListeners() {
    const socket = getSocket();
    socket.off("room:state");
    socket.off("room:kicked");
    socket.off("connect");
    socket.off("chat:message");

    socket.on("connect", () => set({ selfId: socket.id ?? null }));
    socket.on("room:state", (state: RoomState) => set({ room: state, connecting: false }));
    socket.on("room:kicked", () => set({ room: null, error: "You were removed from the room." }));
    // BUG FIX (live-problems.md): the server broadcasts `chat:message` as its
    // own event, separate from `room:state`. This listener was missing
    // entirely, so a new message never rendered live for either player —
    // it only ever showed up if some *other* unrelated `room:state`
    // broadcast happened to be re-sent afterward and its chat array
    // snapshot happened to include it by then. Append live instead.
    socket.on("chat:message", (message: ChatMessage) =>
      set((s) => (s.room ? { room: { ...s.room, chat: [...s.room.chat, message] } } : s))
    );
  }

  return {
    room: null,
    connecting: false,
    error: null,
    selfId: null,

    createRoom: async (displayName, mode) => {
      set({ connecting: true, error: null });
      const socket = getSocket();
      attachListeners();
      if (!socket.connected) socket.connect();

      return new Promise((resolve) => {
        socket.emit(
          "room:create",
          { displayName, mode },
          (res: { ok: boolean; code?: string; error?: string }) => {
            if (!res.ok) {
              set({ connecting: false, error: res.error ?? "Could not create room." });
              resolve(null);
              return;
            }
            resolve(res.code ?? null);
          }
        );
      });
    },

    joinRoom: async (code, displayName) => {
      set({ connecting: true, error: null });
      const socket = getSocket();
      attachListeners();
      if (!socket.connected) socket.connect();

      return new Promise((resolve) => {
        socket.emit(
          "room:join",
          { code, displayName },
          (res: { ok: boolean; error?: string }) => {
            if (!res.ok) {
              set({ connecting: false, error: res.error ?? "Could not join room." });
              resolve(false);
              return;
            }
            resolve(true);
          }
        );
      });
    },

    leaveRoom: () => {
      getSocket().emit("room:leave");
      getSocket().disconnect();
      set({ room: null, selfId: null });
    },

    setReady: (ready) => getSocket().emit("room:ready", { ready }),
    changeMode: (mode) => getSocket().emit("room:changeMode", { mode }),
    assignTeam: (team, playerId) => getSocket().emit("room:assignTeam", { team, playerId }),
    changeGame: (gameId) => getSocket().emit("room:changeGame", { gameId }),
    kick: (playerId) => getSocket().emit("room:kick", { playerId }),

    startGame: () =>
      new Promise((resolve) => {
        getSocket().emit("room:start", (res: { ok: boolean; error?: string }) => {
          if (!res.ok) {
            set({ error: res.error ?? "Could not start the game." });
            resolve(null);
            return;
          }
          resolve(get().room?.gameId ?? null);
        });
      }),

    backToLobby: () =>
      new Promise((resolve) => {
        getSocket().emit("room:backToLobby", {}, (res: { ok: boolean; error?: string }) => {
          if (!res.ok) {
            set({ error: res.error ?? "Could not return to lobby." });
            resolve(false);
            return;
          }
          resolve(true);
        });
      }),

    sendChat: (text, emoji) => getSocket().emit("chat:message", { text, emoji }),
    clearError: () => set({ error: null }),
  };
});
