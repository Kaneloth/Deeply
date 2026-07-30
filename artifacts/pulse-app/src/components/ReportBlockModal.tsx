import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Flag, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const REPORT_REASONS = [
  "Harassment or bullying",
  "Inappropriate messages or photos",
  "Fake profile",
  "Spam or scam",
  "Underage user",
  "Something else",
];

interface ReportBlockModalProps {
  targetId: string;
  targetName: string;
  context: "chat" | "profile";
  matchId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ReportBlockModal({ targetId, targetName, context, matchId, onClose, onSuccess }: ReportBlockModalProps) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) setFiles((prev) => [...prev, ...selected].slice(0, 5));
    e.target.value = "";
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!reason) {
      toast({ title: "Choose a reason", description: "Select what happened before submitting.", variant: "destructive" });
      return;
    }
    if (!details.trim()) {
      toast({ title: "Add a few details", description: "Please describe what happened.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("reportedUserId", targetId);
      formData.append("context", context);
      if (matchId) formData.append("matchId", matchId);
      formData.append("reason", reason);
      formData.append("details", details.trim());
      files.forEach((file) => formData.append("screenshots", file));

      const reportRes = await fetch("/api/reports", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!reportRes.ok) {
        const body = await reportRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to submit report");
      }

      const blockRes = await fetch("/api/blocks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ blockedUserId: targetId }),
      });
      if (!blockRes.ok) {
        const body = await blockRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Report submitted, but failed to block");
      }

      toast({ title: "Report submitted", description: `${targetName} has been blocked. Our team will review your report.` });
      onSuccess?.();
      onClose();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Could not submit the report.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 backdrop-blur-sm p-0"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="w-full max-w-[430px] mx-auto bg-card rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Flag size={16} className="text-destructive" />
            <h2 className="font-['Syne'] font-bold text-lg">Report {targetName}</h2>
          </div>
          <button
            onClick={() => !isSubmitting && onClose()}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          This will block {targetName} and send your report to our team for review.
        </p>

        <p className="text-xs font-medium text-foreground mb-2">What happened?</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                reason === r
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-card-border"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Be as specific as possible..."
          rows={4}
          className="w-full border border-card-border rounded-xl px-3 py-2.5 text-sm bg-background mb-3 resize-none outline-none focus:border-primary/50"
        />

        <p className="text-xs font-medium text-foreground mb-1.5">Screenshots (optional, up to 5)</p>
        <div className="flex flex-wrap gap-2 mb-5">
          {files.map((file, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-card-border">
              <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removeFile(i)}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {files.length < 5 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-16 h-16 rounded-lg border-2 border-dashed border-card-border flex items-center justify-center text-muted-foreground hover:border-primary/40 transition-colors"
            >
              <ImageIcon size={20} />
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 rounded-xl" disabled={isSubmitting} onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1 rounded-xl gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={isSubmitting} onClick={handleSubmit}>
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />}
            Submit & Block
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
