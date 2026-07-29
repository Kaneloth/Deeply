import { supabase } from "./supabase";

export interface AudioPromptData {
  id: string;
  prompt_question: string;
  audio_url: string;
  duration_seconds: number | null;
}

/** Attaches an `audio_prompts` array (max 2 per person) to each item in a
 *  list of profile-like objects with an `id`. */
export async function attachAudioPrompts<T extends { id: string }>(
  items: T[],
): Promise<(T & { audio_prompts: AudioPromptData[] })[]> {
  if (items.length === 0) return [];

  const ids = items.map((i) => i.id);
  const { data: prompts } = await supabase
    .from("audio_prompts")
    .select("id, user_id, prompt_question, audio_url, duration_seconds")
    .in("user_id", ids);

  const promptsByUser = new Map<string, AudioPromptData[]>();
  for (const p of prompts ?? []) {
    const list = promptsByUser.get(p.user_id) ?? [];
    if (list.length < 2) {
      list.push({
        id: p.id,
        prompt_question: p.prompt_question,
        audio_url: p.audio_url,
        duration_seconds: p.duration_seconds,
      });
      promptsByUser.set(p.user_id, list);
    }
  }

  return items.map((item) => ({ ...item, audio_prompts: promptsByUser.get(item.id) ?? [] }));
}
