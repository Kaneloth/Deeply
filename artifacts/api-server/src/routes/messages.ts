import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";

const router: IRouter = Router();

const MESSAGE_COST = 10;
const UNSEND_COST = 10;
const READ_RECEIPT_COST = 20;

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

  await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("match_id", matchId)
    .neq("sender_id", userId)
    .eq("is_read", false);

  res.json(visibleMessages);
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

  const spend = await spendSparks(userId, READ_RECEIPT_COST, "Unlock read receipts");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${READ_RECEIPT_COST})`, balance: spend.balance });
    return;
  }

  await supabase.from("read_receipt_unlocks").insert({ match_id: matchId, user_id: userId });

  res.json({ unlocked: true, balance: spend.balance });
});

/** POST /api/matches/:matchId/messages — costs 10 Sparks. Chat is always
 *  open once matched, no more lock/limit gating. */
router.post("/matches/:matchId/messages", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const { content } = req.body as { content?: string };
  if (!content || content.trim() === "") {
    res.status(400).json({ error: "content is required" });
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

  const spend = await spendSparks(userId, MESSAGE_COST, "Message sent");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${MESSAGE_COST})`, balance: spend.balance });
    return;
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      match_id: matchId,
      sender_id: userId,
      content: content.trim(),
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

  res.status(201).json({ ...message, sparks_balance: spend.balance });
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

  const spend = await spendSparks(userId, UNSEND_COST, "Message unsend");
  if (!spend.success) {
    res.status(402).json({ error: `Insufficient Sparks (need ${UNSEND_COST})`, balance: spend.balance });
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
