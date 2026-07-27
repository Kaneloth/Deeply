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

  return (
    <div className="w-full h-full bg-card border border-card-border rounded-3xl overflow-hidden shadow-2xl relative flex flex-col">
      {/* Photo — fixed proportion so the details section below always gets
          real, scrollable space regardless of screen size. */}
      <div className="relative h-[55%] min-h-[320px] shrink-0 w-full bg-muted overflow-hidden">
        <PhotoCarousel photos={photos} name={profile.name} active={active} />

        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-card to-transparent pointer-events-none" />
        <div className="absolute bottom-4 left-6 right-6 pointer-events-none z-10">
          <h2 className="text-3xl font-['Syne'] font-bold text-white flex items-end gap-2">
            {profile.name} <span className="text-xl font-normal text-white/80">{profile.age}</span>
          </h2>
          {profile.city && (
            <div className="flex items-center gap-1 text-white/70 text-sm mt-1">
              <MapPin size={14} /> {profile.city}
            </div>
          )}
        </div>
      </div>

      {/* Details — always scrollable, so long bios/many tags are never
          cut off no matter how much content there is. */}
      <div className="flex-1 overflow-y-auto p-5 min-h-0">
        {profile.personality_tags?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {profile.personality_tags.map((tag) => (
              <span key={tag} className="px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                {tag}
              </span>
            ))}
          </div>
        )}
        {profile.bio && <p className="text-sm text-muted-foreground leading-relaxed">{profile.bio}</p>}
      </div>
    </div>
  );
}
