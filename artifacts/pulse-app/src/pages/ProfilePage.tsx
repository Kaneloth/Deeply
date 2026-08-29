import { useAuth } from "@/contexts/AuthContext";
import { useSparks } from "@/contexts/SparksContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Capacitor } from "@capacitor/core";
import { Camera as CapacitorCamera } from "@capacitor/camera";
import { CheckCircle2, AlertCircle, Rocket, Plus, X, ImageIcon, Camera, Video, Mic, Play, Pause, Crown, Star } from "lucide-react";
import { SparkIcon } from "@/components/Icons";
import { SparksModal } from "@/components/SparksModal";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { ChipGrid } from "@/components/SelectorControls";
import { Dropdown, MultiSelectDropdown } from "@/components/DropdownControls";
import { AudioRecorderControl } from "@/components/AudioRecorderControl";
import {
  INTERESTS,
  GENDER_OPTIONS,
  NUM_KIDS_OPTIONS,
  FAMILY_PLANS_OPTIONS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  LOVE_LANGUAGE_OPTIONS,
  EDUCATION_OPTIONS,
  LANGUAGES,
} from "@/lib/preferenceOptions";
import { TATTOO_OPTIONS, VAPING_OPTIONS, PETS_OPTIONS, ACTIVITY_LEVEL_OPTIONS, NIGHTLIFE_OPTIONS } from "@/lib/lifestylePreferenceOptions";
import { HeightInput } from "@/components/HeightInput";
import { VerificationSection } from "@/components/VerificationSection";

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

interface VoiceQuestion {
  id: string;
  audio_url: string;
  duration_seconds: number | null;
  created_at: string;
  is_expired: boolean;
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

// Birthday picker bounds: must be at least 18, and a sane upper bound of
// 100 years old.
const _today = new Date();
const MAX_BIRTHDATE = new Date(_today.getFullYear() - 18, _today.getMonth(), _today.getDate())
  .toISOString()
  .split("T")[0];
const MIN_BIRTHDATE = new Date(_today.getFullYear() - 100, _today.getMonth(), _today.getDate())
  .toISOString()
  .split("T")[0];

// In-memory only, same pattern as DiscoverPage.tsx's cachedCandidates.
// Three separate caches since profile, photos, and boost status are all
// independently fetched. cachedProfile alone is enough to seed every
// individual form field too — the existing population effect keyed on
// `profile` re-runs on mount whenever it starts non-null.
import { readPersistentCache, writePersistentCache, registerCacheResetter } from "@/lib/persistentCache";
import { useRefetchOnAppResume } from "@/hooks/useRefetchOnAppResume";
import { usePullToRefresh } from "@/contexts/PullToRefreshContext";

const PROFILE_DATA_CACHE_KEY = "profile_data";
const PROFILE_PHOTOS_CACHE_KEY = "profile_photos";
const PROFILE_BOOST_CACHE_KEY = "profile_boost_status";

let cachedProfileData: any = readPersistentCache<any>(PROFILE_DATA_CACHE_KEY);
let cachedPhotos: GalleryPhoto[] | null = readPersistentCache<GalleryPhoto[]>(PROFILE_PHOTOS_CACHE_KEY);
let cachedBoostStatus: BoostStatus | null = readPersistentCache<BoostStatus>(PROFILE_BOOST_CACHE_KEY);

function updateProfileDataCache(value: any) {
  cachedProfileData = value;
  writePersistentCache(PROFILE_DATA_CACHE_KEY, value);
}
function updateProfilePhotosCache(value: GalleryPhoto[]) {
  cachedPhotos = value;
  writePersistentCache(PROFILE_PHOTOS_CACHE_KEY, value);
}
function updateProfileBoostCache(value: BoostStatus) {
  cachedBoostStatus = value;
  writePersistentCache(PROFILE_BOOST_CACHE_KEY, value);
}
registerCacheResetter(() => {
  cachedProfileData = null;
  cachedPhotos = null;
  cachedBoostStatus = null;
});

export default function ProfilePage() {
  const { token } = useAuth();
  const { balance, refresh: refreshSparksBadge } = useSparks();
  const [showSparksModal, setShowSparksModal] = useState(false);
  const { toast } = useToast();
  const [profile, setProfile] = useState<any>(cachedProfileData);
  const [isLoading, setIsLoading] = useState(cachedProfileData === null);
  const [isSaving, setIsSaving] = useState(false);
  // fetchProfile is defined once via useCallback and read through refs
  // by useRefetchOnAppResume — a plain `isSaving` state read inside it
  // would close over whatever value existed when fetchProfile was last
  // recreated, not necessarily the current one. This ref is always
  // current regardless of when/why fetchProfile actually runs.
  const isSavingRef = useRef(false);
  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  const fetchProfile = useCallback(async () => {
    // Never let a background refresh (mount, or resume-from-background
    // via useRefetchOnAppResume) fire while a save is actively in
    // flight — a GET and PUT racing on the exact same profiles row is
    // exactly the kind of concurrent access previously traced to
    // intermittent PGRST116 "0 rows returned" failures on the save
    // itself. Skipping here is free (there's nothing to refresh that
    // the imminent save result won't already reflect) and removes one
    // real source of that race outright.
    if (isSavingRef.current) return;
    if (cachedProfileData === null) setIsLoading(true);
    try {
      const res = await fetch("/api/profile/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load profile");
      updateProfileDataCache(body);
      setProfile(body);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load profile.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [token, toast]);

  // Run once on mount only. fetchProfile depends on `token`, and token
  // changes every time AuthContext silently refreshes the session in the
  // background — which happens routinely, well before actual expiry, and
  // again reactively on any 401. Depending on fetchProfile's identity
  // here meant every one of those background refreshes reset isLoading
  // to true, flashing the whole page back to its skeleton and resetting
  // scroll to the top — even if you were scrolled to the bottom editing
  // preferences. None of that was supposed to happen just because a
  // token silently rotated in the background.
  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRefetchOnAppResume(fetchProfile);

  const [formData, setFormData] = useState({
    name: "",
    birthday: "",
    city: "",
    bio: ""
  });

  const [gender, setGender] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [numKids, setNumKids] = useState("");
  const [familyPlans, setFamilyPlans] = useState("");
  const [smokingStatus, setSmokingStatus] = useState("");
  const [drinkingStatus, setDrinkingStatus] = useState("");
  const [languagesSpoken, setLanguagesSpoken] = useState<string[]>([]);
  const [languagesOther, setLanguagesOther] = useState("");
  const [loveLanguage, setLoveLanguage] = useState("");
  const [education, setEducation] = useState("");
  const [hasTattoos, setHasTattoos] = useState("");
  const [vapingStatus, setVapingStatus] = useState("");
  const [pets, setPets] = useState("");
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [activityLevel, setActivityLevel] = useState("");
  const [nightlifeFrequency, setNightlifeFrequency] = useState("");

  const toggleInterest = (v: string) => {
    setInterests((prev) => (prev.includes(v) ? prev.filter((i) => i !== v) : prev.length < 10 ? [...prev, v] : prev));
  };

  const [boostStatus, setBoostStatus] = useState<BoostStatus | null>(cachedBoostStatus);
  const [isBoosting, setIsBoosting] = useState(false);

  const [photos, setPhotos] = useState<GalleryPhoto[]>(cachedPhotos ?? []);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(cachedPhotos === null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingMainId, setSettingMainId] = useState<string | null>(null);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraPhotoInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoInputRef = useRef<HTMLInputElement>(null);

  const fetchPhotos = useCallback(async () => {
    if (cachedPhotos === null) setIsLoadingPhotos(true);
    try {
      const res = await fetch("/api/profile/me/photos", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      const fresh = body ?? [];
      updateProfilePhotosCache(fresh);
      setPhotos(fresh);
    } catch {
      // Silent — non-critical.
    } finally {
      setIsLoadingPhotos(false);
    }
  }, [token]);

  // Run once on mount only — same reasoning as fetchProfile above.
  useEffect(() => {
    fetchPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRefetchOnAppResume(fetchPhotos);

  const [voiceQuestion, setVoiceQuestion] = useState<VoiceQuestion | null>(null);
  const [isLoadingVoiceQuestion, setIsLoadingVoiceQuestion] = useState(true);
  const [showVoiceQuestionSheet, setShowVoiceQuestionSheet] = useState(false);
  const [isSavingVoiceQuestion, setIsSavingVoiceQuestion] = useState(false);
  const [isRenewingVoiceQuestion, setIsRenewingVoiceQuestion] = useState(false);
  const [isPlayingVoiceQuestion, setIsPlayingVoiceQuestion] = useState(false);
  const voiceQuestionAudioRef = useRef<HTMLAudioElement | null>(null);
  // Fetched purely for display in the recording sheet, same pattern
  // VerificationSection already uses for its own admin-configurable fee
  // — never hardcoded, always read live so a price change in the admin
  // dashboard is reflected immediately.
  const [voiceQuestionRecordCost, setVoiceQuestionRecordCost] = useState<number | null>(null);
  const [voiceQuestionExpiryDays, setVoiceQuestionExpiryDays] = useState<number | null>(null);

  // The filename extension must match the blob's real format, not
  // assume web's audio/webm — native recordings (capacitor-voice-recorder)
  // come back as audio/aac or similar, and a mismatched extension is
  // exactly what produces an "unsupported format" rejection server-side.
  const audioExtensionFromMimeType = (mimeType: string): string => {
    const map: Record<string, string> = {
      "audio/webm": "webm",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/3gpp": "3gp",
    };
    return map[mimeType] ?? "webm";
  };

  const fetchVoiceQuestion = useCallback(async () => {
    setIsLoadingVoiceQuestion(true);
    try {
      const res = await fetch("/api/voice-question/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      setVoiceQuestion(body.question ?? null);
    } catch {
      // Silent — non-critical, same as fetchPhotos above.
    } finally {
      setIsLoadingVoiceQuestion(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetchVoiceQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRefetchOnAppResume(fetchVoiceQuestion);

  useEffect(() => {
    fetch("/api/app-settings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body && typeof body.cost_voice_question_record === "number") {
          setVoiceQuestionRecordCost(body.cost_voice_question_record);
        }
        if (body && typeof body.voice_question_expiry_days === "number") {
          setVoiceQuestionExpiryDays(body.voice_question_expiry_days);
        }
      })
      .catch(() => {
        // Silent — the sheet just shows a loading state for the price
        // until this resolves, same convention as VerificationSection.
      });
  }, [token]);

  const togglePlayVoiceQuestion = () => {
    if (!voiceQuestion) return;
    if (isPlayingVoiceQuestion) {
      voiceQuestionAudioRef.current?.pause();
      setIsPlayingVoiceQuestion(false);
      return;
    }
    const audio = new Audio(voiceQuestion.audio_url);
    audio.onended = () => setIsPlayingVoiceQuestion(false);
    audio.play();
    voiceQuestionAudioRef.current = audio;
    setIsPlayingVoiceQuestion(true);
  };

  // Whether recording right now would be free — an active (non-expired)
  // question already exists, so this would be treated as a replace, not
  // a fresh paid recording. Computed here purely for what the sheet
  // displays; the backend independently makes the real charging
  // decision itself using the same logic, and is the only one that
  // actually matters for correctness.
  const voiceQuestionReplaceIsFree = !!voiceQuestion && !voiceQuestion.is_expired;

  const saveVoiceQuestion = async (blob: Blob) => {
    setIsSavingVoiceQuestion(true);
    try {
      const formData = new FormData();
      const extension = audioExtensionFromMimeType(blob.type);
      formData.append("audio", blob, `voice-question.${extension}`);
      const uploadRes = await fetch("/api/prompts/audio-upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadBody.error ?? "Upload failed");

      const saveRes = await fetch("/api/voice-question", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ audio_url: uploadBody.audio_url }),
      });
      const saveBody = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saveBody.error ?? "Failed to save voice question");

      setVoiceQuestion({ ...saveBody.question, is_expired: false });
      setShowVoiceQuestionSheet(false);
      toast({ title: saveBody.charged ? "Voice Question recorded" : "Voice Question updated" });
      if (saveBody.charged) refreshSparksBadge();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save your voice question.",
        variant: "destructive",
      });
    } finally {
      setIsSavingVoiceQuestion(false);
    }
  };

  // Renews using the recording already on file, no re-recording
  // required — sends no audio_url at all, which the backend treats as
  // "reuse whatever's already there" (see POST /voice-question). Costs
  // exactly the same as a brand new recording — the audio was never
  // what was being charged for, an active window is.
  const handleRenewVoiceQuestion = async () => {
    setIsRenewingVoiceQuestion(true);
    try {
      const res = await fetch("/api/voice-question", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to renew your voice question");

      setVoiceQuestion({ ...body.question, is_expired: false });
      toast({ title: "Voice Question renewed" });
      refreshSparksBadge();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to renew your voice question.",
        variant: "destructive",
      });
    } finally {
      setIsRenewingVoiceQuestion(false);
    }
  };

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

  const uploadFiles = async (selectedFiles: File[]) => {
    if (selectedFiles.length === 0) return;

    setShowAddSheet(false);
    setIsUploading(true);

    // Track a local running copy since React state won't reflect earlier
    // items in this same batch until after each render.
    let localPhotos = [...photos];
    let successCount = 0;
    let failCount = 0;
    let totalSparksCharged = 0;

    for (const originalFile of selectedFiles) {
      let file = originalFile;
      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
      const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);

      if (!isImage && !isVideo) {
        toast({
          title: "Unsupported file type",
          description: `${originalFile.name}: please choose a JPEG/PNG/WEBP photo or MP4/WEBM/MOV clip.`,
          variant: "destructive",
        });
        failCount++;
        continue;
      }

      if (isVideo && localPhotos.some((p) => p.media_type === "video")) {
        toast({
          title: "Only 1 video clip allowed",
          description: `${originalFile.name} skipped — delete your existing clip first.`,
          variant: "destructive",
        });
        failCount++;
        continue;
      }

      if (isImage) {
        try {
          file = await compressImage(file);
        } catch (err) {
          toast({
            title: "Error",
            description: `${originalFile.name}: ${err instanceof Error ? err.message : "couldn't process image"}`,
            variant: "destructive",
          });
          failCount++;
          continue;
        }
        if (file.size > MAX_IMAGE_SIZE) {
          toast({
            title: "File too large",
            description: `${originalFile.name} is still too large even after compression.`,
            variant: "destructive",
          });
          failCount++;
          continue;
        }
      }

      if (isVideo) {
        const duration = await getVideoDuration(file);
        if (duration <= 0) {
          toast({
            title: "Couldn't verify clip length",
            description: `${originalFile.name} wasn't uploaded — couldn't confirm it's 5 seconds or shorter.`,
            variant: "destructive",
          });
          failCount++;
          continue;
        }
        if (duration > MAX_VIDEO_DURATION) {
          toast({
            title: "Clip too long",
            description: `${originalFile.name} is ${duration.toFixed(1)}s — must be 5 seconds or shorter.`,
            variant: "destructive",
          });
          failCount++;
          continue;
        }
        if (file.size > MAX_VIDEO_SIZE) {
          toast({
            title: "File too large",
            description: `${originalFile.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB — try a lower quality camera setting.`,
            variant: "destructive",
          });
          failCount++;
          continue;
        }
      }

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

        localPhotos = [...localPhotos, body];
        setPhotos((prev) => {
          const next = [...prev, body];
          updateProfilePhotosCache(next);
          return next;
        });
        successCount++;

        if (body.sparks_charged > 0) {
          totalSparksCharged += body.sparks_charged;
        }
      } catch (err) {
        toast({
          title: "Error",
          description: `${originalFile.name}: ${err instanceof Error ? err.message : "upload failed"}`,
          variant: "destructive",
        });
        failCount++;
      }
    }

    setIsUploading(false);

    if (totalSparksCharged > 0) {
      refreshSparksBadge();
    }

    if (successCount > 0) {
      const parts: string[] = [];
      if (totalSparksCharged > 0) parts.push(`${totalSparksCharged} Sparks used for items beyond your free ${MAX_FREE_PHOTOS}.`);
      if (failCount > 0) parts.push(`${failCount} item${failCount === 1 ? "" : "s"} couldn't be added.`);
      toast({
        title: successCount === 1 ? "Added" : `Added ${successCount} items`,
        description: parts.length > 0 ? parts.join(" ") : undefined,
      });
    }
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ""; // allow re-selecting the same file(s) later
    await uploadFiles(selectedFiles);
  };

  // Native-only — calls the device's camera directly instead of relying
  // on the HTML file input's capture="user" hint, which Android's
  // WebView doesn't reliably honor (that's exactly what was opening the
  // gallery instead of the camera). Reuses the same uploadFiles pipeline
  // as the file-input path, just skipping straight to a real File.
  const handleNativeTakePhoto = async () => {
    setShowAddSheet(false);
    try {
      const result = await CapacitorCamera.takePhoto({ quality: 90 });
      if (!result.webPath) return;
      const response = await fetch(result.webPath);
      const blob = await response.blob();
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
      await uploadFiles([file]);
    } catch {
      // User cancelled, or camera access was denied — nothing to do.
    }
  };

  // Native-only — recordVideo() is explicitly not available on Web, so
  // the web path keeps using the existing file input unchanged.
  const handleNativeRecordVideo = async () => {
    setShowAddSheet(false);
    try {
      const result = await CapacitorCamera.recordVideo({ saveToGallery: false, isPersistent: false });
      const sourcePath = result.webPath ?? result.uri;
      if (!sourcePath) return;
      const response = await fetch(sourcePath);
      const blob = await response.blob();
      const file = new File([blob], `clip-${Date.now()}.mp4`, { type: blob.type || "video/mp4" });
      await uploadFiles([file]);
    } catch {
      // User cancelled, or camera access was denied — nothing to do.
    }
  };

  const handleSetMainPhoto = async (photoId: string) => {
    setSettingMainId(photoId);
    try {
      const res = await fetch(`/api/profile/me/photos/${photoId}/set-main`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to set main photo");
      }
      await Promise.all([fetchPhotos(), fetchProfile()]);
      toast({ title: "Main photo updated" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to set main photo.",
        variant: "destructive",
      });
    } finally {
      setSettingMainId(null);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    setDeletingId(photoId);
    const previousPhotos = photos;
    // Optimistic — remove immediately so the tap feels instant, rather
    // than waiting on a full fetchPhotos() round-trip before anything
    // visually changes. Rolled back below if the delete actually fails.
    setPhotos((prev) => {
      const next = prev.filter((p) => p.id !== photoId);
      updateProfilePhotosCache(next);
      return next;
    });
    try {
      const res = await fetch(`/api/profile/me/photos/${photoId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete photo");
      }
      // Background refresh for eventual consistency (position re-packing,
      // profiles.photo_url sync happen server-side) — not awaited, so it
      // never delays the already-instant visual removal above.
      fetchPhotos();
    } catch (err) {
      updateProfilePhotosCache(previousPhotos);
      setPhotos(previousPhotos); // roll back — it wasn't actually deleted
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
      updateProfileBoostCache(body);
      setBoostStatus(body);
    } catch {
      // Silent — non-critical.
    }
  }, [token]);

  // Run once on mount only — same reasoning as fetchProfile above.
  useEffect(() => {
    fetchBoostStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRefetchOnAppResume(fetchBoostStatus);

  // Combines all four of this page's independent fetches (each already
  // has its own useRefetchOnAppResume above) into one handler for pull-
  // to-refresh — a person pulling down on their own profile means "make
  // sure everything here is current", not just one piece of it.
  usePullToRefresh(async () => {
    await Promise.all([fetchProfile(), fetchPhotos(), fetchVoiceQuestion(), fetchBoostStatus()]);
  });

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
        birthday: profile.birthday || "",
        city: profile.city || "",
        bio: profile.bio || ""
      });
      setGender(profile.gender || "");
      setInterests(profile.personality_tags || []);
      setNumKids(profile.num_kids || "");
      setFamilyPlans(profile.family_plans || "");
      setSmokingStatus(profile.smoking_status || "");
      setDrinkingStatus(profile.drinking_status || "");
      setLanguagesSpoken(profile.languages_spoken || []);
      setLanguagesOther(profile.languages_other || "");
      setLoveLanguage(profile.love_language || "");
      setEducation(profile.education || "");
      setHasTattoos(profile.has_tattoos || "");
      setVapingStatus(profile.vaping_status || "");
      setPets(profile.pets || "");
      setHeightCm(profile.height_cm ?? null);
      setActivityLevel(profile.activity_level || "");
      setNightlifeFrequency(profile.nightlife_frequency || "");
    }
  }, [profile]);

  const hasChanges = profile && (
    formData.name !== profile.name ||
    formData.birthday !== (profile.birthday || "") ||
    formData.city !== (profile.city || "") ||
    formData.bio !== (profile.bio || "") ||
    gender !== (profile.gender || "") ||
    JSON.stringify(interests) !== JSON.stringify(profile.personality_tags || []) ||
    numKids !== (profile.num_kids || "") ||
    familyPlans !== (profile.family_plans || "") ||
    smokingStatus !== (profile.smoking_status || "") ||
    drinkingStatus !== (profile.drinking_status || "") ||
    JSON.stringify(languagesSpoken) !== JSON.stringify(profile.languages_spoken || []) ||
    languagesOther !== (profile.languages_other || "") ||
    loveLanguage !== (profile.love_language || "") ||
    education !== (profile.education || "") ||
    hasTattoos !== (profile.has_tattoos || "") ||
    vapingStatus !== (profile.vaping_status || "") ||
    pets !== (profile.pets || "") ||
    heightCm !== (profile.height_cm ?? null) ||
    activityLevel !== (profile.activity_level || "") ||
    nightlifeFrequency !== (profile.nightlife_frequency || "")
  );

  const handleSave = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/profile/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formData.name,
          birthday: formData.birthday,
          city: formData.city,
          bio: formData.bio,
          gender,
          personality_tags: interests,
          num_kids: numKids,
          family_plans: familyPlans,
          smoking_status: smokingStatus,
          drinking_status: drinkingStatus,
          languages_spoken: languagesSpoken,
          languages_other: languagesOther,
          love_language: loveLanguage,
          education,
          has_tattoos: hasTattoos,
          vaping_status: vapingStatus,
          pets,
          height_cm: heightCm,
          activity_level: activityLevel,
          nightlife_frequency: nightlifeFrequency,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save profile");
      updateProfileDataCache(body);
      setProfile(body);
      toast({ title: "Profile updated", description: "Your changes have been saved." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save profile.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-6 pt-12"><Skeleton className="h-32 w-32 rounded-full mx-auto" /><Skeleton className="h-64 w-full mt-8" /></div>;
  }

  return (
    <div className="min-h-full px-6 pb-6 pt-6 bg-background">
      <PageHeader title="Profile" />

      <div className="flex flex-col items-center mb-10">
        <div className="relative w-44 h-44 flex items-center justify-center">
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
        
        <div className="mt-4 flex items-center gap-2">
          <div className="flex items-center gap-2 bg-secondary/50 border border-border px-3 py-1.5 rounded-full">
            {profile?.is_verified ? (
               <><CheckCircle2 size={14} className="text-green-500" /><span className="text-xs font-medium text-muted-foreground">Verified User</span></>
            ) : (
               <><AlertCircle size={14} className="text-accent" /><span className="text-xs font-medium text-muted-foreground">Unverified</span></>
            )}
          </div>
          {profile?.is_founder && (
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-full">
              <Crown size={14} className="text-amber-500" />
              <span className="text-xs font-medium text-amber-600">Founder</span>
            </div>
          )}
        </div>
      </div>

      {/* Sparks */}
      <button
        onClick={() => setShowSparksModal(true)}
        className="w-full flex items-center justify-between bg-card border border-card-border rounded-2xl p-4 mb-8"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <SparkIcon size={18} className="text-primary" />
          </div>
          <div className="text-left">
            <p className="font-['Syne'] font-bold text-base">{balance ?? 0} Sparks</p>
            <p className="text-xs text-muted-foreground">Tap to recharge or see what they're for</p>
          </div>
        </div>
      </button>

      <VerificationSection />

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
                {idx !== 0 && photo.media_type === "image" && (
                  <button
                    onClick={() => handleSetMainPhoto(photo.id)}
                    disabled={settingMainId === photo.id}
                    className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-semibold hover:bg-black/80 transition-colors disabled:opacity-50"
                  >
                    <Star size={10} />
                    {settingMainId === photo.id ? "..." : "Set Main"}
                  </button>
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

        {/* Gallery picker — allows selecting multiple files at once */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          onChange={handleFilesSelected}
          multiple
          className="hidden"
        />
        {/* Camera capture — photo only. One at a time, inherent to how a
            live camera launch works. Split from video into its own input
            because mixing image+video in `accept` alongside `capture`
            makes many mobile browsers fall back to the gallery picker
            instead of launching the camera. */}
        <input
          ref={cameraPhotoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="user"
          onChange={handleFilesSelected}
          className="hidden"
        />
        {/* Camera capture — video only, same reasoning as above. */}
        <input
          ref={cameraVideoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          capture="user"
          onChange={handleFilesSelected}
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
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-end"
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
                  onClick={() => (Capacitor.isNativePlatform() ? handleNativeTakePhoto() : cameraPhotoInputRef.current?.click())}
                  className="w-full h-14 rounded-xl bg-gradient-accent text-white font-semibold flex items-center justify-center gap-2"
                >
                  <Camera size={18} />
                  Take Photo
                </button>
                <button
                  onClick={() => (Capacitor.isNativePlatform() ? handleNativeRecordVideo() : cameraVideoInputRef.current?.click())}
                  disabled={photos.some((p) => p.media_type === "video")}
                  className="w-full h-14 rounded-xl bg-gradient-accent text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Video size={18} />
                  Record Video Clip
                </button>
                {photos.some((p) => p.media_type === "video") && (
                  <p className="text-xs text-muted-foreground text-center -mt-2">
                    Only 1 video clip allowed — delete your current one to add a new one.
                  </p>
                )}
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

      {/* Voice Question — deliberately its own distinct, prominent
          section rather than folded into Audio Prompts below: this is
          a different feature entirely (a question others can reply to
          from Discover, creating a real invite), not another static
          prompt. */}
      <div className="bg-card border border-card-border rounded-2xl p-5 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-['Syne'] font-bold text-base">Voice Question</h3>
            <p className="text-xs text-muted-foreground">
              Ask something on Discover — replies count as invites
            </p>
          </div>
          <Mic size={18} className="text-muted-foreground shrink-0" />
        </div>

        {isLoadingVoiceQuestion ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : voiceQuestion && !voiceQuestion.is_expired ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 bg-background border border-card-border rounded-xl p-3">
              <button
                onClick={togglePlayVoiceQuestion}
                className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0"
              >
                {isPlayingVoiceQuestion ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <p className="text-sm flex-1 min-w-0 text-muted-foreground">Your voice question is live</p>
            </div>
            <button
              onClick={() => setShowVoiceQuestionSheet(true)}
              className="w-full h-11 rounded-xl border border-card-border text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
            >
              Replace — free while your question is active
            </button>
          </div>
        ) : voiceQuestion && voiceQuestion.is_expired ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-500/10 rounded-xl p-3">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>Your voice question expired. Keep your existing recording or record a new one to start receiving voice replies again.</span>
            </div>
            <div className="flex items-center gap-3 bg-background border border-card-border rounded-xl p-3">
              <button
                onClick={togglePlayVoiceQuestion}
                className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center text-white shrink-0"
              >
                {isPlayingVoiceQuestion ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <p className="text-sm flex-1 min-w-0 text-muted-foreground">Preview your expired question</p>
            </div>
            <button
              onClick={handleRenewVoiceQuestion}
              disabled={isRenewingVoiceQuestion}
              className="w-full h-14 rounded-xl bg-gradient-accent text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isRenewingVoiceQuestion
                ? "Renewing..."
                : `Keep Same Recording${voiceQuestionRecordCost !== null ? ` — ${voiceQuestionRecordCost} Sparks` : ""}`}
            </button>
            <button
              onClick={() => setShowVoiceQuestionSheet(true)}
              className="w-full h-14 rounded-xl border-2 border-dashed border-card-border flex items-center justify-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
            >
              <Mic size={16} />
              Record a New Voice Question
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowVoiceQuestionSheet(true)}
            className="w-full h-14 rounded-xl border-2 border-dashed border-card-border flex items-center justify-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
          >
            <Mic size={16} />
            Record Your Voice Question
          </button>
        )}
      </div>

      <AnimatePresence>
        {showVoiceQuestionSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-0 top-0 bottom-20 z-[100] bg-background/80 backdrop-blur-sm flex items-end"
            onClick={() => !isSavingVoiceQuestion && setShowVoiceQuestionSheet(false)}
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              transition={{ type: "spring", damping: 24 }}
              className="w-[calc(100%-2rem)] max-w-[398px] mx-auto bg-card border border-card-border rounded-3xl p-6 mb-4 max-h-[70vh] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h3 className="font-['Syne'] font-bold text-lg">Record Your Voice Question</h3>
                {!isSavingVoiceQuestion && (
                  <button
                    onClick={() => setShowVoiceQuestionSheet(false)}
                    className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="overflow-y-auto flex-1 min-h-0">
                <p className="text-sm text-muted-foreground mb-3">
                  Ask something you're curious about — up to 10 seconds. Anyone who replies with their own
                  voice sends you a real invite.
                </p>
                <p className="text-xs font-medium bg-background border border-card-border rounded-xl p-3 mb-4">
                  {voiceQuestionReplaceIsFree
                    ? "Replacing your active question — free."
                    : voiceQuestionRecordCost !== null
                      ? `Costs ${voiceQuestionRecordCost} Sparks. Free to re-record for ${voiceQuestionExpiryDays ?? "a few"} days after.`
                      : "Loading price..."}
                </p>
                <AudioRecorderControl
                  onSave={saveVoiceQuestion}
                  isSaving={isSavingVoiceQuestion}
                  saveLabel={voiceQuestionReplaceIsFree ? "Save Replacement" : "Record Voice Question"}
                  maxDurationSeconds={10}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Name</label>
          <Input 
            value={formData.name}
            onChange={e => setFormData(prev => ({...prev, name: e.target.value}))}
            className="bg-card border-card-border h-12 rounded-xl text-base" 
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">
            Birthday {profile?.age != null && <span className="normal-case text-muted-foreground/70">(age {profile.age})</span>}
          </label>
          <Input 
            type="date"
            value={formData.birthday}
            onChange={e => setFormData(prev => ({...prev, birthday: e.target.value}))}
            max={MAX_BIRTHDATE}
            min={MIN_BIRTHDATE}
            className="bg-card border-card-border h-12 rounded-xl text-base" 
          />
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

        <Dropdown label="I am a" value={gender} onChange={setGender} options={GENDER_OPTIONS} />

        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">
            Interests (up to 10)
          </h3>
          <ChipGrid options={INTERESTS} selected={interests} onToggle={toggleInterest} max={10} />
        </div>

        <Dropdown label="Kids" value={numKids} onChange={setNumKids} options={NUM_KIDS_OPTIONS} />
        <Dropdown label="Family plans" value={familyPlans} onChange={setFamilyPlans} options={FAMILY_PLANS_OPTIONS} />
        <Dropdown label="Smoking" value={smokingStatus} onChange={setSmokingStatus} options={SMOKING_OPTIONS} />
        <Dropdown label="Vaping" value={vapingStatus} onChange={setVapingStatus} options={VAPING_OPTIONS} />
        <Dropdown label="Drinking" value={drinkingStatus} onChange={setDrinkingStatus} options={DRINKING_OPTIONS} />
        <Dropdown label="Tattoos" value={hasTattoos} onChange={setHasTattoos} options={TATTOO_OPTIONS} />
        <Dropdown label="Pets" value={pets} onChange={setPets} options={PETS_OPTIONS} />
        <Dropdown label="Physical activity" value={activityLevel} onChange={setActivityLevel} options={ACTIVITY_LEVEL_OPTIONS} />
        <Dropdown label="Nightlife" value={nightlifeFrequency} onChange={setNightlifeFrequency} options={NIGHTLIFE_OPTIONS} />

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Height</label>
          <HeightInput valueCm={heightCm} onChange={setHeightCm} />
        </div>

        <Dropdown label="Love language" value={loveLanguage} onChange={setLoveLanguage} options={LOVE_LANGUAGE_OPTIONS} />
        <Dropdown label="Education" value={education} onChange={setEducation} options={EDUCATION_OPTIONS} />

        <MultiSelectDropdown label="Languages spoken" options={LANGUAGES} selected={languagesSpoken} onChange={setLanguagesSpoken} />
        {languagesSpoken.includes("Other") && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Other language(s)</label>
            <Input
              value={languagesOther}
              onChange={(e) => setLanguagesOther(e.target.value)}
              placeholder="e.g. Portuguese, Mandarin"
              className="bg-card border-card-border h-12 rounded-xl text-base"
            />
          </div>
        )}
      </div>

      {hasChanges && (
        <div className="mt-8 pb-2">
          <Button 
            className="w-full h-14 rounded-2xl bg-foreground text-background hover:bg-foreground/90 font-bold text-lg shadow-2xl"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}

      {showSparksModal && <SparksModal onClose={() => setShowSparksModal(false)} />}
    </div>
  );
}
