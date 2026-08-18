import { useState, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { VoiceRecorder } from "capacitor-voice-recorder";
import { Mic, Square, Play, Pause, X } from "lucide-react";

// Converts the plugin's base64 recording into a real Blob, so callers
// (onSave) get the exact same Blob shape regardless of whether the
// recording came from the web MediaRecorder path or the native plugin.
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

export function AudioRecorderControl({
  onSave,
  isSaving,
  saveLabel = "Save This Prompt",
}: {
  onSave: (blob: Blob) => void;
  isSaving?: boolean;
  saveLabel?: string;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  // Surfaced inline rather than failing silently — a permission denial or
  // missing hardware needs to actually tell the user something, otherwise
  // this looks exactly like a broken button (which is how this bug was
  // originally reported).
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoStopTimer = () => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  };

  // --- Web path: unchanged from before — browsers handle the mic
  // permission prompt themselves via getUserMedia. ---
  const startRecordingWeb = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordedBlob(null);

      autoStopTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
        }
      }, 30000);
    } catch {
      setErrorMessage("Couldn't access your microphone. Check your browser's site permissions and try again.");
    }
  };

  const stopRecordingWeb = () => {
    clearAutoStopTimer();
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  // --- Native path: getUserMedia/MediaRecorder aren't reliable inside a
  // Capacitor WebView — there's no automatic OS permission prompt like a
  // real browser gives you, so recording just silently fails there.
  // capacitor-voice-recorder handles the native permission request and
  // recording via platform APIs instead. ---
  const startRecordingNative = async () => {
    try {
      const { value: hasPermission } = await VoiceRecorder.hasAudioRecordingPermission();
      if (!hasPermission) {
        const { value: granted } = await VoiceRecorder.requestAudioRecordingPermission();
        if (!granted) {
          setErrorMessage("Microphone permission is needed to record a voice prompt. You can enable it in your device settings.");
          return;
        }
      }

      await VoiceRecorder.startRecording();
      setIsRecording(true);
      setRecordedBlob(null);

      autoStopTimerRef.current = setTimeout(() => {
        void stopRecordingNative();
      }, 30000);
    } catch {
      setErrorMessage("Couldn't start recording. Please try again.");
    }
  };

  const stopRecordingNative = async () => {
    clearAutoStopTimer();
    setIsRecording(false);
    try {
      const result = await VoiceRecorder.stopRecording();
      const { recordDataBase64, mimeType } = result.value;
      setRecordedBlob(base64ToBlob(recordDataBase64, mimeType || "audio/aac"));
    } catch {
      setErrorMessage("Couldn't save the recording. Please try again.");
    }
  };

  const startRecording = () => {
    setErrorMessage(null);
    if (Capacitor.isNativePlatform()) {
      void startRecordingNative();
    } else {
      void startRecordingWeb();
    }
  };

  const stopRecording = () => {
    if (Capacitor.isNativePlatform()) {
      void stopRecordingNative();
    } else {
      stopRecordingWeb();
    }
  };

  const togglePreview = () => {
    if (!recordedBlob) return;
    if (!audioPreviewRef.current) {
      audioPreviewRef.current = new Audio(URL.createObjectURL(recordedBlob));
      audioPreviewRef.current.onended = () => setIsPlayingPreview(false);
    }
    if (isPlayingPreview) {
      audioPreviewRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      audioPreviewRef.current.play();
      setIsPlayingPreview(true);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-4 py-6">
        {!recordedBlob ? (
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors ${
              isRecording ? "bg-destructive" : "bg-gradient-accent"
            }`}
          >
            {isRecording ? <Square size={26} className="text-white fill-current" /> : <Mic size={28} className="text-white" />}
          </button>
        ) : (
          <div className="flex items-center gap-4">
            <button onClick={togglePreview} className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
              {isPlayingPreview ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              onClick={() => setRecordedBlob(null)}
              className="w-14 h-14 rounded-full bg-card border border-card-border flex items-center justify-center text-muted-foreground"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {isRecording ? "Recording... (up to 30s)" : recordedBlob ? "Preview your recording, or discard and retry" : "Tap to record"}
        </p>
        {errorMessage && <p className="text-xs text-destructive text-center max-w-[260px]">{errorMessage}</p>}
      </div>

      {recordedBlob && (
        <button
          onClick={() => onSave(recordedBlob)}
          disabled={isSaving}
          className="w-full h-12 rounded-xl bg-gradient-accent text-white font-semibold disabled:opacity-60"
        >
          {isSaving ? "Saving..." : saveLabel}
        </button>
      )}
    </div>
  );
}
