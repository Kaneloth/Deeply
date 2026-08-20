import { useState, useRef, useEffect } from "react";

export interface CarouselPhoto {
  url: string;
  media_type: "image" | "video";
}

const PHOTO_DRAG_THRESHOLD_PCT = 20;

interface PhotoCarouselProps {
  photos: CarouselPhoto[];
  name: string;
  active?: boolean; // only the front/visible card should respond to touch
  onIndexChange?: (index: number) => void;
}

export function PhotoCarousel({ photos, name, active = true, onIndexChange }: PhotoCarouselProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [dragPercent, setDragPercent] = useState(0);
  const isDraggingPhoto = dragPercent !== 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStateRef = useRef({ startX: 0, startY: 0, active: false, axisLocked: false, horizontal: false });
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({});
  // Tracks which images have actually finished downloading/decoding, so
  // each one can fade in independently once it's genuinely ready — not
  // whenever the parent card's own entrance animation happens to reach
  // full opacity. Without this, the card's container fades in on a fixed
  // 300ms timer regardless of whether the photo inside has loaded yet;
  // on a slow connection the image can pop in well after the card is
  // already fully visible, which reads as a jarring flash/glitch rather
  // than a smooth reveal. This is far more noticeable on a slow mobile
  // connection than on fast WiFi, which is exactly the web-vs-native
  // difference in severity.
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());

  // Keep the latest index/length available to the native (non-passive)
  // touchmove listener without re-attaching it on every render.
  const photoIndexRef = useRef(photoIndex);
  const photosLengthRef = useRef(photos.length);
  const dragPercentRef = useRef(dragPercent);
  useEffect(() => { photoIndexRef.current = photoIndex; }, [photoIndex]);
  useEffect(() => { photosLengthRef.current = photos.length; }, [photos.length]);
  useEffect(() => { dragPercentRef.current = dragPercent; }, [dragPercent]);

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

  // React's onTouchMove prop attaches a PASSIVE listener by default, so
  // calling preventDefault() inside it silently fails (and logs a console
  // warning). To actually block vertical scroll while horizontally
  // dragging, we attach this one listener manually as non-passive.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !active || photos.length <= 1) return;

    const onMove = (e: TouchEvent) => {
      const t = touchStateRef.current;
      if (!t.active) return;

      const dx = e.touches[0].clientX - t.startX;
      const dy = e.touches[0].clientY - t.startY;

      if (!t.axisLocked) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        t.axisLocked = true;
        t.horizontal = Math.abs(dx) > Math.abs(dy);
      }

      if (!t.horizontal) return;
      e.preventDefault();

      const width = el.getBoundingClientRect().width || 1;
      let pct = (dx / width) * 100;
      if (pct > 0 && photoIndexRef.current === 0) pct *= 0.15;
      if (pct < 0 && photoIndexRef.current === photosLengthRef.current - 1) pct *= 0.15;
      setDragPercent(pct);
    };

    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, [active, photos.length]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!active || photos.length <= 1) return;
    touchStateRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      active: true,
      axisLocked: false,
      horizontal: false,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const t = touchStateRef.current;
    t.active = false;

    if (!t.axisLocked) {
      const rect = containerRef.current?.getBoundingClientRect();
      const tapX = e.changedTouches[0]?.clientX;
      if (rect && tapX !== undefined) {
        const relativeX = tapX - rect.left;
        if (relativeX < rect.width / 3) goPrev();
        else if (relativeX > (rect.width * 2) / 3) goNext();
      }
      setDragPercent(0);
      return;
    }

    if (!t.horizontal) {
      setDragPercent(0);
      return;
    }

    if (dragPercentRef.current < -PHOTO_DRAG_THRESHOLD_PCT && photoIndex < photos.length - 1) {
      setPhotoIndex((i) => i + 1);
    } else if (dragPercentRef.current > PHOTO_DRAG_THRESHOLD_PCT && photoIndex > 0) {
      setPhotoIndex((i) => i - 1);
    }
    setDragPercent(0);
  };

  const N = Math.max(photos.length, 1);
  const baseX = -(photoIndex / N) * 100;
  const dragX = (dragPercent / 100) * (100 / N);
  const stripX = baseX + dragX;

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

      <div
        ref={containerRef}
        className="relative w-full h-full overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: "pan-y" }}
      >
        <div
          className="absolute inset-0 flex h-full"
          style={{
            width: `${N * 100}%`,
            transform: `translateX(${stripX}%)`,
            transition: isDraggingPhoto ? "none" : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
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
                <img
                  src={photo.url}
                  alt={name}
                  className="w-full h-full object-cover transition-opacity duration-200"
                  style={{ opacity: loadedImages.has(idx) ? 1 : 0 }}
                  draggable={false}
                  onLoad={() => setLoadedImages((prev) => new Set(prev).add(idx))}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
