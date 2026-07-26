import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search as SearchIcon, Heart, X, SlidersHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PERSONALITY_TAGS = [
  "Sarcastic", "Curious", "Night Owl", "Coffee Snob",
  "Bookworm", "Dog Person", "Foodie", "Traveler",
  "Introvert", "Empath", "Creative", "Ambitious",
];

interface Result {
  id: string;
  name: string;
  age: number;
  bio: string | null;
  city: string | null;
  photo_url: string | null;
  personality_tags: string[];
  integrity_score: number;
}

export default function SearchPage() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [city, setCity] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [results, setResults] = useState<Result[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setIsSearching(true);
    try {
      const params = new URLSearchParams();
      if (name.trim()) params.set("name", name.trim());
      if (minAge) params.set("min_age", minAge);
      if (maxAge) params.set("max_age", maxAge);
      if (city.trim()) params.set("city", city.trim());
      if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));

      const res = await fetch(`/api/discover/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setResults(body.results ?? []);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Search failed.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSwipe = async (targetId: string, direction: "like" | "pass") => {
    setActioningId(targetId);
    try {
      const res = await fetch("/api/discover/swipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetId, direction }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to record swipe");

      setResults((prev) => (prev ? prev.filter((r) => r.id !== targetId) : prev));

      if (body.matched) {
        toast({ title: "It's a Match!", description: "Head to Matches to say hi." });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="min-h-full pb-6 pt-10 px-4">
      <header className="mb-6 px-2">
        <h1 className="text-2xl font-['Syne'] font-bold tracking-tight">Search</h1>
      </header>

      <form onSubmit={handleSearch} className="space-y-3 mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Search by name..."
              className="bg-card border-card-border pl-10 h-12 rounded-xl"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-12 rounded-xl shrink-0 border-card-border bg-card p-0"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal size={18} className={showFilters ? "text-primary" : "text-muted-foreground"} />
          </Button>
        </div>

        {showFilters && (
          <div className="bg-card border border-card-border rounded-2xl p-4 space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground">Min age</label>
                <Input
                  type="number"
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value)}
                  placeholder="18"
                  className="bg-background border-card-border h-10 mt-1"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground">Max age</label>
                <Input
                  type="number"
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                  placeholder="99"
                  className="bg-background border-card-border h-10 mt-1"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">City</label>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Cape Town"
                className="bg-background border-card-border h-10 mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Interests</label>
              <div className="flex flex-wrap gap-2">
                {PERSONALITY_TAGS.map((tag) => {
                  const isSelected = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "bg-background border-card-border text-muted-foreground hover:border-muted-foreground/50"
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <Button type="submit" disabled={isSearching} className="w-full h-12 rounded-xl bg-gradient-accent border-0 text-white font-semibold">
          {isSearching ? "Searching..." : "Search"}
        </Button>
      </form>

      {results === null ? (
        <div className="flex flex-col items-center text-center px-4 mt-6 text-muted-foreground">
          <SearchIcon size={28} className="mb-4 opacity-40" />
          <p className="max-w-[240px] text-sm">Search by name, or use filters to narrow down by age, city, or interests.</p>
        </div>
      ) : isSearching ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center text-center px-4 mt-6 text-muted-foreground">
          <p className="text-sm">No profiles match your search.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <div key={r.id} className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-card-border">
              <div className="w-16 h-16 rounded-xl bg-muted overflow-hidden shrink-0">
                {r.photo_url ? (
                  <img src={r.photo_url} alt={r.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
                    <span className="text-primary font-bold font-['Syne']">{r.name?.[0]}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">
                  {r.name}, {r.age}
                </h3>
                {r.city && <p className="text-xs text-muted-foreground truncate">{r.city}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleSwipe(r.id, "pass")}
                  disabled={actioningId === r.id}
                  className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X size={16} />
                </button>
                <button
                  onClick={() => handleSwipe(r.id, "like")}
                  disabled={actioningId === r.id}
                  className="w-9 h-9 rounded-full bg-gradient-accent flex items-center justify-center text-white"
                >
                  <Heart size={16} className="fill-current" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
