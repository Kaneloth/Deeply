import { useState } from "react";
import { ChevronDown, Check, X } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

/** A compact single-select control. Shows the current selection as a
 *  closed row; tapping opens a bottom sheet with the full option list. */
export function Dropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">{label}</h3>
      <button
        onClick={() => setOpen(true)}
        className="w-full h-12 px-4 rounded-xl bg-card border border-card-border flex items-center justify-between text-left"
      >
        <span className={current ? "text-foreground" : "text-muted-foreground"}>
          {current?.label ?? "Select..."}
        </span>
        <ChevronDown size={18} className="text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="fixed inset-x-0 top-0 bottom-20 z-[100] bg-background/80 backdrop-blur-sm flex items-end" onClick={() => setOpen(false)}>
          <div
            className="w-[calc(100%-2rem)] max-w-[398px] mx-auto bg-card border border-card-border rounded-3xl p-6 mb-4 max-h-[60vh] flex flex-col shadow-2xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="font-['Syne'] font-bold text-lg">{label}</h3>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto flex-1 min-h-0">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors flex items-center justify-between ${
                    value === opt.value
                      ? "bg-primary/10 border-primary text-foreground"
                      : "bg-background border-card-border text-muted-foreground hover:border-muted-foreground/50"
                  }`}
                >
                  {opt.label}
                  {value === opt.value && <Check size={16} className="text-primary" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A compact multi-select control. Shows selected items (or a count) as a
 *  closed row; tapping opens a bottom sheet with checkable options. */
export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  max,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  max?: number;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt));
    } else if (!max || selected.length < max) {
      onChange([...selected, opt]);
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">{label}</h3>
      <button
        onClick={() => setOpen(true)}
        className="w-full min-h-12 px-4 py-3 rounded-xl bg-card border border-card-border flex items-center justify-between text-left"
      >
        <span className={selected.length > 0 ? "text-foreground" : "text-muted-foreground"}>
          {selected.length > 0 ? selected.join(", ") : "Select..."}
        </span>
        <ChevronDown size={18} className="text-muted-foreground shrink-0 ml-2" />
      </button>

      {open && (
        <div className="fixed inset-x-0 top-0 bottom-20 z-[100] bg-background/80 backdrop-blur-sm flex items-end" onClick={() => setOpen(false)}>
          <div
            className="w-[calc(100%-2rem)] max-w-[398px] mx-auto bg-card border border-card-border rounded-3xl p-6 mb-4 max-h-[60vh] flex flex-col shadow-2xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="font-['Syne'] font-bold text-lg">{label}</h3>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 space-y-2 mb-4">
              {options.map((opt) => {
                const isSelected = selected.includes(opt);
                const disabled = !isSelected && !!max && selected.length >= max;
                return (
                  <button
                    key={opt}
                    onClick={() => toggle(opt)}
                    disabled={disabled}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-colors flex items-center justify-between disabled:opacity-40 ${
                      isSelected
                        ? "bg-primary/10 border-primary text-foreground"
                        : "bg-background border-card-border text-muted-foreground hover:border-muted-foreground/50"
                    }`}
                  >
                    {opt}
                    {isSelected && <Check size={16} className="text-primary" />}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-full h-12 rounded-xl bg-gradient-accent text-white font-semibold shrink-0"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A draggable radius slider for distance preference. */
export function RadiusSlider({
  label = "Distance preference",
  valueKm,
  onChange,
  min = 5,
  max = 150,
  step = 5,
  unlimitedAt = 150,
}: {
  label?: string;
  valueKm: number;
  onChange: (km: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unlimitedAt?: number;
}) {
  const displayValue = valueKm >= unlimitedAt ? "Anywhere" : `Within ${valueKm} km`;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">{label}</h3>
      <div className="bg-card border border-card-border rounded-xl px-4 py-4">
        <p className="text-center font-['Syne'] font-bold text-lg mb-3">{displayValue}</p>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(valueKm, max)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-primary"
          style={{ height: "6px" }}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>{min} km</span>
          <span>Anywhere</span>
        </div>
      </div>
    </div>
  );
}
