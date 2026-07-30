"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Users, Gamepad2, Shuffle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GAMES } from "@/lib/games";
import RoomEntryModal from "@/components/RoomEntryModal";
import HeroPlayerWall from "@/components/HeroPlayerWall";

export default function Home() {
  const router = useRouter();
  const [modal, setModal] = useState<"create" | "join" | null>(null);

  function playRandom() {
    const game = GAMES[Math.floor(Math.random() * GAMES.length)];
    router.push(`/game/${game.id}`);
  }

  return (
    <main className="min-h-screen flex flex-col items-center pb-20">
      {/* Hero Section — stadium-under-lights backdrop + FIFA-cover player wall */}
      <section className="stadium-lights relative w-full flex flex-col items-center pt-16 pb-2 px-4 overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 flex flex-col items-center text-center"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass text-[var(--color-primary)] font-semibold text-sm mb-6 border border-[var(--color-primary)]/20">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-primary)] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--color-primary)]"></span>
            </span>
            Live Multiplayer
          </div>
          <h1 className="hero-headline text-6xl sm:text-7xl md:text-8xl uppercase leading-[1.05] pt-2 mb-4">
            Football <span className="text-[var(--color-primary)]">Minds</span>
          </h1>
          <p className="text-lg md:text-2xl text-gray-400 mb-8 max-w-2xl font-light">
            The Ultimate Football Party Game.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setModal("create")}
              className="flex items-center justify-center gap-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] text-black px-8 py-4 rounded-full font-bold text-lg transition-colors"
            >
              <Gamepad2 size={24} />
              Create Room
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setModal("join")}
              className="flex items-center justify-center gap-2 glass hover:bg-white/10 px-8 py-4 rounded-full font-bold text-lg transition-colors"
            >
              <Users size={24} />
              Join Room
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={playRandom}
              className="flex items-center justify-center gap-2 border border-white/20 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] px-8 py-4 rounded-full font-bold text-lg transition-colors"
            >
              <Shuffle size={24} />
              Play Random
            </motion.button>
          </div>
        </motion.div>

        <HeroPlayerWall />
      </section>

      {/* Games Grid */}
      <div className="w-full max-w-7xl mx-auto px-4 mt-10">
        <h2 className="text-2xl font-bold mb-8 pl-2 border-l-4 border-[var(--color-primary)]">Select a Game</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {GAMES.map((game, index) => (
            <motion.div
              key={game.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
            >
              <Link href={`/game/${game.id}`}>
                <div className="glass rounded-3xl p-6 h-full flex flex-col hover:-translate-y-2 transition-transform duration-300 group cursor-pointer border border-white/5 hover:border-[var(--color-primary)]/50 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--color-primary)]/10 rounded-bl-full -z-10 transition-transform group-hover:scale-110"></div>

                  <div className="text-4xl mb-4 group-hover:scale-110 transition-transform origin-left">
                    {game.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-2 group-hover:text-[var(--color-primary)] transition-colors">
                    {game.title}
                  </h3>
                  <p className="text-gray-400 text-sm mb-6 flex-grow">
                    {game.description}
                  </p>

                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/10 text-xs text-gray-300">
                    <div className="flex gap-3">
                      <span className="flex items-center gap-1"><Users size={14}/> {game.players}</span>
                      <span className="bg-white/10 px-2 py-1 rounded-md">{game.difficulty}</span>
                    </div>
                    <ArrowRight className="opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-[var(--color-primary)]" size={20} />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {modal && <RoomEntryModal mode={modal} onClose={() => setModal(null)} />}
    </main>
  );
}
