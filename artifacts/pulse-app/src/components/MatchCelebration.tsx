import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

const CONFETTI_EMOJI = ["✨", "💫", "⭐", "🎉", "💗"];

function ConfettiBurst() {
  const pieces = Array.from({ length: 16 }).map((_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    const distance = 120 + Math.random() * 100;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    return { id: i, x, y, emoji: CONFETTI_EMOJI[i % CONFETTI_EMOJI.length], delay: Math.random() * 0.15 };
  });

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute text-2xl"
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.5 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 1.2, rotate: 180 }}
          transition={{ duration: 1.3, delay: p.delay, ease: "easeOut" }}
        >
          {p.emoji}
        </motion.span>
      ))}
    </div>
  );
}

export function MatchCelebration({
  name,
  photoUrl,
  onContinue,
  onMessage,
}: {
  name: string;
  photoUrl?: string | null;
  onContinue: () => void;
  onMessage: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md flex flex-col items-center justify-center px-6 text-center overflow-hidden"
    >
      <ConfettiBurst />

      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 12 }}
        className="relative z-10"
      >
        {/* Pulsing glow ring behind the photo/icon */}
        <div className="relative w-28 h-28 mx-auto mb-6">
          <motion.div
            className="absolute inset-0 rounded-full bg-gradient-accent blur-xl"
            animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0.9, 0.6] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
          {photoUrl ? (
            <motion.img
              src={photoUrl}
              alt={name}
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", damping: 10, delay: 0.1 }}
              className="relative w-28 h-28 rounded-full object-cover border-4 border-background shadow-2xl"
            />
          ) : (
            <motion.div
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", damping: 8, delay: 0.1 }}
              className="relative w-28 h-28 rounded-full bg-gradient-accent flex items-center justify-center text-5xl shadow-2xl"
            >
              💥
            </motion.div>
          )}
        </div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="text-4xl font-['Syne'] font-extrabold text-primary mb-3"
        >
          It's a Match!
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="text-muted-foreground mb-10"
        >
          You and {name} liked each other. Say hi!
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="w-full max-w-xs space-y-3"
        >
          <Button
            onClick={onMessage}
            className="w-full h-14 rounded-2xl bg-gradient-accent border-0 text-white font-bold text-lg shadow-[0_8px_20px_rgba(225,29,72,0.3)] active:scale-95 transition-transform"
          >
            Send a Message
          </Button>
          <button
            onClick={onContinue}
            className="w-full h-12 rounded-2xl text-muted-foreground font-semibold hover:text-foreground transition-colors"
          >
            Keep Browsing
          </button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
