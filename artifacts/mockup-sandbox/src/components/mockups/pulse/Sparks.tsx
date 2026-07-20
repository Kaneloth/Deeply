import React from "react";
import { ArrowLeft, Sparkles, Check, Lock, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function Sparks() {
  return (
    <div className="w-[390px] h-[844px] bg-zinc-950 text-white font-sans relative overflow-hidden">
      {/* iOS Status Bar */}
      <div className="absolute top-0 left-0 right-0 h-11 bg-zinc-950/95 backdrop-blur-sm z-50 flex items-center justify-between px-6 text-xs text-white/90">
        <span className="font-semibold">9:41</span>
        <div className="flex items-center gap-1">
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
            <rect x="0.5" y="1" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1"/>
            <path d="M16.5 4V8C17 8 17.5 7.5 17.5 6.5V5.5C17.5 4.5 17 4 16.5 4Z" fill="currentColor"/>
            <rect x="2" y="2.5" width="12" height="7" rx="1" fill="currentColor"/>
          </svg>
        </div>
      </div>

      {/* Header */}
      <div className="absolute top-11 left-0 right-0 h-14 bg-zinc-950/80 backdrop-blur-md border-b border-white/5 flex items-center px-4 z-40">
        <button className="w-10 h-10 flex items-center justify-center -ml-2">
          <ArrowLeft className="w-6 h-6 text-white" />
        </button>
        <h1 className="flex-1 text-center text-lg font-bold tracking-tight pr-10">
          Sparks Wallet
        </h1>
      </div>

      {/* Content */}
      <div className="absolute top-[100px] left-0 right-0 bottom-0 overflow-y-auto">
        <div className="px-4 pb-32">
          {/* Hero Balance */}
          <div className="relative mt-6 mb-8">
            <div className="absolute inset-0 bg-gradient-to-br from-rose-500/20 via-violet-600/20 to-fuchsia-600/20 rounded-3xl blur-xl" />
            <div className="relative bg-gradient-to-br from-zinc-900 to-zinc-950 rounded-3xl p-8 border border-white/10">
              <div className="flex items-center justify-center mb-2">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-500 to-violet-600 flex items-center justify-center mr-3">
                  <Sparkles className="w-6 h-6 text-white" fill="white" />
                </div>
                <div className="text-7xl font-black tracking-tight bg-gradient-to-br from-rose-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-display, system-ui)' }}>
                  32
                </div>
              </div>
              <div className="text-center text-white/60 text-sm font-medium mb-4">
                Sparks available
              </div>
              <div className="flex items-center justify-center gap-6 text-xs">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span className="font-semibold">+10 earned this week</span>
                </div>
                <div className="text-white/40">
                  <span className="font-semibold">-8 spent this week</span>
                </div>
              </div>
            </div>
          </div>

          {/* Daily Earn Card */}
          <div className="mb-8">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              Earn free Sparks today
              <Sparkles className="w-4 h-4 text-violet-400" />
            </h2>
            <Card className="bg-zinc-900 border-white/10 p-4 space-y-3">
              {/* Daily Login - Claimed */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">Daily login</div>
                    <div className="text-xs text-white/50">Claimed today</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-emerald-400 font-bold">
                  <Sparkles className="w-3.5 h-3.5" fill="currentColor" />
                  <span>+1</span>
                </div>
              </div>

              {/* Post-Date Feedback - Pending */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/50 border border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-violet-400" fill="currentColor" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">Post-date feedback</div>
                    <div className="text-xs text-white/50">How was your last date?</div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1 text-violet-400 font-bold text-sm">
                    <Sparkles className="w-3.5 h-3.5" fill="currentColor" />
                    <span>+2</span>
                  </div>
                  <Button size="sm" className="h-7 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0">
                    Give feedback
                  </Button>
                </div>
              </div>

              {/* Profile Complete - Locked */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/30 border border-white/5 opacity-60">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-700/50 flex items-center justify-center">
                    <Lock className="w-5 h-5 text-white/40" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">Complete your profile</div>
                    <div className="text-xs text-white/50">80% complete</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-white/40 font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>+5</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Purchase Bundles */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Purchase Sparks</h2>
              <Badge className="bg-emerald-950 text-emerald-400 border-emerald-500/30 text-xs px-2 py-0.5">
                No auto-renewal. Ever.
              </Badge>
            </div>
            
            <div className="space-y-3">
              {/* Starter Pack */}
              <Card className="bg-zinc-900 border-white/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-white">Starter</h3>
                      <Badge className="bg-zinc-800 text-white/60 border-white/10 text-xs px-1.5 py-0">
                        impulse buy
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-white/60">
                      <Sparkles className="w-4 h-4 text-violet-400" fill="currentColor" />
                      <span className="text-2xl font-bold text-white">15</span>
                      <span className="text-sm">Sparks</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-white mb-1">$2.99</div>
                    <Button size="sm" className="bg-white text-zinc-950 hover:bg-white/90 font-bold h-9 px-6">
                      Buy
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Date Night - Highlighted */}
              <Card className="relative bg-gradient-to-br from-violet-600 to-fuchsia-600 border-0 p-4 overflow-hidden">
                <div className="absolute top-2 right-2">
                  <Badge className="bg-yellow-400 text-yellow-950 border-0 text-xs font-bold px-2 py-1">
                    Best Value
                  </Badge>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-white mb-1">Date Night</h3>
                    <div className="flex items-center gap-1.5 text-white/90">
                      <Sparkles className="w-4 h-4 text-white" fill="currentColor" />
                      <span className="text-2xl font-bold text-white">60</span>
                      <span className="text-sm">Sparks</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-white mb-1">$9.99</div>
                    <Button size="sm" className="bg-white text-violet-600 hover:bg-white/90 font-bold h-9 px-6">
                      Buy
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Power User */}
              <Card className="bg-zinc-900 border-white/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-white">Power User</h3>
                      <Badge className="bg-zinc-800 text-white/60 border-white/10 text-xs px-1.5 py-0">
                        Full month
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-white/60">
                      <Sparkles className="w-4 h-4 text-violet-400" fill="currentColor" />
                      <span className="text-2xl font-bold text-white">150</span>
                      <span className="text-sm">Sparks</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-white mb-1">$19.99</div>
                    <Button size="sm" className="bg-white text-zinc-950 hover:bg-white/90 font-bold h-9 px-6">
                      Buy
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="mb-8">
            <h2 className="text-lg font-bold mb-4">Recent activity</h2>
            <Card className="bg-zinc-900 border-white/10 divide-y divide-white/5">
              {/* Today */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-emerald-400" fill="currentColor" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">Daily login</div>
                    <div className="text-xs text-white/50">Today</div>
                  </div>
                </div>
                <div className="text-emerald-400 font-bold">+1</div>
              </div>

              {/* Yesterday */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-rose-400" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">Time Extender used</div>
                    <div className="text-xs text-white/50">Yesterday</div>
                  </div>
                </div>
                <div className="text-rose-400 font-bold">-1</div>
              </div>

              {/* 2 days ago */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-violet-400" fill="currentColor" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">Date Night Pack purchased</div>
                    <div className="text-xs text-white/50">2 days ago</div>
                  </div>
                </div>
                <div className="text-emerald-400 font-bold">+60</div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* iOS Home Indicator */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1 bg-white/30 rounded-full" />
    </div>
  );
}
