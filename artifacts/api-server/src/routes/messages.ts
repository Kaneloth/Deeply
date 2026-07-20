import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { deductSparks } from "../lib/sparks-helper";

const router: IRouter = Router();

/** GET /api/matches/:matchId/messages */
router.get("/matches/:matchId/messages", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  // Verify user is a participant
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

  // Mark unread messages from the other user as read
  await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("match_id", matchId)
    .neq("sender_id", userId)
    .eq("is_read", false);

  res.json(messages ?? []);
});

/** POST /api/matches/:matchId/messages */
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

  // Verify match and check chat status
  const { data: match } = await supabase
    .from("matches")
    .select("id, user1_id, user2_id, chat_unlocked, message_count, message_limit")
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .single();

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  if (!match.chat_unlocked) {
    res.status(403).json({ error: "Chat is locked — unlock it with a Chat Key first" });
    return;
  }

  if (match.message_count >= match.message_limit) {
    res.status(403).json({
      error: `Message limit (${match.message_limit}) reached — use Stretch to add more`,
    });
    return;
  }

  // Insert message and increment counter atomically
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

  // Increment message count
  await supabase
    .from("matches")
    .update({ message_count: match.message_count + 1 })
    .eq("id", matchId);

  res.status(201).json(message);
});

/** POST /api/messages/:messageId/unsend — 1 free/day, else 2 Sparks */
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

  // Check 60-second window
  const sentAt = new Date(message.sent_at).getTime();
  const now = Date.now();
  if (now - sentAt > 60 * 1000) {
    res.status(410).json({ error: "Unsend window expired (60 seconds)" });
    return;
  }

  // Check free unsend for today
  const today = new Date().toISOString().split("T")[0];
  const { data: usedFree } = await supabase
    .from("daily_earn_claims")
    .select("id")
    .eq("user_id", userId)
    .eq("claim_type", "free_unsend_used")
    .eq("claimed_date", today)
    .single();

  if (!usedFree) {
    await supabase.from("daily_earn_claims").insert({
      user_id: userId,
      claim_type: "free_unsend_used",
      claimed_date: today,
    });
  } else {
    const spark = await deductSparks(userId, 2, "Emergency Unsend");
    if (!spark.success) {
      res.status(402).json({ error: "Insufficient Sparks (need 2) and no free unsends remaining" });
      return;
    }
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

  res.json(updated);
});

export default router;
