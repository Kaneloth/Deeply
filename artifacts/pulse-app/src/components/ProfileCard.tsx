import { MapPin } from "lucide-react";
import { PhotoCarousel, type CarouselPhoto } from "@/components/PhotoCarousel";

export interface ProfileCardData {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  photos: CarouselPhoto[];
  personality_tags: string[];
}

export function ProfileCard({ profile, active = true }: { profile: ProfileCardData; active?: boolean }) {
  const photos = profile.photos.length > 0 ? profile.photos : [];
  const hasDetails = profile.personality_tags?.length > 0 || !!profile.bio;

  return (
    <div className="w-full h-full bg-card border border-card-border rounded-3xl overflow-hidden shadow-2xl relative">
      <div className="w-full h-full overflow-y-auto">
        {/* Photo — fills the entire card by default (edge to edge), so
            it's the only thing visible until the user scrolls down.
            Name/age/location sit in a compact overlay strictly at the
            bottom edge, never in the middle of the image. */}
        <div className="relative w-full h-full min-h-full bg-muted">
          <PhotoCarousel photos={photos} name={profile.name} active={active} />

          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />
          <div className="absolute bottom-3 left-4 right-4 pointer-events-none z-10">
            <h2 className="text-2xl font-['Syne'] font-bold text-white flex items-end gap-2 leading-tight">
              {profile.name} <span className="text-base font-normal text-white/80">{profile.age}</span>
            </h2>
            {profile.city && (
              <div className="flex items-center gap-1 text-white/70 text-xs mt-0.5">
                <MapPin size={12} /> {profile.city}
              </div>
            )}
          </div>
        </div>

        {/* Details — below the fold, only reached by scrolling down past
            the photo. */}
        {hasDetails && (
          <div className="w-full bg-card px-5 py-4">
            {profile.personality_tags?.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {profile.personality_tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {profile.bio && <p className="text-sm text-muted-foreground leading-relaxed">{profile.bio}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
