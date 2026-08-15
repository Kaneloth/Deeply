import { useLocation } from "wouter";
import { XCircle } from "lucide-react";

export default function VerificationPayfastCancelPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 text-center gap-4">
      <XCircle size={40} className="text-muted-foreground" />
      <h1 className="font-['Syne'] font-bold text-xl">Checkout cancelled</h1>
      <p className="text-sm text-muted-foreground">No payment was made. You can try again anytime from your Profile.</p>
      <button
        onClick={() => setLocation("/profile")}
        className="mt-4 h-11 px-6 rounded-xl bg-gradient-accent text-white font-semibold text-sm"
      >
        Back to Profile
      </button>
    </div>
  );
}
