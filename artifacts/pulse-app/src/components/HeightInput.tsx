import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cmToDisplay, displayToCm, type HeightUnit } from "@/lib/lifestylePreferenceOptions";

const UNITS: { value: HeightUnit; label: string }[] = [
  { value: "cm", label: "cm" },
  { value: "in", label: "in" },
  { value: "ft", label: "ft" },
];

export function HeightInput({
  valueCm,
  onChange,
  placeholder = "e.g. 175",
}: {
  valueCm: number | null;
  onChange: (cm: number | null) => void;
  placeholder?: string;
}) {
  const [unit, setUnit] = useState<HeightUnit>("cm");
  const [text, setText] = useState(valueCm != null ? cmToDisplay(valueCm, unit) : "");

  // Keep the displayed text in sync if valueCm changes from outside
  // (e.g. profile data loading in), without fighting the user's typing.
  useEffect(() => {
    setText(valueCm != null ? cmToDisplay(valueCm, unit) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueCm]);

  const handleUnitChange = (newUnit: HeightUnit) => {
    // Re-render the CURRENT value in the new unit, rather than clearing —
    // switching units shouldn't lose what was already entered.
    if (valueCm != null) {
      setText(cmToDisplay(valueCm, newUnit));
    }
    setUnit(newUnit);
  };

  const handleTextChange = (newText: string) => {
    setText(newText);
    onChange(displayToCm(newText, unit));
  };

  return (
    <div className="flex gap-2">
      <Input
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder={unit === "ft" ? "e.g. 5'10" : placeholder}
        className="bg-card border-card-border h-12 rounded-xl text-base flex-1"
      />
      <div className="flex bg-secondary rounded-xl p-1 shrink-0">
        {UNITS.map((u) => (
          <button
            key={u.value}
            type="button"
            onClick={() => handleUnitChange(u.value)}
            className={`px-3 h-10 rounded-lg text-xs font-semibold transition-colors ${
              unit === u.value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {u.label}
          </button>
        ))}
      </div>
    </div>
  );
}
