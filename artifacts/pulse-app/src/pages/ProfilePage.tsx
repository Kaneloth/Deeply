import { useGetMyProfile, useUpdateMyProfile } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { LogOut, CheckCircle2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

export default function ProfilePage() {
  const { data: profile, isLoading } = useGetMyProfile();
  const updateProfile = useUpdateMyProfile();
  const { logout } = useAuth();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    age: "",
    city: "",
    bio: ""
  });

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
