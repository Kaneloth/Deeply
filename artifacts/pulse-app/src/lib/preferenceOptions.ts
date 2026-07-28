export const INTERESTS = [
  "Hiking", "Coffee", "Reading", "Travel", "Music", "Art",
  "Fitness", "Cooking", "Movies", "Gaming", "Sports", "Fashion",
  "Photography", "Writing", "Meditation", "Dancing", "Yoga", "Foodie",
  "Beach", "Camping", "Volunteering", "Tech", "Startups", "Business",
  "Podcasts", "Books", "Nature", "Pet lover", "Wine/Cocktails", "Nightlife",
  "Homebody", "Adventure", "Learning",
];

export const DATING_INTENTIONS = [
  "Shared values", "Physical attraction", "Sense of humor", "Ambition/Drive",
  "Emotional intelligence", "Shared hobbies", "Good communication",
  "Honesty/Transparency", "Kindness", "Adventure/Spontaneity",
];

export const RELATIONSHIP_TYPES: { value: string; label: string }[] = [
  { value: "short_term", label: "Short-term / Casual" },
  { value: "long_term", label: "Long-term / Serious" },
  { value: "friendship", label: "Friendship" },
  { value: "open", label: "Open to anything" },
  { value: "figuring_it_out", label: "Figuring it out" },
];

export const DISTANCE_OPTIONS = [5, 10, 25, 50, 999];

export const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: "man", label: "Man" },
  { value: "woman", label: "Woman" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export const LOOKING_FOR_OPTIONS: { value: string; label: string }[] = [
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "non_binary", label: "Non-binary" },
  { value: "everyone", label: "Everyone" },
];

export const NUM_KIDS_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "No kids" },
  { value: "one", label: "1 kid" },
  { value: "two", label: "2 kids" },
  { value: "three_plus", label: "3+ kids" },
];

export const SMOKING_OPTIONS: { value: string; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "occasionally", label: "Occasionally" },
  { value: "regularly", label: "Regularly" },
  { value: "trying_to_quit", label: "Trying to quit" },
];

export const DRINKING_OPTIONS: { value: string; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "socially", label: "Socially" },
  { value: "regularly", label: "Regularly" },
];

export const LOVE_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "words_of_affirmation", label: "Words of Affirmation" },
  { value: "acts_of_service", label: "Acts of Service" },
  { value: "receiving_gifts", label: "Receiving Gifts" },
  { value: "quality_time", label: "Quality Time" },
  { value: "physical_touch", label: "Physical Touch" },
];

export const EDUCATION_OPTIONS: { value: string; label: string }[] = [
  { value: "high_school", label: "High School" },
  { value: "trade_vocational", label: "Trade / Vocational" },
  { value: "diploma", label: "Diploma" },
  { value: "bachelors", label: "Bachelor's Degree" },
  { value: "honours", label: "Honours" },
  { value: "masters", label: "Master's Degree" },
  { value: "doctorate", label: "Doctorate" },
];

// South African official languages, plus other major world languages
// (the app is expanding beyond South Africa), plus a free-text Other.
export const LANGUAGES = [
  "Afrikaans", "English", "isiNdebele", "isiXhosa", "isiZulu", "Sepedi",
  "Sesotho", "Setswana", "siSwati", "Tshivenda", "Xitsonga",
  "South African Sign Language",
  "Kiswahili", "French", "Arabic", "Shona", "Spanish", "Persian",
  "Portuguese", "Hausa", "Amharic", "Yoruba", "Igbo", "Somali",
  "Mandarin", "Hindi", "German",
  "Other",
];
