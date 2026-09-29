import { useState, useRef, useEffect } from "react";

export interface CarouselPhoto {
  url: string;
  media_type: "image" | "video";
}

interface PhotoCarouselProps {
  photos: CarouselPhoto[];
  name: string;
  active?: boolean; // only the front/visible card should respond to touch
  onIndexChange?: (index: number) => void;
}

// 2026-09-26: this used to also support dragging horizontally to change
// photos, with its own touch tracking and a drag-percent threshold. That
// was removed to free up horizontal drag entirely for the Tinder-style
// swipe-to-decide gesture on the card itself (DiscoverPage.tsx's
// SwipeCard) — the two gestures shared the same finger movement and
// would otherwise compete for it. Tap-to-advance is how the real Tinder
// app handles this same conflict, and it needs nothing fancier than a
// single click handler: no touch tracking, no axis-lock, no
// preventDefault — which also means this component no longer has any
// chance of interfering with the outer card's drag gesture recognition.
export function PhotoCarousel({ photos, name, active = true, onIndexChange }: PhotoCarouselProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({});

  useEffect(() => {
    onIndexChange?.(photoIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoIndex]);

  const goNext = () => setPhotoIndex((i) => Math.min(i + 1, Math.max(photos.length - 1, 0)));
  const goPrev = () => setPhotoIndex((i) => Math.max(i - 1, 0));

  // Video playback is controlled imperatively — toggling the `autoPlay`
  // attribute after a video element already exists in the DOM does NOT
  // restart playback in most browsers. We must call .play()/.pause()
  // directly whenever the active photo changes.
  useEffect(() => {
    Object.entries(videoRefs.current).forEach(([idxStr, el]) => {
      if (!el) return;
      const idx = Number(idxStr);
      if (idx === photoIndex) {
        el.currentTime = 0;
        el.play().catch(() => {
          // Autoplay can be blocked in some contexts — silently ignore,
          // the poster frame (first video frame) still shows.
        });
      } else {
        el.pause();
      }
    });
  }, [photoIndex]);

  // Tap zones: left third = previous, right two-thirds = next (matching
  // the original tap-fallback behavior this component already had
  // alongside its old drag system). `onClick` fires for a genuine tap
  // reliably even inside a WebView, and — importantly — does NOT fire
  // after the ancestor SwipeCard's drag gesture has actually moved the
  // card past its own small internal click-suppression threshold, so a
  // real card swipe never accidentally also advances the photo.
  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || photos.length <= 1) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relativeX = e.clientX - rect.left;
    if (relativeX < rect.width / 3) goPrev();
    else goNext();
  };

  const N = Math.max(photos.length, 1);

  if (photos.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-card to-background">
        <span className="text-primary text-6xl font-bold font-['Syne'] opacity-20">{name?.[0]}</span>
      </div>
    );
  }

  return (
    <>
      {photos.length > 1 && (
        <>
          <div className="absolute top-3 left-3 right-3 z-20 flex gap-1 pointer-events-none">
            {photos.map((_, idx) => (
              <div key={idx} className="flex-1 h-1.5 rounded-full bg-white/40 overflow-hidden">
                <div className={`h-full bg-white transition-all duration-200 ${idx <= photoIndex ? "w-full" : "w-0"}`} />
              </div>
            ))}
          </div>
          <div className="absolute top-7 right-3 z-20 px-2 py-0.5 rounded-full bg-black/50 pointer-events-none">
            <span className="text-white text-xs font-semibold">
              {photoIndex + 1} / {photos.length}
            </span>
          </div>
        </>
      )}

      <div ref={containerRef} className="relative w-full h-full overflow-hidden" onClick={handleTap}>
        <div
          className="absolute inset-0 flex h-full"
          style={{
            width: `${N * 100}%`,
            transform: `translateX(${-(photoIndex / N) * 100}%)`,
            transition: "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          }}
        >
          {photos.map((photo, idx) => (
            <div key={photo.url} style={{ width: `${100 / N}%` }} className="h-full shrink-0 bg-muted">
              {photo.media_type === "video" ? (
                <video
                  ref={(el) => {
                    videoRefs.current[idx] = el;
                  }}
                  src={photo.url}
                  className="w-full h-full object-cover"
                  muted
                  loop
                  playsInline
                />
              ) : (
                <img src={photo.url} alt={name} className="w-full h-full object-cover" draggable={false} />
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
