import { useState, useEffect, useCallback } from "react";
import { Search, Loader2 } from "lucide-react";

// GIPHY API key. Set VITE_GIPHY_API_KEY in your environment (Netlify env
// vars) to use your own free key from developers.giphy.com — falls back
// to GIPHY's public "beta" demo key otherwise, which works immediately
// but is shared across countless demo apps and heavily rate-limited.
const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY || "dc6zaTOxFJmzC";

const STICKERS = [
  "😍", "😂", "😘", "🥰", "😎", "🤩", "🥳", "😭", "🔥", "❤️",
  "💯", "👏", "🙌", "🎉", "😉", "🤔", "😅", "🙈", "💕", "✨",
  "😴", "🤗", "😏", "🥹",
];

interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
}

export function MediaPicker({
  onSelectSticker,
  onSelectGif,
}: {
  onSelectSticker: (emoji: string) => void;
  onSelectGif: (url: string) => void;
}) {
  const [tab, setTab] = useState<"stickers" | "gifs">("stickers");
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [isLoadingGifs, setIsLoadingGifs] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);

  const fetchGifs = useCallback(async (searchTerm: string) => {
    setIsLoadingGifs(true);
    setGifError(null);
    try {
      const endpoint = searchTerm.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(searchTerm)}&limit=24&rating=pg-13`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=pg-13`;
      const res = await fetch(endpoint);
      const body = await res.json();

      if (!res.ok || body.meta?.status >= 400) {
        throw new Error(body.meta?.msg || `GIPHY request failed (${res.status})`);
      }

      const results: GifResult[] = (body.data ?? []).map((g: any) => ({
        id: g.id,
        url: g.images?.fixed_height?.url ?? g.images?.original?.url,
        previewUrl: g.images?.fixed_height_small?.url ?? g.images?.fixed_height?.url,
      }));
      setGifs(results);
    } catch (err) {
      setGifs([]);
      setGifError(err instanceof Error ? err.message : "Couldn't load GIFs");
    } finally {
      setIsLoadingGifs(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "gifs") return;
    const handle = setTimeout(() => fetchGifs(query), 350);
    return () => clearTimeout(handle);
  }, [tab, query, fetchGifs]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-2 pb-3 shrink-0">
        <button
          onClick={() => setTab("stickers")}
          className={`flex-1 h-9 rounded-full text-sm font-semibold transition-colors ${
            tab === "stickers" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
          }`}
        >
          Stickers
        </button>
        <button
          onClick={() => setTab("gifs")}
          className={`flex-1 h-9 rounded-full text-sm font-semibold transition-colors ${
            tab === "gifs" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
          }`}
        >
          GIFs
        </button>
      </div>

      {tab === "stickers" ? (
        <div className="grid grid-cols-5 gap-2 overflow-y-auto flex-1 px-2 pb-2">
          {STICKERS.map((emoji, i) => (
            <button
              key={`${emoji}-${i}`}
              onClick={() => onSelectSticker(emoji)}
              className="text-4xl aspect-square flex items-center justify-center rounded-xl hover:bg-secondary transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col flex-1 overflow-hidden px-2 pb-2">
          <div className="relative mb-2 shrink-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search GIFs..."
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-background border border-card-border text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {isLoadingGifs ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            ) : gifError ? (
              <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                <p className="text-sm text-destructive font-medium">Couldn't load GIFs</p>
                <p className="text-xs text-muted-foreground mt-1">{gifError}</p>
              </div>
            ) : gifs.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-sm text-muted-foreground">No GIFs found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {gifs.map((gif) => (
                  <button
                    key={gif.id}
                    onClick={() => onSelectGif(gif.url)}
                    className="rounded-xl overflow-hidden bg-secondary aspect-square"
                  >
                    <img src={gif.previewUrl} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
