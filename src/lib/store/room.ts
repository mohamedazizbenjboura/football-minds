"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

export type RoomMode = "1v1" | "2v2" | "ffa";

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
  changeGame: (gameId: string) => void;
  kick: (playerId: string) => void;
  startGame: () => Promise<string | null>;
  sendChat: (text: string, emoji?: string) => void;
  clearError: () => void;
}

export const useRoomStore = create<RoomStore>((set, get) => {
  function attachListeners() {
    const socket = getSocket();
    socket.off("room:state");
    socket.off("room:kicked");
    socket.off("connect");

    socket.on("connect", () => set({ selfId: socket.id ?? null }));
    socket.on("room:state", (state: RoomState) => set({ room: state, connecting: false }));
    socket.on("room:kicked", () => set({ room: null, error: "You were removed from the room." }));
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

    sendChat: (text, emoji) => getSocket().emit("chat:message", { text, emoji }),
    clearError: () => set({ error: null }),
  };
});
