import { useState, useRef } from "react";
import { Mic, Square, Play, Pause, X } from "lucide-react";

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  const startRecording = async () => {
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

      setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
        }
      }, 30000);
    } catch {
      // Caller can show its own toast if desired; fail silently here.
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
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
