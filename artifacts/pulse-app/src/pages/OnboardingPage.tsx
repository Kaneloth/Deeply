import { useState } from "react";
import { useUpdateMyProfile } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

const PERSONALITY_TAGS = [
  "Sarcastic", "Curious", "Night Owl", "Coffee Snob", 
  "Bookworm", "Dog Person", "Foodie", "Traveler", 
  "Introvert", "Empath", "Creative", "Ambitious"
];

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const [city, setCity] = useState("");
  const [bio, setBio] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  
  const updateProfile = useUpdateMyProfile();

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : prev.length < 5 ? [...prev, tag] : prev
    );
  };

  const handleComplete = () => {
    updateProfile.mutate({
      data: {
        city,
        bio,
        personality_tags: selectedTags
      }
    }, {
      onSuccess: () => {
        setLocation("/discover");
      }
    });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col p-6 w-full bg-background relative pt-12 pb-8">
      {/* Background glow */}
      <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-primary/10 blur-[80px] rounded-full pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 flex flex-col z-10"
      >
        <h1 className="text-3xl font-['Syne'] font-bold text-foreground tracking-tight">
          Complete your <span className="text-transparent bg-clip-text bg-gradient-accent">profile</span>
        </h1>
        <p className="text-muted-foreground mt-2 mb-8">
          This is what your daily matches will see before they unlock your photo. Make it count.
        </p>

        <div className="space-y-6 flex-1">
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Where are you based?</label>
            <Input 
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. San Francisco, CA" 
              className="bg-card border-card-border h-12 text-base rounded-xl"
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Your Audio Bio</label>
            <Textarea 
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What makes you tick? Share something real." 
              className="bg-card border-card-border min-h-[100px] resize-none text-base rounded-xl p-4"
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Your Vibe (Pick up to 5)</label>
            <div className="flex flex-wrap gap-2">
              {PERSONALITY_TAGS.map(tag => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 border ${
                      isSelected 
                        ? "bg-primary border-primary text-primary-foreground shadow-[0_0_15px_rgba(192,38,211,0.3)]" 
                        : "bg-card border-card-border text-muted-foreground hover:border-muted-foreground/50"
                    }`}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground text-right">{selectedTags.length}/5 selected</p>
          </div>
        </div>

        <Button 
          onClick={handleComplete}
          disabled={updateProfile.isPending || !city || selectedTags.length === 0}
          className="w-full h-14 rounded-xl text-lg font-semibold bg-gradient-accent border-0 mt-8 shadow-[0_4px_20px_rgba(225,29,72,0.3)]"
        >
          {updateProfile.isPending ? "Saving..." : "Start Matching"}
        </Button>
      </motion.div>
    </div>
  );
}
