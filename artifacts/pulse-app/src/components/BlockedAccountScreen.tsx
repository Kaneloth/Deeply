import { Ban, Mail } from "lucide-react";

export interface BlockInfo {
  code: "BANNED" | "SUSPENDED";
  reason?: string;
  suspendedUntil?: string;
}

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

  return (
    <div className="fixed inset-0 z-[500] bg-background flex flex-col items-center justify-center px-6 text-center">
      <div className="absolute top-[-10%] left-[-20%] w-[150%] h-[50%] bg-destructive/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="z-10 w-full max-w-sm space-y-5">
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

        <a
          href="mailto:support@deeplydating.co.za"
          className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-destructive text-destructive-foreground font-semibold text-sm"
        >
          <Mail size={16} />
          Contact Support
        </a>

        <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground underline">
          ← Back to sign in
        </button>
      </div>
    </div>
  );
}
