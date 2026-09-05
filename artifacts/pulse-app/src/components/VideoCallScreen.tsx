import { useEffect, useRef, useState } from "react";
import AgoraRTC, {
  type IAgoraRTCClient,
  type ICameraVideoTrack,
  type IMicrophoneAudioTrack,
  type IAgoraRTCRemoteUser,
} from "agora-rtc-sdk-ng";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
import { captureError } from "@/lib/sentry";

const FREE_CALL_SECONDS = 5 * 60; // must match video-calls.ts's own constant
const SPARKS_PER_30_SECONDS = 1; // must match video-calls.ts's own constant

interface VideoCallScreenProps {
  callId: string;
  channelName: string;
  agoraAppId: string;
  agoraToken: string;
  agoraUid: number;
  acceptedAt: string; // server timestamp — the timer is computed from
  // this, not from when this component happened to mount, so both
  // parties see the same elapsed time even if one joins a moment
  // later than the other.
  otherPersonName: string;
  otherPersonPhotoUrl: string | null;
  usedFreeCall: boolean;
  isPayer: boolean; // determines whether the extend-or-end prompt shows
  // real cost messaging, or just an informational notice — only one
  // person (the match's permanently-recorded payer) is ever actually
  // charged, regardless of who initiated this specific call.
  token: string; // auth token, needed for the one balance-check fetch
  onEndCall: () => void; // parent handles calling /end and clearing state
}

export function VideoCallScreen({
  callId,
  channelName,
  agoraAppId,
  agoraToken,
  agoraUid,
  acceptedAt,
  otherPersonName,
  otherPersonPhotoUrl,
  usedFreeCall,
  isPayer,
  token,
  onEndCall,
}: VideoCallScreenProps) {
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localAudioTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const localVideoTrackRef = useRef<ICameraVideoTrack | null>(null);

  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "failed">("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [remoteUserPresent, setRemoteUserPresent] = useState(false);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showExtendPrompt, setShowExtendPrompt] = useState(false);
  const [hasRespondedToPrompt, setHasRespondedToPrompt] = useState(false);
  // null while unknown/unlimited (still in the free window); once past
  // it and the person chooses to continue, this becomes the actual
  // elapsed-seconds value at which their current Sparks balance runs
  // out — the client-side enforcement half of the safeguard described
  // to the user earlier (the server-side half is video-calls.ts's own
  // retroactive charge at /end, which settles the real, final amount
  // regardless of what this client-side estimate assumed).
  const [hardCutoffAtSeconds, setHardCutoffAtSeconds] = useState<number | null>(null);

  // ============================================================
  // Agora join/publish/subscribe/cleanup lifecycle
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    clientRef.current = client;

    client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      await client.subscribe(user, mediaType);
      if (cancelled) return;
      if (mediaType === "video" && user.videoTrack && remoteVideoRef.current) {
        user.videoTrack.play(remoteVideoRef.current);
        setRemoteUserPresent(true);
      }
      if (mediaType === "audio" && user.audioTrack) {
        user.audioTrack.play();
      }
    });

    client.on("user-left", () => {
      // The other party leaving doesn't end the call for the person
      // still here — video-calls.ts's own /end handles billing
      // whenever whichever side actually calls it. This just clears
      // the now-stale remote video tile rather than showing a frozen
      // last frame.
      if (!cancelled) setRemoteUserPresent(false);
    });

    (async () => {
      let step: "join" | "createTracks" | "publish" = "join";
      try {
        await client.join(agoraAppId, channelName, agoraToken, agoraUid);
        step = "createTracks";
        const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
        if (cancelled) {
          audioTrack.close();
          videoTrack.close();
          return;
        }
        localAudioTrackRef.current = audioTrack;
        localVideoTrackRef.current = videoTrack;
        if (localVideoRef.current) videoTrack.play(localVideoRef.current);

        // Catches the specific "call connects fine, but the camera
        // never actually shows anything" symptom — this genuinely
        // wouldn't throw at all (createMicrophoneAndCameraTracks can
        // resolve successfully with a track that isn't actually
        // producing frames), so the try/catch below alone can't detect
        // it. Checking the underlying MediaStreamTrack's own readyState
        // directly is what actually catches this.
        const rawTrack = videoTrack.getMediaStreamTrack();
        if (rawTrack.readyState !== "live") {
          captureError(new Error("Video track created but not live"), {
            context: "VideoCallScreen.trackNotLive",
            readyState: rawTrack.readyState,
            enabled: rawTrack.enabled,
            muted: rawTrack.muted,
            channelName,
          });
        }

        step = "publish";
        await client.publish([audioTrack, videoTrack]);
        if (!cancelled) setConnectionState("connected");
      } catch (err) {
        if (cancelled) return;
        setConnectionState("failed");
        // Most common real-world cause by far: camera/mic permission
        // denied, either by the person or by the device/browser
        // outright. Named explicitly since "failed to connect" alone
        // wouldn't tell anyone what to actually go fix.
        const message = err instanceof Error ? err.message : String(err);
        setConnectionError(
          message.toLowerCase().includes("permission") || message.toLowerCase().includes("notallowed")
            ? "Camera and microphone access is required for video calls. Please allow access and try again."
            : "Couldn't connect to the call. Please check your connection and try again.",
        );
        // Reported to Sentry so a real failure is actually diagnosable
        // afterward — "step" specifically distinguishes joining the
        // Agora channel itself from creating/publishing local
        // camera+mic tracks, which are two completely different
        // failure categories that "connection failed" alone can't tell
        // apart.
        captureError(err, {
          context: "VideoCallScreen.join",
          step,
          channelName,
          agoraUid,
          message,
        });
      }
    })();

    return () => {
      cancelled = true;
      // Always released, regardless of how this component unmounts —
      // leaving a camera/mic track open after the call screen closes
      // would be a genuinely bad, easy-to-miss bug (camera light
      // staying on, mic still capturing in the background).
      localAudioTrackRef.current?.close();
      localVideoTrackRef.current?.close();
      client.removeAllListeners();
      client.leave().catch(() => {});

      // Safety net for exactly the incident this was added for: if the
      // camera/join fails, or someone leaves via the OS back button
      // rather than the explicit End Call button, nothing else would
      // ever tell the backend this call is over — leaving it stuck as
      // "active" and permanently blocking every future call for the
      // match. The parent's onEndCall is written to silently no-op if
      // the backend says the call was already ended (e.g. the explicit
      // button already handled it moments earlier), so calling it
      // unconditionally here is safe, not a double-charge risk.
      onEndCall();
    };
    // Deliberately run once per mount only — this screen is always
    // torn down and recreated fresh for a new call rather than reused
    // across channel changes, so there's no legitimate case where any
    // of these props change mid-lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // Timer + free-time / paid-time transition + budget auto-cutoff
  // ============================================================
  useEffect(() => {
    const tick = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(acceptedAt).getTime()) / 1000));
      setElapsedSeconds(seconds);

      const freeSeconds = usedFreeCall ? FREE_CALL_SECONDS : 0;
      if (seconds >= freeSeconds && !hasRespondedToPrompt && !showExtendPrompt) {
        setShowExtendPrompt(true);
      }
      if (hardCutoffAtSeconds !== null && seconds >= hardCutoffAtSeconds) {
        onEndCall();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [acceptedAt, usedFreeCall, hasRespondedToPrompt, showExtendPrompt, hardCutoffAtSeconds, onEndCall]);

  // Sent every 20s while genuinely connected — this is the actual
  // signal the scheduled stale-call cleanup checks against on the
  // backend. If this stops arriving for any reason (app force-closed,
  // connectivity lost, phone dies — anything that prevents this
  // component from cleanly unmounting or the explicit End Call button
  // from ever being tapped), the backend treats the call as over on
  // its own rather than letting it run, and bill, indefinitely. This
  // is the actual fix for that failure mode, not just a nice-to-have.
  useEffect(() => {
    if (connectionState !== "connected") return;
    const sendHeartbeat = () => {
      fetch(`/api/video-calls/${callId}/heartbeat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {
        // Silent — a single missed heartbeat isn't itself a problem,
        // only a sustained gap is, which the backend's own staleness
        // threshold already accounts for.
      });
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 20000);
    return () => clearInterval(interval);
  }, [connectionState, callId, token]);

  const handleContinuePaid = async () => {
    setHasRespondedToPrompt(true);
    setShowExtendPrompt(false);
    try {
      const res = await fetch("/api/sparks", { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      const balance: number = body.balance ?? 0;
      const affordableSeconds = Math.floor(balance / SPARKS_PER_30_SECONDS) * 30;
      const freeSeconds = usedFreeCall ? FREE_CALL_SECONDS : 0;
      setHardCutoffAtSeconds(freeSeconds + affordableSeconds);
      if (affordableSeconds <= 0) {
        // Genuinely can't afford even one more 30-second block —
        // ending immediately rather than pretending "continue" did
        // anything, since a cutoff of "right now" isn't meaningfully
        // different from just ending.
        onEndCall();
      }
    } catch {
      // If we can't even check the balance, err toward ending rather
      // than letting the call continue with no budget enforced at all.
      onEndCall();
    }
  };

  const toggleMute = async () => {
    if (!localAudioTrackRef.current) return;
    const newMutedState = !isMuted;
    await localAudioTrackRef.current.setEnabled(!newMutedState);
    setIsMuted(newMutedState);
  };

  const toggleCamera = async () => {
    if (!localVideoTrackRef.current) return;
    const newCameraOffState = !isCameraOff;
    await localVideoTrackRef.current.setEnabled(!newCameraOffState);
    setIsCameraOff(newCameraOffState);
  };

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const freeSeconds = usedFreeCall ? FREE_CALL_SECONDS : 0;
  const isInFreeWindow = elapsedSeconds < freeSeconds;
  const timeRemainingLabel = isInFreeWindow
    ? `${formatTime(freeSeconds - elapsedSeconds)} free`
    : isPayer && hardCutoffAtSeconds !== null
      ? `${formatTime(Math.max(0, hardCutoffAtSeconds - elapsedSeconds))} left on your balance`
      : formatTime(elapsedSeconds);

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      {/* Remote video fills the screen; falls back to a name/photo
          placeholder until the other person's track actually arrives
          — they may take a moment to finish their own join/publish. */}
      <div className="relative flex-1 bg-neutral-900">
        <div ref={remoteVideoRef} className="absolute inset-0" />
        {!remoteUserPresent && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
            <div className="w-20 h-20 rounded-full bg-white/10 overflow-hidden flex items-center justify-center">
              {otherPersonPhotoUrl ? (
                <img src={otherPersonPhotoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold">{otherPersonName[0]}</span>
              )}
            </div>
            <p className="text-sm opacity-70">
              {connectionState === "connecting" ? "Connecting..." : `Waiting for ${otherPersonName} to join...`}
            </p>
          </div>
        )}

        {/* Local preview — small, corner picture-in-picture, standard
            for any video calling UI. */}
        <div className="absolute top-4 right-4 w-24 h-32 rounded-xl overflow-hidden bg-neutral-800 border border-white/20">
          <div ref={localVideoRef} className="w-full h-full" />
          {isCameraOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-800">
              <VideoOff size={18} className="text-white/60" />
            </div>
          )}
        </div>

        <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md">
          <p className="text-white text-xs font-semibold">{timeRemainingLabel}</p>
        </div>

        {connectionState === "failed" && (
          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-white text-sm">{connectionError}</p>
            <button onClick={onEndCall} className="px-5 py-2 rounded-full bg-destructive text-white text-sm font-semibold">
              Close
            </button>
          </div>
        )}

        {showExtendPrompt && isPayer && (
          <div className="absolute inset-x-6 bottom-24 bg-card rounded-2xl p-4 shadow-2xl">
            <p className="text-sm font-semibold mb-1">Your free time has ended</p>
            <p className="text-xs text-muted-foreground mb-3">
              Continue for 1 Spark per 30 seconds, or end the call now.
            </p>
            <div className="flex gap-2">
              <button
                onClick={onEndCall}
                className="flex-1 h-9 rounded-full bg-secondary text-sm font-semibold text-muted-foreground"
              >
                End Call
              </button>
              <button
                onClick={handleContinuePaid}
                className="flex-1 h-9 rounded-full bg-gradient-accent text-sm font-semibold text-white"
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-5 py-6 bg-black">
        <button
          onClick={toggleMute}
          className={`w-12 h-12 rounded-full flex items-center justify-center ${isMuted ? "bg-white text-black" : "bg-white/15 text-white"}`}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
        <button onClick={onEndCall} className="w-14 h-14 rounded-full bg-destructive flex items-center justify-center">
          <PhoneOff size={22} className="text-white" />
        </button>
        <button
          onClick={toggleCamera}
          className={`w-12 h-12 rounded-full flex items-center justify-center ${isCameraOff ? "bg-white text-black" : "bg-white/15 text-white"}`}
        >
          {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
        </button>
      </div>
    </div>
  );
}
