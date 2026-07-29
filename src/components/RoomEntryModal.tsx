"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Users2, Swords, Grid3x3, Loader2 } from "lucide-react";
import { useRoomStore, type RoomMode } from "@/lib/store/room";

const DISPLAY_NAME_KEY = "fm:displayName";

const MODES: { id: RoomMode; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "1v1", label: "1v1", hint: "Head to head", icon: <Swords size={18} /> },
  { id: "2v2", label: "2v2", hint: "Team up", icon: <Users2 size={18} /> },
  { id: "ffa", label: "Free-For-All", hint: "Up to 50 players", icon: <Grid3x3 size={18} /> },
];

interface RoomEntryModalProps {
  mode: "create" | "join";
  onClose: () => void;
}

export default function RoomEntryModal({ mode, onClose }: RoomEntryModalProps) {
  const router = useRouter();
  const { createRoom, joinRoom, error, clearError } = useRoomStore();

  const [displayName, setDisplayName] = useState(
    () => (typeof window !== "undefined" && localStorage.getItem(DISPLAY_NAME_KEY)) || ""
  );
  const [roomCode, setRoomCode] = useState("");
  const [roomMode, setRoomMode] = useState<RoomMode>("ffa");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim().slice(0, 24);
    if (!name) return;

    clearError();
    setSubmitting(true);
    localStorage.setItem(DISPLAY_NAME_KEY, name);

    if (mode === "create") {
      const code = await createRoom(name, roomMode);
      setSubmitting(false);
      if (code) router.push(`/room/${code}`);
      return;
    }

    const code = roomCode.trim().toUpperCase();
    if (!code) {
      setSubmitting(false);
      return;
    }
    const ok = await joinRoom(code, name);
    setSubmitting(false);
    if (ok) router.push(`/room/${code}`);
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="glass w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 relative"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-gray-400 hover:text-white transition-colors p-2 -m-2"
            aria-label="Close"
          >
            <X size={22} />
          </button>

          <h2 className="text-2xl font-bold mb-1">
            {mode === "create" ? "Create a Room" : "Join a Room"}
          </h2>
          <p className="text-gray-400 text-sm mb-6">
            {mode === "create"
              ? "Set up a lobby and invite your friends."
              : "Enter the invite code your host shared."}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-gray-300">Display name</span>
              <input
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={24}
                placeholder="e.g. Mbappe7x"
                className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none transition-colors placeholder:text-gray-500"
              />
            </label>

            {mode === "join" && (
              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-gray-300">Room code</span>
                <input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="e.g. MBAPPE"
                  className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10 focus:border-[var(--color-primary)] outline-none transition-colors placeholder:text-gray-500 tracking-[0.3em] font-mono uppercase text-center"
                />
              </label>
            )}

            {mode === "create" && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-gray-300">Mode</span>
                <div className="grid grid-cols-3 gap-2">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setRoomMode(m.id)}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-colors ${
                        roomMode === m.id
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "border-white/10 bg-white/5 text-gray-300 hover:border-white/20"
                      }`}
                    >
                      {m.icon}
                      <span className="text-xs font-bold">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !displayName.trim() || (mode === "join" && !roomCode.trim())}
              className="w-full h-14 rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold text-lg flex items-center justify-center gap-2 transition-colors"
            >
              {submitting ? (
                <Loader2 size={20} className="animate-spin" />
              ) : mode === "create" ? (
                "Create Room"
              ) : (
                "Join Room"
              )}
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
