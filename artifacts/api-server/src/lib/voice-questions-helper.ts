import { supabase } from "./supabase";
import { getEconomyConfig } from "./economy-config";

export interface VoiceQuestionData {
  id: string;
  audio_url: string;
  duration_seconds: number | null;
}

/** Attaches a `voice_question` (singular, nullable) to each item in a
 *  list of profile-like objects with an `id` — only ever a currently
 *  ACTIVE (non-expired) question. An expired one is treated exactly
 *  like having none at all here, so a stranger can never see or reply
 *  to a stale question. (The owner still sees their own expired
 *  question on their own Profile page — that's a separate read, in
 *  profile.ts's GET /voice-question/me, which does surface is_expired
 *  for that specific case.) */
export async function attachVoiceQuestions<T extends { id: string }>(
  items: T[],
): Promise<(T & { voice_question: VoiceQuestionData | null })[]> {
  if (items.length === 0) return [];

  const ids = items.map((i) => i.id);
  const [{ data: questions }, { voice_question_expiry_days: expiryDays }] = await Promise.all([
    supabase.from("voice_questions").select("id, user_id, audio_url, duration_seconds, created_at").in("user_id", ids),
    getEconomyConfig(),
  ]);

  const cutoffMs = Date.now() - expiryDays * 24 * 60 * 60 * 1000;
  const activeByUser = new Map<string, VoiceQuestionData>();
  for (const q of questions ?? []) {
    if (new Date(q.created_at).getTime() >= cutoffMs) {
      activeByUser.set(q.user_id, { id: q.id, audio_url: q.audio_url, duration_seconds: q.duration_seconds });
    }
  }

  return items.map((item) => ({ ...item, voice_question: activeByUser.get(item.id) ?? null }));
}
