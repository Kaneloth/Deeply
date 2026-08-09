import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { isBlockedEitherWay } from "../lib/blocks-helper";
import { getEconomyConfig } from "../lib/economy-config";

const router: IRouter = Router();

/** Attaches an aggregated `reactions` array to each message:
 *  [{ emoji, count, reactedByMe }] — grouped by emoji, not by individual
 *  reactor, since that's all the UI needs to render reaction pills. */
async function attachReactions<T extends { id: string }>(
  messages: T[],
  viewerId: string,
): Promise<(T & { reactions: { emoji: string; count: number; reactedByMe: boolean }[] })[]> {
  if (messages.length === 0) return [];

  const messageIds = messages.map((m) => m.id);
  const { data: reactionRows } = await supabase
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", messageIds);

  const byMessage = new Map<string, { emoji: string; count: number; reactedByMe: boolean }[]>();
  for (const row of reactionRows ?? []) {
    const list = byMessage.get(row.message_id) ?? [];
    const existing = list.find((r) => r.emoji === row.emoji);
    if (existing) {
      existing.count += 1;
      if (row.user_id === viewerId) existing.reactedByMe = true;
    } else {
      list.push({ emoji: row.emoji, count: 1, reactedByMe: row.user_id === viewerId });
    }
    byMessage.set(row.message_id, list);
  }

  return messages.map((m) => ({ ...m, reactions: byMessage.get(m.id) ?? [] }));
}

/** GET /api/matches/:matchId/messages */
router.get("/matches/:matchId/messages", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const { data: match } = await supabase
    .from("matches")
    .select("id, user1_id, user2_id")
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .single();

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("match_id", matchId)
    .eq("is_unsent", false)
    .order("sent_at", { ascending: true });

  const { data: unlock } = await supabase
    .from("read_receipt_unlocks")
    .select("match_id")
    .eq("match_id", matchId)
    .eq("user_id", userId)
    .maybeSingle();

  const hasUnlockedReceipts = !!unlock;

  // Hide the true read status of MY OWN sent messages unless I've paid to
  // unlock read receipts for this match. Messages from the other person
  // always show their real is_read value (that's about my own reading
  // activity, not something to gate).
  const visibleMessages = (messages ?? []).map((m) =>
    m.sender_id === userId && !hasUnlockedReceipts ? { ...m, is_read: false } : m,
  );

  const withReactions = await attachReactions(visibleMessages, userId);

  await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("match_id", matchId)
    .neq("sender_id", userId)
    .eq("is_read", false);

  res.json(withReactions);
});

/** GET /api/matches/:matchId/read-receipts/status */
router.get("/matches/:matchId/read-receipts/status", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const { data: unlock } = await supabase
    .from("read_receipt_unlocks")
    .select("match_id")
    .eq("match_id", matchId)
    .eq("user_id", userId)
    .maybeSingle();

  res.json({ unlocked: !!unlock });
});

/** POST /api/matches/:matchId/read-receipts/unlock — 20 Sparks, one-time
 *  per match. */
router.post("/matches/:matchId/read-receipts/unlock", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const { data: match } = await supabase
    .from("matches")
    .select("id")
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .single();

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const { data: existing } = await supabase
    .from("read_receipt_unlocks")
    .select("match_id")
    .eq("match_id", matchId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    res.json({ unlocked: true, balance: null });
    return;
  }

  const { cost_unlock_read_receipts } = await getEconomyConfig();
  const spend = await spendSparks(userId, cost_unlock_read_receipts, "Unlock read receipts");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${cost_unlock_read_receipts})`, balance: spend.balance });
    return;
  }

  await supabase.from("read_receipt_unlocks").insert({ match_id: matchId, user_id: userId });

  res.json({ unlocked: true, balance: spend.balance });
});

/** POST /api/matches/:matchId/messages — costs 10 Sparks. Chat is always
 *  open once matched, no more lock/limit gating. Supports text, stickers
 *  (a single oversized emoji), and GIFs (an external image URL). */
router.post("/matches/:matchId/messages", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const { content, message_type, media_url } = req.body as {
    content?: string;
    message_type?: "text" | "sticker" | "gif";
    media_url?: string;
  };

  const type = message_type ?? "text";

  if (type === "text" && (!content || content.trim() === "")) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  if ((type === "sticker" || type === "gif") && !content && !media_url) {
    res.status(400).json({ error: "content (sticker emoji) or media_url (gif) is required" });
    return;
  }

  const { data: match } = await supabase
    .from("matches")
    .select("id, user1_id, user2_id, message_count")
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .single();

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const otherUserId = match.user1_id === userId ? match.user2_id : match.user1_id;
  if (await isBlockedEitherWay(userId, otherUserId)) {
    res.status(403).json({ error: "You can't message this person" });
    return;
  }

  const { cost_send_message } = await getEconomyConfig();
  const spend = await spendSparks(userId, cost_send_message, "Message sent");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${cost_send_message})`, balance: spend.balance });
    return;
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      match_id: matchId,
      sender_id: userId,
      content: content?.trim() ?? "",
      message_type: type,
      media_url: media_url ?? null,
    })
    .select("*")
    .single();

  if (error || !message) {
    res.status(500).json({ error: "Failed to send message" });
    return;
  }

  await supabase
    .from("matches")
    .update({ message_count: match.message_count + 1 })
    .eq("id", matchId);

  res.status(201).json({ ...message, reactions: [], sparks_balance: spend.balance });
});

/** POST /api/messages/:messageId/react — toggle an emoji reaction. Free
 *  (no Sparks cost). If the caller has already reacted with this exact
 *  emoji, it's removed; otherwise it's added. */
router.post("/messages/:messageId/react", requireAuth, async (req, res): Promise<void> => {
  const messageId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const userId = req.user!.id;
  const { emoji } = req.body as { emoji?: string };

  if (!emoji) {
    res.status(400).json({ error: "emoji is required" });
    return;
  }

  // Confirm the message belongs to a match this user is part of.
  const { data: message } = await supabase
    .from("messages")
    .select("id, match_id")
    .eq("id", messageId)
    .single();

  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const { data: match } = await supabase
    .from("matches")
    .select("id")
    .eq("id", message.match_id)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .maybeSingle();

  if (!match) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const { data: existing } = await supabase
    .from("message_reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    await supabase.from("message_reactions").delete().eq("id", existing.id);
  } else {
    await supabase.from("message_reactions").insert({ message_id: messageId, user_id: userId, emoji });
  }

  const { data: allReactions } = await supabase
    .from("message_reactions")
    .select("user_id, emoji")
    .eq("message_id", messageId);

  const grouped = new Map<string, { emoji: string; count: number; reactedByMe: boolean }>();
  for (const row of allReactions ?? []) {
    const entry = grouped.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactedByMe: false };
    entry.count += 1;
    if (row.user_id === userId) entry.reactedByMe = true;
    grouped.set(row.emoji, entry);
  }

  res.json({ reactions: [...grouped.values()] });
});

/** POST /api/messages/:messageId/unsend — 10 Sparks, within 60 seconds of
 *  sending. */
router.post("/messages/:messageId/unsend", requireAuth, async (req, res): Promise<void> => {
  const messageId = Array.isArray(req.params.messageId)
    ? req.params.messageId[0]
    : req.params.messageId;
  const userId = req.user!.id;

  const { data: message } = await supabase
    .from("messages")
    .select("*")
    .eq("id", messageId)
    .eq("sender_id", userId)
    .single();

  if (!message) {
    res.status(404).json({ error: "Message not found or not yours" });
    return;
  }

  const sentAt = new Date(message.sent_at).getTime();
  const now = Date.now();
  if (now - sentAt > 5 * 60 * 1000) {
    res.status(410).json({ error: "Unsend window expired (5 minutes)" });
    return;
  }

  const { cost_unsend_message } = await getEconomyConfig();
  const spend = await spendSparks(userId, cost_unsend_message, "Message unsend");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${cost_unsend_message})`, balance: spend.balance });
    return;
  }

  const { data: updated, error } = await supabase
    .from("messages")
    .update({ is_unsent: true })
    .eq("id", messageId)
    .select("*")
    .single();

  if (error || !updated) {
    res.status(500).json({ error: "Failed to unsend" });
    return;
  }

  res.json({ ...updated, sparks_balance: spend.balance });
});

export default router;
