import React from "react";
import { ArrowLeft, Circle, Undo2, Ghost, Zap, ArrowsUpFromLine } from "lucide-react";

export function Chat() {
  const messages = [
    { id: 1, from: "maya", text: "Hey! Just matched with you", time: "2:14 PM", read: true },
    { id: 2, from: "user", text: "Hi Maya! Love your profile", time: "2:15 PM", read: true },
    { id: 3, from: "maya", text: "Thanks! I saw you're into hiking too", time: "2:16 PM", read: true },
    { id: 4, from: "user", text: "Yeah, just got back from Joshua Tree last weekend", time: "2:17 PM", read: true },
    { id: 5, from: "maya", text: "No way! I was there last month. Did you do the Lost Horse Mine trail?", time: "2:18 PM", read: true },
    { id: 6, from: "user", text: "Actually yes! The views were incredible", time: "2:19 PM", read: true },
    { id: 7, from: "maya", text: "Right? I love how quiet it is up there", time: "2:20 PM", read: true },
    { id: 8, from: "user", text: "Totally. Way better than the crowded spots", time: "2:21 PM", read: true },
    { id: 9, from: "maya", text: "Ok but which is actually better — sunrise or sunset?", time: "2:22 PM", read: false },
  ];

  const messageCount = messages.length;
  const maxMessages = 20;
  const remainingMessages = maxMessages - messageCount;
  const progressPercent = (messageCount / maxMessages) * 100;

  return (
    <div className="relative w-[390px] h-[844px] bg-gradient-to-b from-[#0a0a0b] via-[#121214] to-[#0a0a0b] font-sans overflow-hidden">
      {/* iOS Status Bar */}
      <div className="absolute top-0 left-0 right-0 h-11 bg-transparent z-50 flex items-center justify-between px-6 text-white text-[15px]">
        <span className="font-semibold">9:41</span>
        <div className="flex items-center gap-1">
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
            <path d="M0 1.5C0 0.671573 0.671573 0 1.5 0H3.5C4.32843 0 5 0.671573 5 1.5V10.5C5 11.3284 4.32843 12 3.5 12H1.5C0.671573 12 0 11.3284 0 10.5V1.5Z" fill="white" fillOpacity="0.4"/>
            <path d="M6 3C6 2.17157 6.67157 1.5 7.5 1.5H9.5C10.3284 1.5 11 2.17157 11 3V10.5C11 11.3284 10.3284 12 9.5 12H7.5C6.67157 12 6 11.3284 6 10.5V3Z" fill="white" fillOpacity="0.6"/>
            <path d="M12 4.5C12 3.67157 12.6716 3 13.5 3H15.5C16.3284 3 17 3.67157 17 4.5V10.5C17 11.3284 16.3284 12 15.5 12H13.5C12.6716 12 12 11.3284 12 10.5V4.5Z" fill="white"/>
          </svg>
        </div>
      </div>

      {/* Header */}
      <div className="absolute top-11 left-0 right-0 bg-[#0a0a0b]/80 backdrop-blur-xl border-b border-white/5 z-40">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <button className="text-white hover:opacity-70 transition-opacity">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div className="relative">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#d946ef] to-[#c026d3] overflow-hidden">
                <img 
                  src="/__mockup/images/maya-avatar.jpg" 
                  alt="Maya"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[#0a0a0b]" />
            </div>
            <div>
              <div className="text-white font-semibold text-[15px]">Maya</div>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full px-2.5 py-1">
            <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
            <span className="text-amber-300 text-xs font-mono font-semibold tracking-tight">18:24:30</span>
          </div>
        </div>

        {/* Message Progress */}
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-white/60 text-xs font-medium">{messageCount} / {maxMessages} messages</span>
            <span className="text-white/40 text-[10px]">Video call unlocks at 20</span>
          </div>
          <div className="flex gap-0.5 h-1">
            {Array.from({ length: maxMessages }).map((_, i) => (
              <div
                key={i}
                className={`flex-1 rounded-full transition-all ${
                  i < messageCount 
                    ? i >= maxMessages - 6 
                      ? 'bg-amber-400' 
                      : 'bg-[#d946ef]'
                    : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="absolute top-[134px] bottom-[140px] left-0 right-0 overflow-y-auto px-4 pt-4 pb-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[75%] ${msg.from === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
              <div
                className={`rounded-2xl px-4 py-2.5 ${
                  msg.from === 'user'
                    ? 'bg-gradient-to-br from-[#d946ef] to-[#c026d3] text-white'
                    : 'bg-white/8 text-white/95 backdrop-blur-sm'
                }`}
              >
                <p className="text-[15px] leading-snug">{msg.text}</p>
              </div>
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-white/30 text-[11px]">{msg.time}</span>
                {msg.from === 'user' && (
                  <div className="flex gap-0.5">
                    <Circle className="w-2 h-2 fill-[#d946ef] text-[#d946ef]" />
                    <Circle className="w-2 h-2 fill-[#d946ef] text-[#d946ef]" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Boost Actions Strip */}
      <div className="absolute bottom-[76px] left-0 right-0 px-4 pb-2">
        <div className="bg-[#1a1a1d]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/50 text-[11px] font-medium uppercase tracking-wide">Boost the Chat</span>
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
              <span className="text-amber-300 text-xs font-semibold">32</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <button className="flex flex-col items-center gap-1.5 bg-white/5 hover:bg-white/10 transition-colors rounded-xl p-2 border border-white/5">
              <Undo2 className="w-4 h-4 text-[#d946ef]" />
              <span className="text-white text-[10px] font-medium">Unsend</span>
              <span className="text-white/40 text-[9px]">2 Sparks</span>
            </button>
            <button className="flex flex-col items-center gap-1.5 bg-white/5 hover:bg-white/10 transition-colors rounded-xl p-2 border border-white/5">
              <Ghost className="w-4 h-4 text-[#d946ef]" />
              <span className="text-white text-[10px] font-medium">Ghost</span>
              <span className="text-white/40 text-[9px]">1 Spark</span>
            </button>
            <button className="flex flex-col items-center gap-1.5 bg-white/5 hover:bg-white/10 transition-colors rounded-xl p-2 border border-white/5">
              <Zap className="w-4 h-4 text-[#d946ef]" />
              <span className="text-white text-[10px] font-medium">Icebreak</span>
              <span className="text-white/40 text-[9px]">5 Sparks</span>
            </button>
            <button className="flex flex-col items-center gap-1.5 bg-white/5 hover:bg-white/10 transition-colors rounded-xl p-2 border border-white/5">
              <ArrowsUpFromLine className="w-4 h-4 text-[#d946ef]" />
              <span className="text-white text-[10px] font-medium">+10 Msgs</span>
              <span className="text-white/40 text-[9px]">3 Sparks</span>
            </button>
          </div>
        </div>
      </div>

      {/* Input Bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#0a0a0b]/90 backdrop-blur-xl border-t border-white/5 px-4 py-3 pb-8">
        <div className="flex items-center gap-2">
          <button className="flex items-center justify-center w-9 h-9 bg-white/5 hover:bg-white/10 transition-colors rounded-full border border-white/10">
            <span className="text-[#d946ef] text-lg font-bold">+</span>
          </button>
          <div className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5">
            <input 
              type="text" 
              placeholder="Type a message..."
              className="w-full bg-transparent text-white text-[15px] placeholder:text-white/30 outline-none"
            />
          </div>
          <button className="flex items-center justify-center w-9 h-9 bg-gradient-to-br from-[#d946ef] to-[#c026d3] hover:opacity-90 transition-opacity rounded-full">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
