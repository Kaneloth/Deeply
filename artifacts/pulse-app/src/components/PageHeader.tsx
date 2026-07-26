import { ReactNode } from "react";
import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backTo?: string;
  action?: ReactNode;
}

export function PageHeader({ title, subtitle, backTo, action }: PageHeaderProps) {
  const [, setLocation] = useLocation();

  return (
    <div className="flex items-center justify-between mb-6 px-2">
      <div className="flex items-center gap-3">
        {backTo && (
          <button
            onClick={() => setLocation(backTo)}
            className="w-10 h-10 -ml-2 rounded-full bg-secondary flex items-center justify-center text-foreground hover:bg-secondary/80 transition-colors shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <div>
          <h1 className="text-2xl font-['Syne'] font-bold text-foreground tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
