import { useLocation } from "wouter";
import { XCircle } from "lucide-react";

/** Lands here if the user backs out of PayFast's payment page before
 *  completing it. No transaction lookup needed — nothing was charged,
 *  and the pending payfast_transactions row simply stays "pending"
 *  forever, harmlessly, since no ITN will ever arrive for it. */
export default function PayfastCancelPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 text-center gap-4">
      <XCircle size={40} className="text-muted-foreground" />
      <h1 className="font-['Syne'] font-bold text-xl">Checkout cancelled</h1>
      <p className="text-sm text-muted-foreground">No payment was made. You can try again anytime from Sparks.</p>
      <button
        onClick={() => setLocation("/discover")}
        className="mt-4 h-11 px-6 rounded-xl bg-gradient-accent text-white font-semibold text-sm"
      >
        Back to Deeply
      </button>
    </div>
  );
}
