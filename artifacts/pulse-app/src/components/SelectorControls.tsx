import { Check } from "lucide-react";

export function RadioList({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`w-full text-left px-5 py-4 rounded-xl border transition-colors flex items-center justify-between ${
            value === opt.value
              ? "bg-primary/10 border-primary text-foreground"
              : "bg-card border-card-border text-muted-foreground hover:border-muted-foreground/50"
          }`}
        >
          {opt.label}
          {value === opt.value && <Check size={18} className="text-primary" />}
        </button>
      ))}
    </div>
  );
}

export function ChipGrid({
  options,
  selected,
  onToggle,
  max,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  max: number;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isSelected = selected.includes(opt);
          const disabled = !isSelected && selected.length >= max;
          return (
            <button
              key={opt}
              onClick={() => onToggle(opt)}
              disabled={disabled}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all border disabled:opacity-40 ${
                isSelected
                  ? "bg-primary border-primary text-primary-foreground shadow-[0_0_15px_rgba(192,38,211,0.3)]"
                  : "bg-card border-card-border text-muted-foreground hover:border-muted-foreground/50"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground text-right mt-3">{selected.length}/{max} selected</p>
    </>
  );
}
