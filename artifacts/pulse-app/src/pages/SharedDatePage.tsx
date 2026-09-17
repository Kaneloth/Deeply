import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { ShieldAlert, MapPin, Calendar, StickyNote } from "lucide-react";

interface SharedDateData {
  shared_by_name: string | null;
  date_time: string;
  location: string;
  notes: string | null;
  matched_user: { name: string; age: number | null; photo_url: string | null } | null;
}

/** Public route (/date/:token, see App.tsx) — the recipient of a shared
 *  date link opens this directly in a browser, no login, no app
 *  install required. Deliberately doesn't use useAuth or any
 *  authenticated context at all; this either works from the token
 *  alone or it doesn't, regardless of whether the viewer happens to
 *  have a session. */
export default function SharedDatePage() {
  const params = useParams();
  const token = params.token;
  const [data, setData] = useState<SharedDateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/shared-dates/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "This link is no longer available.");
        }
        return res.json();
      })
      .then((body) => setData(body))
      .catch((err) => setError(err instanceof Error ? err.message : "This link is no longer available."))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 text-center gap-3">
        <ShieldAlert size={32} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error ?? "This link is no longer available."}</p>
      </div>
    );
  }

  const formattedDateTime = new Date(data.date_time).toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="min-h-[100dvh] px-5 py-8 flex flex-col items-center">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-20 h-20 rounded-full bg-secondary overflow-hidden mb-3">
            {data.matched_user?.photo_url ? (
              <img src={data.matched_user.photo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl text-muted-foreground">
                {data.matched_user?.name?.[0] ?? "?"}
              </div>
            )}
          </div>
          <h1 className="text-xl font-bold">
            {data.matched_user?.name ?? "Someone"}
            {data.matched_user?.age ? `, ${data.matched_user.age}` : ""}
          </h1>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-4 space-y-4 mb-6">
          <div className="flex items-start gap-3">
            <Calendar size={18} className="text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground">When</p>
              <p className="text-sm font-medium">{formattedDateTime}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin size={18} className="text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground">Where</p>
              <p className="text-sm font-medium">{data.location}</p>
            </div>
          </div>
          {data.notes && (
            <div className="flex items-start gap-3">
              <StickyNote size={18} className="text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm">{data.notes}</p>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          This date was shared by {data.shared_by_name ?? "a Deeply user"} via Deeply. If you have concerns, contact them
          directly.
        </p>
      </div>
    </div>
  );
}
