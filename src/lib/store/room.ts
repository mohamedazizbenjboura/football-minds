"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket";

// BUG FIX (live-problems.md — "No active room" on Guess The Player after
// Start Game, live only): a hard `window.location.href` reload (needed by
// the room:started redirect — see that fix's comment in
// src/app/room/[code]/page.tsx) always disconnects the socket and
// reconnects under a brand-new socket.id. The server now supports
// reclaiming your OLD seat via room:rejoin, but it needs a token that
// survives the reload to prove "this is the same player" — sessionStorage
// is the right place: it's stable across a reload of the SAME tab (unlike
// state kept only in memory) but distinct per tab (unlike localStorage,
// which DISPLAY_NAME_KEY already deliberately shares across tabs so two
// tabs in one browser can each pick their own name). Keyed per room code so
// a stale token from a long-finished room never gets reused.
function tokenKey(code: string): string {
  return `fm:playerToken:${code}`;
}

function getStoredToken(code: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(tokenKey(code));
}

function storeToken(code: string, token: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(tokenKey(code), token);
}

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
  // Who Am I?'s host-picked round count (10/15/20) — present on every
  // room, only meaningful when gameId === "who-am-i".
  whoAmIRounds: number;
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
  // BUG FIX (live-problems.md): reclaim a seat in an already-started room
  // after a hard reload, using the token sessionStorage remembers for that
  // room code. Returns false (rather than throwing) if there's no token to
  // try, or the server says the reconnect window has already passed —
  // callers should fall back to sending the person home in either case.
  rejoin: (code: string) => Promise<boolean>;
  leaveRoom: () => void;
  setReady: (ready: boolean) => void;
  changeMode: (mode: RoomMode) => void;
  // Who Am I? round-count picker (10/15/20), host-only, pre-start.
  setWhoAmIRounds: (rounds: 10 | 15 | 20) => void;
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
          (res: { ok: boolean; code?: string; token?: string; error?: string }) => {
            if (!res.ok) {
              set({ connecting: false, error: res.error ?? "Could not create room." });
              resolve(null);
              return;
            }
            if (res.code && res.token) storeToken(res.code, res.token);
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
          (res: { ok: boolean; code?: string; token?: string; error?: string }) => {
            if (!res.ok) {
              set({ connecting: false, error: res.error ?? "Could not join room." });
              resolve(false);
              return;
            }
            if (res.code && res.token) storeToken(res.code, res.token);
            resolve(true);
          }
        );
      });
    },

    // BUG FIX (live-problems.md): used by /game/[id]'s mount effect when it
    // finds no room in the store yet (the normal case right after a hard
    // reload). Silently resolves false — no error state set — when there's
    // simply no token to try, since that's an expected, non-error path (a
    // brand-new tab landing on a game URL with nothing to reclaim).
    rejoin: async (code) => {
      const token = getStoredToken(code);
      if (!token) return false;

      set({ connecting: true, error: null });
      const socket = getSocket();
      attachListeners();
      if (!socket.connected) socket.connect();

      return new Promise((resolve) => {
        socket.emit(
          "room:rejoin",
          { code, token },
          (res: { ok: boolean; error?: string }) => {
            if (!res.ok) {
              set({ connecting: false, error: res.error ?? "Could not reconnect." });
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
    setWhoAmIRounds: (rounds) => getSocket().emit("room:setWhoAmIRounds", { rounds }),
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
