import { ReactNode } from "react";
import { useLocation } from "wouter";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TextSizeProvider } from "@/contexts/TextSizeContext";

interface AppShellProps {
  children: ReactNode;
}

function AppShellInner({ children }: AppShellProps) {
  const [location] = useLocation();

  // Hide nav and top bar on auth and onboarding routes
  const hideChrome = location === "/" || location === "/onboarding";
  if (hideChrome) {
    return (
      <div className="w-full max-w-[430px] mx-auto min-h-[100dvh] bg-background relative overflow-hidden flex flex-col">
        {children}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[430px] mx-auto h-[100dvh] bg-background relative flex flex-col overflow-hidden">
      <TopBar />

      <main className="flex-1 overflow-y-auto pb-20 no-scrollbar">
        {children}
      </main>

      <BottomNav />
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <ThemeProvider>
      <TextSizeProvider>
        <AppShellInner>{children}</AppShellInner>
      </TextSizeProvider>
    </ThemeProvider>
  );
}
