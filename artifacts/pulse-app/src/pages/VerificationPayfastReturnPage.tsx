import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

/** Lands here after PayFast redirects the user back from paying for ID
 *  verification. Same polling approach as PayfastReturnPage (Sparks) —
 *  the ITN webhook is an independent server-to-server call that can
 *  arrive a few seconds after this browser redirect. Kept as a separate
 *  page rather than reusing the Sparks one because the copy and the
 *  status endpoint queried are both genuinely different. */
export default function VerificationPayfastReturnPage() {
  const { token } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const mPaymentId = new URLSearchParams(search).get("m_payment_id");

  const [status, setStatus] = useState<"pending" | "complete" | "failed" | "error">("pending");

  useEffect(() => {
    if (!mPaymentId || !token) {
      setStatus("error");
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/verification/id/payfast/status/${mPaymentId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("not found");
        const body = await res.json();
        if (cancelled) return;

        if (body.status === "complete") {
          setStatus("complete");
          return;
        }
        if (body.status === "failed") {
          setStatus("failed");
          return;
        }
        if (attempts < 15) {
          setTimeout(poll, 2000);
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [mPaymentId, token]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 text-center gap-4">
      {status === "pending" && (
        <>
          <Loader2 size={32} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Confirming your payment…</p>
        </>
      )}
      {status === "complete" && (
        <>
          <CheckCircle2 size={40} className="text-green-500" />
          <h1 className="font-['Syne'] font-bold text-xl">Payment confirmed!</h1>
          <p className="text-sm text-muted-foreground">You can now submit your ID documents for review.</p>
        </>
      )}
      {status === "failed" && (
        <>
          <XCircle size={40} className="text-destructive" />
          <h1 className="font-['Syne'] font-bold text-xl">Payment didn't go through</h1>
          <p className="text-sm text-muted-foreground">You haven't been charged. Please try again.</p>
        </>
      )}
      {status === "error" && (
        <>
          <Loader2 size={32} className="text-muted-foreground" />
          <h1 className="font-['Syne'] font-bold text-xl">Still confirming…</h1>
          <p className="text-sm text-muted-foreground">
            This can take a minute. Check your profile shortly — you'll only be charged if the payment actually succeeded.
          </p>
        </>
      )}
      <button
        onClick={() => setLocation("/profile")}
        className="mt-4 h-11 px-6 rounded-xl bg-gradient-accent text-white font-semibold text-sm"
      >
        Back to Profile
      </button>
    </div>
  );
}
