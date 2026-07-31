/**
 * Single source of truth for the 7 games — PROJECT_SPEC.md §5.
 * `id` matches the GameId union in server/index.ts and the /game/[id] route segment.
 */

export interface GameDef {
  id: string;
  icon: string;
  title: string;
  description: string;
  players: string;
  difficulty: "Easy" | "Medium" | "Hard" | "Expert";
  duration: string;
}

export const GAMES: GameDef[] = [
  {
    id: "guess-the-player",
    icon: "🧠",
    title: "Guess The Player",
    description: "20 Questions style. Deduction only. No hints.",
    players: "2-10",
    difficulty: "Medium",
    duration: "5 min",
  },
  {
    id: "who-am-i",
    icon: "👤",
    title: "Who Am I?",
    description: "Clues appear gradually. First to guess wins.",
    players: "2-10",
    difficulty: "Hard",
    duration: "3 min",
  },
  {
    id: "career-maze",
    icon: "🏟️",
    title: "Career Maze",
    description: "Identify the player from their club timeline.",
    players: "2-10",
    difficulty: "Expert",
    duration: "2 min",
  },
  {
    id: "last-man-standing",
    icon: "🔥",
    title: "Last Man Standing",
    description: "Duplicate answers eliminate you. Survive to win.",
    players: "4-20",
    difficulty: "Medium",
    duration: "10 min",
  },
  {
    id: "football-pyramid",
    icon: "🧩",
    title: "Football Pyramid",
    description: "Guess early for more points as clues appear.",
    players: "2-10",
    difficulty: "Hard",
    duration: "5 min",
  },
  {
    id: "the-chain",
    icon: "🔗",
    title: "The Chain",
    description: "Name teammates. Build the chain. Don't break it.",
    players: "2-8",
    difficulty: "Expert",
    duration: "15 min",
  },
  {
    id: "shirt-madness",
    icon: "👕",
    title: "Shirt Number Madness",
    description: "Name players by shirt number. Unique answers score.",
    players: "2-10",
    difficulty: "Medium",
    duration: "5 min",
  },
];

export function gameById(id: string | null | undefined): GameDef | undefined {
  return GAMES.find((g) => g.id === id);
}
