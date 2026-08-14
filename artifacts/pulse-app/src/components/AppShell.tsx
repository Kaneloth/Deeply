import { ReactNode } from "react";
import { useLocation } from "wouter";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TextSizeProvider } from "@/contexts/TextSizeContext";
import { DiscoverControlsProvider } from "@/contexts/DiscoverControlsContext";
import { useAuth } from "@/contexts/AuthContext";
import { BlockedAccountScreen } from "@/components/BlockedAccountScreen";

interface AppShellProps {
  children: ReactNode;
}

function AppShellInner({ children }: AppShellProps) {
  const [location] = useLocation();
  const { blockInfo, clearBlockInfo } = useAuth();

  // A ban/suspension can be detected mid-session, on any route — this
  // takes over the entire screen regardless of what would otherwise
  // render, since continuing to show the underlying page while a "you've
  // been banned" state exists would be confusing.
  if (blockInfo) {
    return <BlockedAccountScreen blockInfo={blockInfo} onBack={clearBlockInfo} />;
  }

  // Hide nav and top bar on auth and onboarding routes
  const hideChrome = location === "/" || location === "/onboarding" || location === "/reset-password";
  if (hideChrome) {
    return (
      // overflow-y-auto, NOT overflow-hidden — these pages (especially
      // the signup form on AuthPage) can be taller than the viewport on
      // shorter/smaller screens. overflow-hidden made that content
      // completely unreachable: not just scrolled past, but physically
      // impossible to scroll to at all, since there was no way to
      // scroll in the first place.
      <div className="w-full max-w-[430px] mx-auto min-h-[100dvh] bg-background relative overflow-y-auto flex flex-col">
        {children}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[430px] mx-auto h-[100dvh] bg-background relative flex flex-col overflow-hidden">
      <TopBar />
      <AnnouncementBanner />

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
        <DiscoverControlsProvider>
          <AppShellInner>{children}</AppShellInner>
        </DiscoverControlsProvider>
      </TextSizeProvider>
    </ThemeProvider>
  );
}
