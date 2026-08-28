export interface CountryCodeOption {
  label: string;
  code: string;
}

// Not exhaustive of all ~195 countries — a working, commonly-needed set
// covering Southern Africa (this app's actual market) plus other major
// regions, rather than an unwieldy full ISO list for a phone-number
// entry field.
export const COUNTRY_CODES: CountryCodeOption[] = [
  { label: "🇿🇦 South Africa", code: "+27" },
  { label: "🇳🇦 Namibia", code: "+264" },
  { label: "🇧🇼 Botswana", code: "+267" },
  { label: "🇿🇼 Zimbabwe", code: "+263" },
  { label: "🇱🇸 Lesotho", code: "+266" },
  { label: "🇸🇿 Eswatini", code: "+268" },
  { label: "🇲🇿 Mozambique", code: "+258" },
  { label: "🇿🇲 Zambia", code: "+260" },
  { label: "🇳🇬 Nigeria", code: "+234" },
  { label: "🇰🇪 Kenya", code: "+254" },
  { label: "🇬🇭 Ghana", code: "+233" },
  { label: "🇪🇬 Egypt", code: "+20" },
  { label: "🇬🇧 United Kingdom", code: "+44" },
  { label: "🇺🇸 United States", code: "+1" },
  { label: "🇨🇦 Canada", code: "+1" },
  { label: "🇦🇺 Australia", code: "+61" },
  { label: "🇳🇿 New Zealand", code: "+64" },
  { label: "🇮🇪 Ireland", code: "+353" },
  { label: "🇩🇪 Germany", code: "+49" },
  { label: "🇫🇷 France", code: "+33" },
  { label: "🇳🇱 Netherlands", code: "+31" },
  { label: "🇪🇸 Spain", code: "+34" },
  { label: "🇵🇹 Portugal", code: "+351" },
  { label: "🇮🇹 Italy", code: "+39" },
  { label: "🇮🇳 India", code: "+91" },
  { label: "🇵🇰 Pakistan", code: "+92" },
  { label: "🇧🇩 Bangladesh", code: "+880" },
  { label: "🇵🇭 Philippines", code: "+63" },
  { label: "🇧🇷 Brazil", code: "+55" },
  { label: "🇦🇪 UAE", code: "+971" },
  { label: "🇸🇦 Saudi Arabia", code: "+966" },
  { label: "🇨🇳 China", code: "+86" },
];
