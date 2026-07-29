import { useState } from "react";

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Smileys",
    emojis: ["😀", "😂", "🥰", "😍", "😘", "😊", "😉", "😎", "🤩", "🥳", "😅", "🙃", "😇", "🤗", "🤔", "😏", "😴", "🥱", "😭", "😢", "😳", "🙈", "😬", "🤯"],
  },
  {
    label: "Love",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "😻", "💋", "💐", "🌹", "😽"],
  },
  {
    label: "Gestures",
    emojis: ["👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "✌️", "🤞", "👋", "🤙", "👌", "🫶", "🖐️", "✋", "🤟"],
  },
  {
    label: "Celebration",
    emojis: ["🎉", "🎊", "🔥", "✨", "💯", "🥂", "🍾", "🎁", "🏆", "⭐", "🌟", "💫"],
  },
  {
    label: "Fun",
    emojis: ["😂", "🤣", "😜", "🤪", "😝", "🤠", "🥸", "👻", "😈", "🤡", "💀", "👽"],
  },
];

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [activeCategory, setActiveCategory] = useState(0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 px-2 pb-2 overflow-x-auto shrink-0">
        {EMOJI_CATEGORIES.map((cat, i) => (
          <button
            key={cat.label}
            onClick={() => setActiveCategory(i)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeCategory === i ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-1 overflow-y-auto flex-1 px-2 pb-2">
        {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            onClick={() => onSelect(emoji)}
            className="text-2xl aspect-square flex items-center justify-center rounded-lg hover:bg-secondary transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
