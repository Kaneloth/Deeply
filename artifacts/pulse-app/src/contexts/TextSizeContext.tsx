import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type TextSize = "normal" | "large" | "xlarge";

const SIZE_PX: Record<TextSize, string> = {
  normal: "16px",
  large: "18px",
  xlarge: "20px",
};

interface TextSizeContextValue {
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
}

const TextSizeContext = createContext<TextSizeContextValue | null>(null);

const STORAGE_KEY = "deeply_text_size";

export function TextSizeProvider({ children }: { children: ReactNode }) {
  const [textSize, setTextSizeState] = useState<TextSize>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === "large" || saved === "xlarge" ? saved : "normal";
  });

  useEffect(() => {
    document.documentElement.style.fontSize = SIZE_PX[textSize];
    localStorage.setItem(STORAGE_KEY, textSize);
  }, [textSize]);

  const setTextSize = (size: TextSize) => setTextSizeState(size);

  return <TextSizeContext.Provider value={{ textSize, setTextSize }}>{children}</TextSizeContext.Provider>;
}

export function useTextSize() {
  const ctx = useContext(TextSizeContext);
  if (!ctx) throw new Error("useTextSize must be used within TextSizeProvider");
  return ctx;
}
