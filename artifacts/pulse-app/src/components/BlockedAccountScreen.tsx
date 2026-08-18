import { useState } from "react";
import { Ban, Mail, Send, CheckCircle2 } from "lucide-react";

export interface BlockInfo {
  code: "BANNED" | "SUSPENDED";
  reason?: string;
  suspendedUntil?: string;
  // Captured from the login form at the moment the account was found to
  // be blocked — there's no session/token by this point, so this is the
  // only identity we actually have to send with a support message.
  email?: string;
}

const MAX_MESSAGE_LENGTH = 4000;

export function BlockedAccountScreen({ blockInfo, onBack }: { blockInfo: BlockInfo; onBack: () => void }) {
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
  const [email, setEmail] = useState(blockInfo.email ?? "");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !message.trim() || isSending) return;
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch("/api/support/message-public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), message: message.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to send your message. Please try again.");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send your message. Please try again.");
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
          {!showForm && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              If you believe this is a mistake, please contact our support team and we'll review your account.
            </p>
          )}
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-2 bg-secondary/50 border border-card-border rounded-xl px-4 py-5">
            <CheckCircle2 size={22} className="text-primary" />
            <p className="text-sm font-medium">Message sent</p>
            <p className="text-xs text-muted-foreground">
              Our support team will get back to you at {email}.
            </p>
          </div>
        ) : showForm ? (
          <form onSubmit={handleSubmit} className="space-y-3 text-left">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Your email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full h-11 rounded-xl bg-card border border-card-border px-3 text-sm focus:outline-none focus:border-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Message</label>
              <textarea
                required
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                placeholder="Tell us why you think this is a mistake..."
                rows={4}
                className="w-full rounded-xl bg-card border border-card-border px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-primary/50"
              />
              <p className="text-[11px] text-muted-foreground text-right">
                {message.length}/{MAX_MESSAGE_LENGTH}
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={isSending || !email.trim() || !message.trim()}
              className="w-full h-12 rounded-xl bg-destructive text-destructive-foreground font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Send size={16} />
              {isSending ? "Sending..." : "Send Message"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-destructive text-destructive-foreground font-semibold text-sm"
          >
            <Mail size={16} />
            Contact Support
          </button>
        )}

        {!showForm && (
          <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground underline">
            ← Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}
