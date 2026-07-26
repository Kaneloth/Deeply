import { useGetMyProfile, useUpdateMyProfile } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { LogOut, CheckCircle2, AlertCircle, Rocket, Plus, X, ImageIcon, Camera, Video } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface BoostStatus {
  is_active: boolean;
  boosted_until: string | null;
  can_boost: boolean;
  next_eligible_at: string | null;
}

interface GalleryPhoto {
  id: string;
  photo_url: string;
  media_type: "image" | "video";
  position: number;
}

const MAX_FREE_PHOTOS = 8;
const MAX_GALLERY_ITEMS = 20;
const EXTRA_PHOTO_COST = 10;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_VIDEO_SIZE = 6 * 1024 * 1024; // 6MB — target is ~3MB for a 5s clip, this is a ceiling not a guarantee
const MAX_VIDEO_DURATION = 6; // actual cutoff; user-facing message still says "5 seconds"
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

function BoostCountdown({ until }: { until: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) {
        setLabel("");
        return;
      }
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setLabel(`${h}h ${m}m`);
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [until]);

  return <>{label}</>;
}

export default function ProfilePage() {
  const { data: profile, isLoading } = useGetMyProfile();
  const updateProfile = useUpdateMyProfile();
  const { logout, token } = useAuth();
  const { refresh: refreshSparksBadge } = useSparks();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    age: "",
    city: "",
    bio: ""
  });

  const [boostStatus, setBoostStatus] = useState<BoostStatus | null>(null);
  const [isBoosting, setIsBoosting] = useState(false);

  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraPhotoInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoInputRef = useRef<HTMLInputElement>(null);

  const fetchPhotos = useCallback(async () => {
    setIsLoadingPhotos(true);
    try {
      const res = await fetch("/api/profile/me/photos", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      setPhotos(body ?? []);
    } catch {
      // Silent — non-critical.
    } finally {
      setIsLoadingPhotos(false);
    }
  }, [token]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const compressImage = (file: File, maxDimension = 1600, targetSize = 2 * 1024 * 1024): Promise<File> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Compression not supported on this device"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        const tryQuality = (quality: number) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("Compression failed"));
                return;
              }
              if (blob.size > targetSize && quality > 0.4) {
                tryQuality(quality - 0.15);
                return;
              }
              const compressed = new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
              resolve(compressed);
            },
            "image/jpeg",
            quality,
          );
        };
        tryQuality(0.85);
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not load that image"));
      };

      img.src = objectUrl;
    });

  // Reads the duration directly out of an MP4/MOV file's own metadata
  // (the 'mvhd' box inside 'moov'), without relying on the browser's
  // video element to decode/report it. Far more reliable across mobile
  // browsers than waiting on loadedmetadata events.
  const parseMp4DurationSeconds = async (file: File): Promise<number | null> => {
    try {
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);
      const len = buffer.byteLength;

      const findBox = (start: number, end: number, boxType: string): { start: number; end: number } | null => {
        let offset = start;
        while (offset + 8 <= end) {
          let size = view.getUint32(offset);
          const type = String.fromCharCode(
            view.getUint8(offset + 4),
            view.getUint8(offset + 5),
            view.getUint8(offset + 6),
            view.getUint8(offset + 7),
          );
          let headerSize = 8;
          if (size === 1) {
            const high = view.getUint32(offset + 8);
            const low = view.getUint32(offset + 12);
            size = high * 2 ** 32 + low;
            headerSize = 16;
          } else if (size === 0) {
            size = end - offset;
          }
          if (size <= 0) break;
          if (type === boxType) {
            return { start: offset + headerSize, end: offset + size };
          }
          offset += size;
        }
        return null;
      };

      const moov = findBox(0, len, "moov");
      if (!moov) return null;
      const mvhd = findBox(moov.start, moov.end, "mvhd");
      if (!mvhd) return null;

      const version = view.getUint8(mvhd.start);
      let timescale: number;
      let duration: number;
      if (version === 1) {
        timescale = view.getUint32(mvhd.start + 20);
        const high = view.getUint32(mvhd.start + 24);
        const low = view.getUint32(mvhd.start + 28);
        duration = high * 2 ** 32 + low;
      } else {
        timescale = view.getUint32(mvhd.start + 12);
        duration = view.getUint32(mvhd.start + 16);
      }

      if (!timescale) return null;
      return duration / timescale;
    } catch {
      return null;
    }
  };

  const getVideoDuration = async (file: File): Promise<number> => {
    // First try: read duration directly from file bytes (MP4/MOV only,
    // covers the vast majority of phone camera clips).
    if (file.type === "video/mp4" || file.type === "video/quicktime") {
      const binaryDuration = await parseMp4DurationSeconds(file);
      if (binaryDuration !== null && binaryDuration > 0) {
        return binaryDuration;
      }
    }

    // Fallback: the browser's own video element (works for WebM, and
    // MP4/MOV files the binary parser couldn't read).
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.style.position = "fixed";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      video.style.width = "1px";
      video.style.height = "1px";
      document.body.appendChild(video);

      const objectUrl = URL.createObjectURL(file);
      let settled = false;

      const finish = (duration: number) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(objectUrl);
        video.remove();
        resolve(duration);
      };

      const checkFixed = () => {
        if (isFinite(video.duration) && video.duration > 0) {
          finish(video.duration);
        }
      };

      video.onloadedmetadata = () => {
        if (isFinite(video.duration) && video.duration > 0) {
          finish(video.duration);
          return;
        }
        video.addEventListener("durationchange", checkFixed);
        video.addEventListener("timeupdate", checkFixed);
        video.currentTime = 1e101;
      };

      video.onerror = () => finish(-1);
      setTimeout(() => finish(-1), 6000);

      video.src = objectUrl;
    });
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);

    if (!isImage && !isVideo) {
      toast({
        title: "Unsupported file type",
        description: "Please choose a JPEG/PNG/WEBP photo or an MP4/WEBM/MOV video clip.",
        variant: "destructive",
      });
      return;
    }

    if (isImage) {
      try {
        file = await compressImage(file);
      } catch (err) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Couldn't process that image.",
          variant: "destructive",
        });
        return;
      }
    }

    if (isImage && file.size > MAX_IMAGE_SIZE) {
      toast({ title: "File too large", description: "This photo is still too large even after compression.", variant: "destructive" });
      return;
    }

    if (isVideo) {
      const duration = await getVideoDuration(file);
      if (duration <= 0) {
        toast({
          title: "Couldn't verify clip length",
          description: "We couldn't confirm this clip is 5 seconds or shorter, so it wasn't uploaded. Try a different clip or app.",
          variant: "destructive",
        });
        return;
      }
      if (duration > MAX_VIDEO_DURATION) {
        toast({
          title: "Clip too long",
          description: `Video clips must be 5 seconds or shorter (this one is ${duration.toFixed(1)}s). Please retake a shorter clip.`,
          variant: "destructive",
        });
        return;
      }
      if (file.size > MAX_VIDEO_SIZE) {
        toast({
          title: "File too large",
          description: `This clip is ${(file.size / 1024 / 1024).toFixed(1)}MB — try recording at a lower quality setting in your camera app, or a shorter clip.`,
          variant: "destructive",
        });
        return;
      }
    }

    setShowAddSheet(false);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);

      const res = await fetch("/api/profile/me/photos", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");

      setPhotos((prev) => [...prev, body]);

      if (body.sparks_charged > 0) {
        toast({
          title: "Added — 10 Sparks used",
          description: "You're past your 8 free photos, so extra items use Sparks like a message.",
        });
        refreshSparksBadge();
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to upload file.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    setDeletingId(photoId);
    try {
      const res = await fetch(`/api/profile/me/photos/${photoId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete photo");
      }
      await fetchPhotos();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to delete photo.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const fetchBoostStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/boost/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      setBoostStatus(body);
    } catch {
      // Silent — non-critical.
    }
  }, [token]);

  useEffect(() => {
    fetchBoostStatus();
  }, [fetchBoostStatus]);

  const handleBoost = async () => {
    setIsBoosting(true);
    try {
      const res = await fetch("/api/profile/boost", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402) {
        toast({
          title: "You're out of Sparks",
          description: "Recharge now or wait for your next monthly grant to boost your profile.",
          variant: "destructive",
        });
        return;
      }

      if (res.status === 429) {
        toast({
          title: "Boost on cooldown",
          description: "You can boost your profile once every 24 hours.",
          variant: "destructive",
        });
        await fetchBoostStatus();
        return;
      }

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to boost");

      toast({ title: "You're boosted!", description: "Your profile has priority placement for the next 5 hours." });
      refreshSparksBadge();
      await fetchBoostStatus();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to boost profile.",
        variant: "destructive",
      });
    } finally {
      setIsBoosting(false);
    }
  };

  // Sync state once data loads
  useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name || "",
        age: profile.age?.toString() || "",
        city: profile.city || "",
        bio: profile.bio || ""
      });
    }
  }, [profile]);

  const hasChanges = profile && (
    formData.name !== profile.name ||
    formData.age !== (profile.age?.toString() || "") ||
    formData.city !== (profile.city || "") ||
    formData.bio !== (profile.bio || "")
  );

  const handleSave = () => {
    if (!profile) return;
    
    updateProfile.mutate({
      data: {
        name: formData.name,
        age: parseInt(formData.age, 10),
        city: formData.city,
        bio: formData.bio
      }
    }, {
      onSuccess: () => {
        toast({ title: "Profile updated", description: "Your changes have been saved." });
      }
    });
  };

  if (isLoading) {
    return <div className="p-6 pt-12"><Skeleton className="h-32 w-32 rounded-full mx-auto" /><Skeleton className="h-64 w-full mt-8" /></div>;
  }

  return (
    <div className="min-h-full pb-6 pt-12 px-6 bg-background">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-['Syne'] font-bold tracking-tight">Profile</h1>
        <Button variant="ghost" size="icon" onClick={logout} className="text-muted-foreground hover:text-destructive">
          <LogOut size={20} />
        </Button>
      </div>

      <div className="flex flex-col items-center mb-10">
        <div className="relative">
          <div className="w-28 h-28 rounded-full border-4 border-background bg-muted overflow-hidden shadow-2xl relative z-10">
            {profile?.photo_url ? (
              <img src={profile.photo_url} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-3xl font-['Syne'] font-bold">
                {profile?.name?.[0]}
              </div>
            )}
          </div>
          {/* Decorative rings */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-36 rounded-full border border-primary/20" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 rounded-full border border-primary/10" />
        </div>
        
        <div className="mt-4 flex items-center gap-2 bg-secondary/50 border border-border px-3 py-1.5 rounded-full">
          {profile?.is_verified ? (
             <><CheckCircle2 size={14} className="text-green-500" /><span className="text-xs font-medium text-muted-foreground">Verified User</span></>
          ) : (
             <><AlertCircle size={14} className="text-accent" /><span className="text-xs font-medium text-muted-foreground">Unverified</span></>
          )}
        </div>
      </div>

      {/* Boost Section */}
      <div className="bg-card border border-card-border rounded-2xl p-5 mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0">
            <Rocket size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-['Syne'] font-bold text-base">Boost</h3>
            <p className="text-xs text-muted-foreground">Priority placement in Discover for 5 hours</p>
          </div>
        </div>

        {boostStatus?.is_active && boostStatus.boosted_until ? (
          <div className="text-center py-2">
            <p className="text-sm font-semibold text-primary">
              Boosted — <BoostCountdown until={boostStatus.boosted_until} /> left
            </p>
          </div>
        ) : (
          <Button
            onClick={handleBoost}
            disabled={isBoosting || (boostStatus !== null && !boostStatus.can_boost)}
            className="w-full h-12 rounded-xl bg-gradient-accent border-0 text-white font-semibold"
          >
            {isBoosting
              ? "Boosting..."
              : boostStatus && !boostStatus.can_boost
                ? "Available again tomorrow"
                : "Boost My Profile"}
          </Button>
        )}
      </div>

      {/* Photos Section */}
      <div className="bg-card border border-card-border rounded-2xl p-5 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-['Syne'] font-bold text-base">Photos & Clips</h3>
            <p className="text-xs text-muted-foreground">
              {photos.length}/{MAX_FREE_PHOTOS} free — extra items cost {EXTRA_PHOTO_COST} Sparks each
            </p>
          </div>
          <ImageIcon size={18} className="text-muted-foreground shrink-0" />
        </div>

        {isLoadingPhotos ? (
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, idx) => (
              <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-muted group">
                {photo.media_type === "video" ? (
                  <video src={photo.photo_url} className="w-full h-full object-cover" muted loop playsInline />
                ) : (
                  <img src={photo.photo_url} alt="" className="w-full h-full object-cover" />
                )}
                {idx === 0 && photo.media_type === "image" && (
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-semibold">
                    Main
                  </span>
                )}
                {photo.media_type === "video" && (
                  <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-semibold">
                    Clip
                  </span>
                )}
                <button
                  onClick={() => handleDeletePhoto(photo.id)}
                  disabled={deletingId === photo.id}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-destructive transition-colors disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            {photos.length < MAX_GALLERY_ITEMS && (
              <button
                onClick={() => setShowAddSheet(true)}
                disabled={isUploading}
                className="aspect-square rounded-xl border-2 border-dashed border-card-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50"
              >
                {isUploading ? (
                  <span className="text-xs">Uploading...</span>
                ) : (
                  <>
                    <Plus size={20} />
                    <span className="text-xs">Add</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Gallery picker (no camera capture) */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          onChange={handleFileSelected}
          className="hidden"
        />
        {/* Camera capture — photo only. Split from video into its own
            input because mixing image+video in `accept` alongside
            `capture` makes many mobile browsers fall back to the
            gallery picker instead of launching the camera. */}
        <input
          ref={cameraPhotoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="user"
          onChange={handleFileSelected}
          className="hidden"
        />
        {/* Camera capture — video only, same reasoning as above. */}
        <input
          ref={cameraVideoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          capture="user"
          onChange={handleFileSelected}
          className="hidden"
        />
      </div>

      {/* Add Photo/Video choice sheet */}
      <AnimatePresence>
        {showAddSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end"
            onClick={() => setShowAddSheet(false)}
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              transition={{ type: "spring", damping: 24 }}
              className="w-full max-w-[430px] mx-auto bg-card border-t border-card-border rounded-t-3xl p-6 pb-10"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-['Syne'] font-bold text-lg mb-4">Add a Photo or Clip</h3>
              <div className="space-y-3">
                <button
                  onClick={() => cameraPhotoInputRef.current?.click()}
                  className="w-full h-14 rounded-xl bg-gradient-accent text-white font-semibold flex items-center justify-center gap-2"
                >
                  <Camera size={18} />
                  Take Photo
                </button>
                <button
                  onClick={() => cameraVideoInputRef.current?.click()}
                  className="w-full h-14 rounded-xl bg-gradient-accent text-white font-semibold flex items-center justify-center gap-2"
                >
                  <Video size={18} />
                  Record Video Clip
                </button>
                <button
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full h-14 rounded-xl bg-secondary text-foreground font-semibold flex items-center justify-center gap-2"
                >
                  <ImageIcon size={18} />
                  Choose from Gallery
                </button>
                <button
                  onClick={() => setShowAddSheet(false)}
                  className="w-full h-12 rounded-xl text-muted-foreground font-medium"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-3 space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Name</label>
            <Input 
              value={formData.name}
              onChange={e => setFormData(prev => ({...prev, name: e.target.value}))}
              className="bg-card border-card-border h-12 rounded-xl text-base" 
            />
          </div>
          <div className="col-span-1 space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Age</label>
            <Input 
              type="number"
              value={formData.age}
              onChange={e => setFormData(prev => ({...prev, age: e.target.value}))}
              className="bg-card border-card-border h-12 rounded-xl text-base text-center" 
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">City</label>
          <Input 
            value={formData.city}
            onChange={e => setFormData(prev => ({...prev, city: e.target.value}))}
            className="bg-card border-card-border h-12 rounded-xl text-base" 
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Bio</label>
          <Textarea 
            value={formData.bio}
            onChange={e => setFormData(prev => ({...prev, bio: e.target.value}))}
            className="bg-card border-card-border min-h-[120px] resize-none rounded-xl p-4 text-base leading-relaxed" 
          />
        </div>

        {profile?.personality_tags && profile.personality_tags.length > 0 && (
          <div className="space-y-2 pt-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Tags (Edit in Onboarding)</label>
            <div className="flex flex-wrap gap-2">
              {profile.personality_tags.map(tag => (
                <span key={tag} className="px-3 py-1.5 bg-secondary text-secondary-foreground text-xs font-medium rounded-full opacity-70">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {hasChanges && (
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-24 left-0 right-0 max-w-[430px] mx-auto px-6 z-40"
        >
          <Button 
            className="w-full h-14 rounded-2xl bg-foreground text-background hover:bg-foreground/90 font-bold text-lg shadow-2xl"
            onClick={handleSave}
            disabled={updateProfile.isPending}
          >
            {updateProfile.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </motion.div>
      )}
    </div>
  );
}
