import React from 'react';
import { ArrowLeft, Play, Unlock, Heart, Book, Moon, Coffee } from 'lucide-react';

export function Profile() {
  return (
    <div className="relative w-[390px] h-[844px] bg-zinc-950 overflow-hidden font-sans">
      {/* iOS Status Bar */}
      <div className="absolute top-0 left-0 right-0 h-11 bg-transparent z-50 flex items-center justify-between px-6 text-white text-[15px]">
        <span className="font-semibold">9:41</span>
        <div className="flex items-center gap-1">
          <div className="w-4 h-3 border border-white rounded-sm" />
          <div className="w-6 h-3 border border-white rounded-sm" />
          <div className="w-6 h-3 bg-white rounded-sm" />
        </div>
      </div>

      {/* Header */}
      <div className="absolute top-11 left-0 right-0 h-14 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/50 z-40 flex items-center justify-between px-4">
        <button className="w-10 h-10 flex items-center justify-center">
          <ArrowLeft className="w-6 h-6 text-zinc-100" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-zinc-100 font-medium text-[17px]">New Match</span>
          <div className="relative">
            <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
            <div className="absolute inset-0 w-2 h-2 bg-rose-500 rounded-full animate-ping" />
          </div>
        </div>
        <div className="w-10" />
      </div>

      {/* Scrollable Content */}
      <div className="absolute top-[104px] bottom-24 left-0 right-0 overflow-y-auto">
        {/* Profile Photo Section */}
        <div className="relative h-[380px] w-full">
          <img 
            src="/__mockup/images/pulse-profile-maya.jpg" 
            alt="Maya"
            className="w-full h-full object-cover"
          />
          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
          
          {/* Floating Name Chip */}
          <div className="absolute bottom-6 left-4 right-4 flex items-end justify-between">
            <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/50 rounded-2xl px-5 py-3 shadow-2xl">
              <div className="flex items-baseline gap-3">
                <span className="text-white text-2xl font-bold">Maya</span>
                <span className="text-zinc-400 text-xl">26</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-1 h-1 bg-rose-500 rounded-full" />
                <span className="text-zinc-400 text-sm">3.2 km away</span>
              </div>
            </div>
          </div>
        </div>

        {/* Details Panel */}
        <div className="px-4 pb-8 space-y-6">
          {/* Personality Tags */}
          <div className="flex flex-wrap gap-2 pt-6">
            {['Sarcastic', 'Curious', 'Night Owl', 'Coffee Snob'].map((tag) => (
              <div 
                key={tag}
                className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-zinc-300 text-sm font-medium"
              >
                {tag}
              </div>
            ))}
          </div>

          {/* Audio Prompt 1 */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 space-y-4">
            <div className="text-zinc-400 text-sm font-medium">
              What's a boring thing you find fascinating?
            </div>
            <div className="flex items-center gap-4">
              <button className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-500 to-violet-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
                <Play className="w-5 h-5 text-white fill-white ml-0.5" />
              </button>
              <div className="flex-1 flex items-center gap-1 h-12">
                {[4, 8, 3, 9, 5, 7, 4, 8, 6, 9, 5, 7, 3, 8, 4, 6, 9, 5, 7, 4, 8, 3, 6, 5, 7, 4, 8, 9, 5, 6].map((height, i) => (
                  <div 
                    key={i}
                    className="flex-1 bg-gradient-to-t from-rose-500 to-violet-500 rounded-full opacity-70"
                    style={{ height: `${height * 4}px` }}
                  />
                ))}
              </div>
              <span className="text-zinc-500 text-sm font-mono">0:32</span>
            </div>
          </div>

          {/* Audio Prompt 2 */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 space-y-4">
            <div className="text-zinc-400 text-sm font-medium">
              What's your 3am guilty pleasure?
            </div>
            <div className="flex items-center gap-4">
              <button className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-500 to-violet-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
                <Play className="w-5 h-5 text-white fill-white ml-0.5" />
              </button>
              <div className="flex-1 flex items-center gap-1 h-12">
                {[6, 4, 7, 5, 8, 4, 9, 6, 5, 7, 8, 4, 6, 9, 5, 7, 4, 8, 5, 6, 9, 4, 7, 5, 8, 6, 4, 7, 9, 5].map((height, i) => (
                  <div 
                    key={i}
                    className="flex-1 bg-gradient-to-t from-rose-500 to-violet-500 rounded-full opacity-70"
                    style={{ height: `${height * 4}px` }}
                  />
                ))}
              </div>
              <span className="text-zinc-500 text-sm font-mono">0:28</span>
            </div>
          </div>

          {/* Integrity Score */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-zinc-100 font-semibold text-base">Integrity Score</span>
              <span className="text-2xl font-bold bg-gradient-to-r from-rose-500 to-violet-500 bg-clip-text text-transparent">94/100</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-rose-500 to-violet-500 rounded-full"
                style={{ width: '94%' }}
              />
            </div>
            <p className="text-zinc-500 text-xs leading-relaxed">
              Built from post-date feedback. High scores show consistency, respect, and genuine connection.
            </p>
          </div>

          {/* Mutual Vibes */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 space-y-4">
            <div className="text-zinc-100 font-semibold text-base">Mutual Vibes</div>
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-center gap-2">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500/20 to-violet-500/20 border border-rose-500/30 flex items-center justify-center">
                  <Book className="w-7 h-7 text-rose-400" />
                </div>
                <span className="text-zinc-400 text-xs">Reading</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500/20 to-violet-500/20 border border-rose-500/30 flex items-center justify-center">
                  <Moon className="w-7 h-7 text-rose-400" />
                </div>
                <span className="text-zinc-400 text-xs">Late Nights</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500/20 to-violet-500/20 border border-rose-500/30 flex items-center justify-center">
                  <Coffee className="w-7 h-7 text-rose-400" />
                </div>
                <span className="text-zinc-400 text-xs">Coffee</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-zinc-950/95 backdrop-blur-xl border-t border-zinc-800/50 px-4 py-4 pb-8 space-y-3">
        <button className="w-full h-14 bg-gradient-to-r from-rose-500 to-violet-600 rounded-2xl font-semibold text-white text-base shadow-lg shadow-rose-500/30 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
          <Unlock className="w-5 h-5" />
          Start Chat — 1 Key
        </button>
        <button className="w-full h-14 bg-transparent border-2 border-zinc-700 rounded-2xl font-semibold text-zinc-300 text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
          <Heart className="w-5 h-5" />
          Send Crush Confession
        </button>
        <div className="text-center text-zinc-500 text-xs">
          1 free key remaining today
        </div>
      </div>
    </div>
  );
}
