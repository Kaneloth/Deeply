import { Zap } from "lucide-react";

export function AppBrand() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-accent flex items-center justify-center shrink-0">
        <Zap size={14} className="text-white fill-current" />
      </div>
      <span className="font-['Syne'] font-extrabold text-lg tracking-tight text-foreground">
        Deeply
      </span>
    </div>
  );
}
