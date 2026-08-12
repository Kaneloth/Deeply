import { createContext, useContext, useState, ReactNode } from "react";

export interface DiscoverControls {
  reshuffleStatus: { isFree: boolean; cost: number } | null;
  isReshuffling: boolean;
  onReshuffle: () => void;
}

interface DiscoverControlsContextType {
  controls: DiscoverControls | null;
  setControls: (controls: DiscoverControls | null) => void;
}

const DiscoverControlsContext = createContext<DiscoverControlsContextType | undefined>(undefined);

/** Lets DiscoverPage "hand up" its reshuffle controls to the global
 *  TopBar without TopBar needing to know anything about routes.
 *  DiscoverPage registers its current state here on mount (and every
 *  time that state changes), and clears it on unmount — so TopBar
 *  simply renders whatever's currently registered, which is naturally
 *  null on every page other than Discover, without any route-checking
 *  logic on TopBar's side at all.
 *
 *  Deliberately does NOT include invitesCount — that badge lives in
 *  BottomNav instead, which is visible on every page, not just Discover,
 *  so it fetches that count independently rather than through this
 *  Discover-only context. Reshuffling genuinely only makes sense while
 *  on Discover; the invites count doesn't have that same constraint. */
export function DiscoverControlsProvider({ children }: { children: ReactNode }) {
  const [controls, setControls] = useState<DiscoverControls | null>(null);
  return (
    <DiscoverControlsContext.Provider value={{ controls, setControls }}>
      {children}
    </DiscoverControlsContext.Provider>
  );
}

export function useDiscoverControls() {
  const context = useContext(DiscoverControlsContext);
  if (context === undefined) {
    throw new Error("useDiscoverControls must be used within a DiscoverControlsProvider");
  }
  return context;
}
