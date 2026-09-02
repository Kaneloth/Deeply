import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  AppUpdate,
  AppUpdateAvailability,
  AppUpdateResultCode,
  FlexibleUpdateInstallStatus,
} from "@capawesome/capacitor-app-update";
import { App as CapacitorApp } from "@capacitor/app";
import { X, Download, RefreshCw } from "lucide-react";

// This is a genuinely native-only concept — there's no "update
// available" signal for a website (a web deploy just is the current
// version, instantly), and this same codebase serves both the native
// app and app.deeplydating.co.za from one build. isNativePlatform()
// is the same guard already used throughout this app (AuthContext,
// AudioRecorderControl, AuthPage, ProfilePage) for exactly this kind
// of native-only capability.
//
// IMPORTANT — this can only ever be exercised by an install that came
// from Google Play itself. Play's in-app update API has nothing to
// check against for a sideloaded/debug APK; it will simply never
// report an update available there, even if a newer version genuinely
// exists on Play. Testing this requires installing through Play
// (an internal testing track is enough), not via `adb install` or a
// manually copied APK.
//
// Dismissing the initial prompt hides it for the rest of this app
// session only (in-memory state, not persisted) — it's expected to
// reappear on the next app open if the update is still pending,
// unlike a feature-discovery nudge that should back off over days.
// A pending real update reappearing each session is standard,
// expected behavior for this kind of prompt.
export function UpdateBanner() {
  const [phase, setPhase] = useState<"idle" | "available" | "downloading" | "downloaded">("idle");
  const [dismissed, setDismissed] = useState(false);
  const listenerHandleRef = useRef<{ remove: () => Promise<void> } | null>(null);
  const resumeListenerRef = useRef<{ remove: () => Promise<void> } | null>(null);

  const checkForUpdate = () => {
    AppUpdate.getAppUpdateInfo()
      .then((info) => {
        if (
          info.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE &&
          info.flexibleUpdateAllowed
        ) {
          setPhase("available");
        }
      })
      .catch(() => {
        // Silent — this is a nice-to-have prompt, not a critical path;
        // failing to even check shouldn't interrupt anyone's session
        // with an error they can't do anything about.
      });
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
      // iOS has no equivalent in-app flexible update mechanism at all
      // (Apple doesn't allow background-downloading an update from
      // within the app) — the standard pattern there is directing
      // someone to the App Store page instead, which is a different
      // enough UX that it's deliberately out of scope here rather than
      // half-built and untested against a platform this app isn't
      // even shipping to yet.
      return;
    }

    checkForUpdate();

    // Fallback safety net: if this component is sitting in
    // "downloading" when the app comes back to the foreground,
    // re-check the real installStatus directly via getAppUpdateInfo()
    // rather than trusting only the onFlexibleUpdateStateChange
    // listener. Play's own consent UI briefly takes over the
    // foreground during startFlexibleUpdate(), and a JS event listener
    // in a backgrounded WebView can miss an event fired during that
    // window — this catches DOWNLOADED (or FAILED/CANCELED) even if
    // the listener callback never ran.
    CapacitorApp.addListener("resume", () => {
      setPhase((current) => {
        if (current !== "downloading") return current;
        AppUpdate.getAppUpdateInfo().then((info) => {
          if (info.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) {
            setPhase("downloaded");
            setDismissed(false);
          } else if (
            info.installStatus === FlexibleUpdateInstallStatus.FAILED ||
            info.installStatus === FlexibleUpdateInstallStatus.CANCELED
          ) {
            setPhase("available");
          }
          // Any other status (PENDING, DOWNLOADING, INSTALLING) means
          // it's still genuinely in progress — leave it showing
          // "downloading" as-is.
        });
        return current;
      });
    }).then((handle) => {
      resumeListenerRef.current = handle;
    });

    return () => {
      listenerHandleRef.current?.remove();
      resumeListenerRef.current?.remove();
    };
  }, []);

  const handleStartUpdate = async () => {
    setPhase("downloading");
    setDismissed(false);
    try {
      const handle = await AppUpdate.addListener("onFlexibleUpdateStateChange", (state) => {
        if (state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) {
          setPhase("downloaded");
          setDismissed(false);
        } else if (
          state.installStatus === FlexibleUpdateInstallStatus.FAILED ||
          state.installStatus === FlexibleUpdateInstallStatus.CANCELED
        ) {
          // Previously unhandled entirely — this is what left the
          // banner stuck showing "downloading" forever whenever the
          // download itself failed or got canceled partway through,
          // since nothing ever moved the phase off "downloading" in
          // that case.
          setPhase("available");
        }
      });
      listenerHandleRef.current = handle;

      const result = await AppUpdate.startFlexibleUpdate();

      // Previously unchecked entirely. startFlexibleUpdate() resolves
      // successfully (does not throw) even when the user dismisses
      // Play's own consent sheet or the update can't start for some
      // other reason — the outcome is only reflected in this result
      // code, not in whether the promise rejected. Treating any
      // non-OK code as "nothing actually started" avoids sitting in
      // "downloading" for a download that never began.
      if (result.code !== AppUpdateResultCode.OK) {
        setPhase("available");
      }
    } catch {
      // The user may have dismissed Play's own permission/consent
      // sheet, or genuinely have no connectivity right now — either
      // way, quietly return to the original prompt rather than get
      // stuck showing "downloading" for something that never started.
      setPhase("available");
    }
  };

  const handleCompleteUpdate = async () => {
    try {
      await AppUpdate.completeFlexibleUpdate();
      // No further state handling needed on success — completing a
      // flexible update restarts the app to apply it, so this
      // component simply won't exist anymore once that happens.
    } catch {
      // If this specific call fails, leave the "ready to install"
      // prompt showing rather than silently losing the affordance —
      // the download already succeeded, so trying again should still
      // work.
    }
  };

  if (phase === "idle") {
    return null;
  }

  if (phase === "available" && dismissed) {
    return null;
  }

  if (phase === "available") {
    return (
      <div className="flex items-center gap-3 bg-card border-b border-card-border px-4 py-2.5">
        <div className="w-8 h-8 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0">
          <Download size={15} />
        </div>
        <p className="text-xs flex-1 min-w-0">A new version of Deeply is available.</p>
        <button
          onClick={handleStartUpdate}
          className="px-3 py-1.5 rounded-full bg-gradient-accent text-white text-xs font-semibold shrink-0"
        >
          Update
        </button>
        <button onClick={() => setDismissed(true)} className="text-muted-foreground shrink-0">
          <X size={16} />
        </button>
      </div>
    );
  }

  if (phase === "downloading") {
    return (
      <div className="flex items-center gap-3 bg-card border-b border-card-border px-4 py-2.5">
        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
          <RefreshCw size={14} className="animate-spin text-muted-foreground" />
        </div>
        <p className="text-xs flex-1 min-w-0 text-muted-foreground">
          Updating in the background — keep using the app as normal.
        </p>
      </div>
    );
  }

  // phase === "downloaded" — dismissible too, unlike the original
  // design: forcing an immediate restart on someone mid-task (typing a
  // message, mid-payment flow) would be a worse experience than
  // letting them defer it, given the update has already fully
  // downloaded regardless and isn't going anywhere. A small persistent
  // pill replaces the full banner once dismissed, so the option to
  // actually complete it later stays reachable rather than disappearing
  // outright.
  if (dismissed) {
    return (
      <button
        onClick={() => setDismissed(false)}
        className="flex items-center gap-1.5 mx-4 my-1.5 px-3 py-1 rounded-full bg-secondary text-[11px] text-muted-foreground w-fit"
      >
        <Download size={11} /> Update ready
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-card border-b border-card-border px-4 py-2.5">
      <div className="w-8 h-8 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0">
        <Download size={15} />
      </div>
      <p className="text-xs flex-1 min-w-0">Update ready to install.</p>
      <button
        onClick={handleCompleteUpdate}
        className="px-3 py-1.5 rounded-full bg-gradient-accent text-white text-xs font-semibold shrink-0"
      >
        Restart & Install
      </button>
      <button onClick={() => setDismissed(true)} className="text-muted-foreground shrink-0">
        <X size={16} />
      </button>
    </div>
  );
}
