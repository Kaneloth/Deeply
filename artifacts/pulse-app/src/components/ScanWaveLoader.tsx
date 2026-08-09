import { motion } from "framer-motion";
import { Heart } from "lucide-react";

const RING_COUNT = 3;
const RING_DURATION = 2.2; // seconds per ring's expand-and-fade cycle
const RING_STAGGER = RING_DURATION / RING_COUNT;

/** Radar/sonar-style expanding rings, used only for Discover's very
 *  first load of an app session — see the module-level flag in
 *  DiscoverPage.tsx. Gives the impression of actively "scanning" for
 *  matches rather than just showing a generic skeleton. */
export function ScanWaveLoader({ label = "Finding people near you..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20">
      <div className="relative w-40 h-40 flex items-center justify-center">
        {Array.from({ length: RING_COUNT }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute inset-0 rounded-full border-2 border-primary"
            initial={{ scale: 0.3, opacity: 0.8 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{
              duration: RING_DURATION,
              repeat: Infinity,
              ease: "easeOut",
              delay: i * RING_STAGGER,
            }}
          />
        ))}
        <div className="w-14 h-14 rounded-full bg-gradient-accent flex items-center justify-center shadow-lg z-10">
          <Heart size={22} className="text-white fill-white" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-6 font-medium">{label}</p>
    </div>
  );
}
