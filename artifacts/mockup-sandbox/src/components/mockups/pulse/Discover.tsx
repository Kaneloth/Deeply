import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Flame, Lock, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Discover() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [progress, setProgress] = useState(0);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (isPlaying) {
      let start = Date.now();
      const animate = () => {
        const elapsed = Date.now() - start;
        setProgress((elapsed % 15000) / 150);
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-950 p-4 font-sans selection:bg-[#E11D48]/30">
      <div className="w-[390px] h-[844px] bg-[#0A0A0A] rounded-[48px] shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden relative border-[8px] border-zinc-900 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-14 pb-2 z-10">
          <div className="flex flex-col">
            <span className="text-zinc-500 text-[11px] font-bold tracking-widest uppercase mb-0.5">Today's Match</span>
            <span className="text-zinc-100 text-lg font-bold tracking-tight">Oct 24, 2023</span>
          </div>
          <div className="flex items-center gap-1.5 bg-zinc-900/80 px-3.5 py-1.5 rounded-full border border-zinc-800 backdrop-blur-md shadow-sm">
            <span className="text-[#E11D48] text-sm font-bold font-mono tracking-tighter">32</span>
            <Flame className="w-4 h-4 text-[#E11D48]" fill="currentColor" strokeWidth={1.5} />
          </div>
        </div>

        {/* Card */}
        <div className="flex-1 px-5 mt-4 mb-2 relative flex flex-col justify-center">
          <div className="relative w-full h-full max-h-[520px] rounded-[32px] overflow-hidden bg-zinc-900 border border-zinc-800 shadow-2xl group">
            <div className="absolute inset-0 z-0 bg-zinc-800">
               <img 
                 src="/__mockup/images/placeholder-maya.jpg" 
                 alt="Match" 
                 className={cn(
                   "w-full h-full object-cover transition-all duration-1000 ease-[cubic-bezier(0.2,0.8,0.2,1)]", 
                   !revealed ? "blur-2xl scale-110 opacity-60 mix-blend-luminosity brightness-75" : "blur-0 scale-100 brightness-100"
                 )} 
               />
               {!revealed && <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A]/90 via-[#0A0A0A]/40 to-transparent mix-blend-multiply" />}
               {!revealed && <div className="absolute inset-0 bg-[#E11D48]/10 mix-blend-screen" />}
               {revealed && <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A]/80 via-transparent to-transparent" />}
            </div>

            <div className="absolute inset-0 z-10 flex flex-col justify-between p-5">
              <div className="flex justify-between items-start">
                {!revealed && (
                  <div className="bg-black/30 backdrop-blur-xl w-10 h-10 rounded-full flex items-center justify-center border border-white/10 shadow-lg">
                    <Lock className="w-4 h-4 text-white/80" />
                  </div>
                )}
                <div className={cn(
                  "bg-black/30 backdrop-blur-xl px-3 py-1.5 rounded-full flex items-center gap-1.5 border border-white/10 shadow-lg transition-all duration-500",
                  revealed ? "ml-auto" : "ml-auto"
                )}>
                  <MapPin className="w-3 h-3 text-zinc-300" />
                  <span className="text-xs font-medium text-zinc-200">3.2 km away</span>
                </div>
              </div>

              <div className="flex flex-col gap-4 transform transition-all duration-500">
                <div className="drop-shadow-md">
                  <h2 className="text-[32px] leading-none font-bold text-white tracking-tight flex items-baseline gap-2">
                    Maya <span className="text-2xl font-medium text-zinc-300">26</span>
                  </h2>
                </div>

                <div className="bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-4 flex flex-col gap-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                  <p className="text-[14px] font-medium text-zinc-100 leading-snug">"What's a boring thing you find fascinating?"</p>
                  
                  <div className="flex items-center gap-4 relative z-10">
                    <button 
                      onClick={() => setIsPlaying(!isPlaying)}
                      className={cn(
                        "w-12 h-12 flex-shrink-0 transition-all duration-300 rounded-full flex items-center justify-center border",
                        isPlaying 
                          ? "bg-transparent border-[#E11D48] text-[#E11D48]" 
                          : "bg-[#E11D48] border-[#E11D48] text-white hover:bg-[#BE123C] shadow-[0_0_20px_rgba(225,29,72,0.4)]"
                      )}
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5" fill="currentColor" />
                      ) : (
                        <Play className="w-5 h-5 ml-1" fill="currentColor" />
                      )}
                    </button>
                    
                    <div className="flex-1 flex items-center gap-[3px] h-8 relative">
                      {/* Waveform */}
                      {Array.from({ length: 32 }).map((_, i) => {
                        const baseHeight = 20 + Math.sin(i * 0.5) * 15 + Math.cos(i * 1.2) * 10;
                        const active = isPlaying && ((progress / 100) * 32 > i);
                        const current = isPlaying ? (Math.random() * 20 - 10) : 0;
                        
                        return (
                          <div
                            key={i}
                            className="flex-1 rounded-full transition-all duration-100 ease-out"
                            style={{
                              height: `${Math.max(15, Math.min(100, baseHeight + current))}%`,
                              backgroundColor: active ? '#E11D48' : 'rgba(255,255,255,0.2)',
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 pb-12 pt-4 flex flex-col gap-5 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A] to-transparent">
          <div className="flex items-center justify-center gap-2.5">
            <div className="relative flex items-center justify-center w-3 h-3">
              <div className="absolute inset-0 rounded-full bg-[#E11D48] animate-ping opacity-75" />
              <div className="relative w-2 h-2 rounded-full bg-[#E11D48] shadow-[0_0_12px_rgba(225,29,72,1)]" />
            </div>
            <span className="text-[13px] font-medium text-zinc-400 tracking-wide font-mono uppercase">
              Match expires in <span className="text-zinc-100 font-bold ml-1">23:41:07</span>
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <button className="w-full bg-[#E11D48] hover:bg-[#BE123C] text-white py-4 rounded-[20px] font-bold text-[17px] tracking-wide active:scale-[0.98] transition-all shadow-[0_4px_24px_rgba(225,29,72,0.25)] border border-[#E11D48]/50">
              Match Blind
            </button>
            {!revealed ? (
              <button 
                onClick={() => setRevealed(true)}
                className="w-full bg-transparent border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 text-zinc-300 py-4 rounded-[20px] font-semibold text-[15px] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                Reveal Photo 
                <span className="flex items-center text-zinc-500 text-sm font-normal">
                  — 2 <Flame className="w-3.5 h-3.5 ml-0.5 text-zinc-500" />
                </span>
              </button>
            ) : (
              <button 
                disabled
                className="w-full bg-zinc-900/50 border border-transparent text-zinc-600 py-4 rounded-[20px] font-semibold text-[15px] flex items-center justify-center gap-2 cursor-not-allowed"
              >
                Photo Revealed
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
