import { useState } from "react";
import { Ban, Mail, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface BlockInfo {
  code: "BANNED" | "SUSPENDED";
  reason?: string;
  suspendedUntil?: string;
}

const MAX_MESSAGE_LENGTH = 4000;

export function BlockedAccountScreen({ blockInfo, onBack }: { blockInfo: BlockInfo; onBack: () => void }) {
  const { toast } = useToast();
  const isBanned = blockInfo.code === "BANNED";
  const untilText = blockInfo.suspendedUntil
    ? new Date(blockInfo.suspendedUntil).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  // No token by the time this screen renders — AuthContext's 403
  // interceptor calls logout() as soon as blockInfo is set, so there's
  // no session left to attach. The user just types their own email,
  // same trust model as any public contact form.
  const handleSend = async () => {
    if (!email.trim() || !message.trim() || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch("/api/support/blocked-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), message: message.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to send message");
      }
      setSent(true);
      toast({ title: "Message sent", description: "Our team will get back to you by email." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to send message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[500] bg-background flex flex-col items-center justify-center px-6 text-center overflow-y-auto py-10">
      <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-destructive/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="z-10 w-full max-w-sm space-y-5 my-auto">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <Ban size={28} className="text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-['Syne'] font-extrabold text-destructive">
            {isBanned ? "Account Banned" : "Account Suspended"}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {isBanned
              ? "Your Deeply account has been permanently banned and you no longer have access to the app."
              : `Your Deeply account has been temporarily suspended and you no longer have access to the app right now.${
                  untilText ? ` Your account will automatically be reinstated on ${untilText}.` : ""
                }`}
          </p>
          {blockInfo.reason && (
            <p className="text-sm text-left bg-destructive/5 border border-destructive/20 rounded-xl px-3 py-2">
              <span className="font-semibold text-destructive">Reason: </span>
              <span className="text-foreground">{blockInfo.reason}</span>
            </p>
          )}
          <p className="text-sm text-muted-foreground leading-relaxed">
            If you believe this is a mistake, please contact our support team and we'll review your account.
          </p>
        </div>

        {sent ? (
          <div className="bg-card border border-card-border rounded-xl px-4 py-4 text-sm text-foreground">
            Your message is on its way to our team. We'll reply to <span className="font-medium">{email}</span>.
          </div>
        ) : showForm ? (
          <div className="text-left space-y-3 bg-card border border-card-border rounded-xl p-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Your email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us why you think this was a mistake..."
                rows={5}
                maxLength={MAX_MESSAGE_LENGTH}
                className="w-full bg-background border border-card-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-primary/50"
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!email.trim() || !message.trim() || isSending}
              className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-destructive text-destructive-foreground font-semibold text-sm disabled:opacity-60"
            >
              <Send size={16} />
              {isSending ? "Sending..." : "Send Message"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-destructive text-destructive-foreground font-semibold text-sm"
          >
            <Mail size={16} />
            Contact Support
          </button>
        )}

        {!sent && (
          <a
            href="mailto:support@deeplydating.co.za"
            className="block text-xs text-muted-foreground hover:text-foreground underline"
          >
            Prefer email? Reach us directly at support@deeplydating.co.za
          </a>
        )}

        <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground underline">
          ← Back to sign in
        </button>
      </div>
    </div>
  );
}
