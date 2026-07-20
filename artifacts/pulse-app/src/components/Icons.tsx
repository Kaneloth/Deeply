import React from 'react';

export function SparkIcon({ className, size = 24 }: { className?: string, size?: number }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path 
        d="M13 2L3 14H12L11 22L21 10H12L13 2Z" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeartbeatVisual() {
  return (
    <div className="relative w-full h-32 flex items-center justify-center">
      <div className="absolute w-[200%] h-[2px] bg-gradient-to-r from-transparent via-primary to-accent opacity-50 pulse-line-anim"></div>
      <svg className="w-full h-full text-primary heartbeat-svg drop-shadow-[0_0_15px_rgba(192,38,211,0.5)]" viewBox="0 0 500 100" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
        <path d="M0 50 H200 L210 20 L230 80 L250 10 L270 90 L290 50 H500" stroke="url(#heartbeat-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <defs>
          <linearGradient id="heartbeat-grad" x1="0" y1="0" x2="500" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="40%" stopColor="#c026d3" />
            <stop offset="50%" stopColor="#e11d48" />
            <stop offset="60%" stopColor="#c026d3" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
