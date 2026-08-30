import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabase } from "../lib/supabase";
import { spendSparks } from "../lib/sparks-helper";
import { isBlockedEitherWay } from "../lib/blocks-helper";
import { getEconomyConfig } from "../lib/economy-config";
import { checkChatUnlockExpiry, processChatUnlockForSend, refundIfUnsendingUnlockMessage, CHAT_UNLOCK_SELECT_FIELDS } from "../lib/chat-unlock-helper";

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

/** Attaches a `reply_to` preview to each message that has a
 *  reply_to_message_id set — enough info for a quoted-reply UI (id,
 *  content, sender, type, whether it's since been unsent) without the
 *  frontend needing a second round-trip. null if the message isn't a
 *  reply, or if the original couldn't be found for any reason. */
async function attachReplyContext<T extends { id: string; reply_to_message_id: string | null }>(
  messages: T[],
): Promise<
  (T & {
    reply_to: { id: string; content: string; sender_id: string; message_type: string; is_unsent: boolean } | null;
  })[]
> {
  const replyIds = [...new Set(messages.map((m) => m.reply_to_message_id).filter((id): id is string => !!id))];
  if (replyIds.length === 0) {
    return messages.map((m) => ({ ...m, reply_to: null }));
  }

  const { data: originals } = await supabase
    .from("messages")
    .select("id, content, sender_id, message_type, is_unsent")
    .in("id", replyIds);

  const byId = new Map((originals ?? []).map((o) => [o.id, o]));

  return messages.map((m) => ({
    ...m,
    reply_to: m.reply_to_message_id ? (byId.get(m.reply_to_message_id) ?? null) : null,
  }));
}

/** GET /api/matches/:matchId/messages */
router.get("/matches/:matchId/messages", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const { data: match } = await supabase
    .from("matches")
    .select(`id, user1_id, user2_id, ${CHAT_UNLOCK_SELECT_FIELDS}`)
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .single();

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  // Lazily catches a 48h-expired unlock attempt the moment anyone opens
  // this chat, even if neither party has tried to send a message since
  // it expired — see chat-unlock-helper.ts for why this has to be lazy
  // rather than a scheduled sweep. Only the side effect (refund +
  // status transition) matters here; the resulting status itself is
  // surfaced to the frontend via GET /matches/:matchId instead (which
  // ChatPage.tsx already fetches separately), not this endpoint.
  await checkChatUnlockExpiry(match);

  // These four don't depend on each other's results — run concurrently
  // instead of one after another.
  const [{ data: messages }, { data: hidden }, { data: unlock }, { data: viewerProfile }] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("match_id", matchId)
      .eq("is_unsent", false)
      .order("sent_at", { ascending: true }),
    supabase.from("hidden_messages").select("message_id").eq("user_id", userId),
    supabase
      .from("read_receipt_unlocks")
      .select("match_id")
      .eq("match_id", matchId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("profiles").select("share_read_receipts").eq("id", userId).single(),
  ]);

  const hiddenIds = new Set((hidden ?? []).map((h) => h.message_id));
  const hasUnlockedReceipts = !!unlock;

  // Hide the true read status of MY OWN sent messages unless I've paid to
  // unlock read receipts for this match. Messages from the other person
  // always show their real is_read value (that's about my own reading
  // activity, not something to gate).
  const visibleMessages = (messages ?? [])
    .filter((m) => !hiddenIds.has(m.id))
    .map((m) => (m.sender_id === userId && !hasUnlockedReceipts ? { ...m, is_read: false } : m));

  // Reactions and reply-context are also independent of each other —
  // reply-context only reads `.id` / `.reply_to_message_id`, it never
  // needs the reaction data, despite the previous code chaining them.
  const [withReactions, withReplyContext] = await Promise.all([
    attachReactions(visibleMessages, userId),
    attachReplyContext(visibleMessages),
  ]);
  const replyById = new Map(withReplyContext.map((m) => [m.id, m.reply_to]));
  const combined = withReactions.map((m) => ({ ...m, reply_to: replyById.get(m.id) ?? null }));

  // Best-effort, non-blocking — marking incoming messages as read is
  // bookkeeping the viewer doesn't need confirmed before seeing their own
  // chat render. Previously this was awaited before responding, adding a
  // full extra round-trip to every single chat-open, on top of the six
  // sequential round trips already ahead of it in this handler.
  //
  // Gated on the READER's (this endpoint's own userId) share_read_receipts
  // setting, not the sender's — this is what makes turning the setting off
  // actually work, regardless of whether the other person has already paid
  // to unlock receipts on their own sent messages. Skipping the write
  // entirely when it's off (rather than writing is_read=true and trying to
  // mask it later at display time) means there's no is_read=true value in
  // the database at all for this reader's activity — the sender's own
  // "have they read it" check downstream can never see something that was
  // never written, regardless of what they've paid for.
  if (viewerProfile?.share_read_receipts !== false) {
    supabase
      .from("messages")
      .update({ is_read: true })
      .eq("match_id", matchId)
      .neq("sender_id", userId)
      .eq("is_read", false)
      .then(() => {});
  }

  // Separate from the is_read update above, and deliberately
  // unconditional — this is purely personal bookkeeping for the
  // CURRENT VIEWER's own unread-indicator purposes (bottom-nav dot,
  // per-match "has_unread" in GET /matches), and was never meant to be
  // tied to their share_read_receipts preference. Before this existed,
  // turning read receipts off meant is_read never got written at all,
  // which meant this same person's OWN unread indicator could never
  // clear either — a real bug, not an intentional trade-off. Also
  // best-effort/non-blocking, same reasoning as the is_read update.
  const viewerColumn = match.user1_id === userId ? "user1_last_viewed_at" : "user2_last_viewed_at";
  supabase
    .from("matches")
    .update({ [viewerColumn]: new Date().toISOString() })
    .eq("id", matchId)
    .then(() => {});

  res.json(combined);
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
    .select("id, user1_id, user2_id")
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

  // Checked BEFORE any charge — an unlock here only ever matters for
  // seeing when the OTHER person has read this user's own sent messages,
  // so their own setting is what actually governs whether there's
  // anything real to unlock at all. Without this, someone could pay for
  // an unlock that GET /matches/:matchId/messages's own
  // share_read_receipts check (see above) would silently make useless —
  // is_read never gets written to true for that person's reads in the
  // first place, so the paid-for unlock would just never show anything,
  // with no indication why.
  const otherUserId = match.user1_id === userId ? match.user2_id : match.user1_id;
  const { data: otherProfile } = await supabase
    .from("profiles")
    .select("share_read_receipts")
    .eq("id", otherUserId)
    .single();

  if (otherProfile?.share_read_receipts === false) {
    res.status(403).json({ error: "This person has turned off read receipts, so there's nothing to unlock right now." });
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

/** POST /api/matches/:matchId/messages — see chat-unlock-helper.ts's
 *  processChatUnlockForSend for the full state machine this now goes
 *  through instead of a flat per-message cost_send_message charge. Chat
 *  is always OPEN in the sense that either party can always attempt to
 *  send — what varies is what that specific send costs and what it does
 *  to the match's chat_unlock_status, based on where the conversation
 *  currently sits in that state machine. Supports text, stickers (a
 *  single oversized emoji), and GIFs (an external image URL). */
router.post("/matches/:matchId/messages", requireAuth, async (req, res): Promise<void> => {
  const matchId = Array.isArray(req.params.matchId)
    ? req.params.matchId[0]
    : req.params.matchId;
  const userId = req.user!.id;

  const { content, message_type, media_url, reply_to_message_id } = req.body as {
    content?: string;
    message_type?: "text" | "sticker" | "gif";
    media_url?: string;
    reply_to_message_id?: string;
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
    .select(`id, user1_id, user2_id, message_count, ${CHAT_UNLOCK_SELECT_FIELDS}`)
    .eq("id", matchId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .single();

  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const otherUserId = match.user1_id === userId ? match.user2_id : match.user1_id;

  // These two don't depend on each other's results — run concurrently.
  // Reply validation deliberately never trusts a client-supplied ID
  // without confirming it actually belongs to this same match.
  const [isBlocked, validatedReplyToId] = await Promise.all([
    isBlockedEitherWay(userId, otherUserId),
    reply_to_message_id
      ? supabase
          .from("messages")
          .select("id")
          .eq("id", reply_to_message_id)
          .eq("match_id", matchId)
          .maybeSingle()
          .then(({ data }) => data?.id ?? null)
      : Promise.resolve(null),
  ]);

  if (isBlocked) {
    res.status(403).json({ error: "You can't message this person" });
    return;
  }

  // Always re-check expiry immediately before deciding what this send
  // costs — a stale 'awaiting_reply' whose 48h window has already
  // passed must never be treated as still live just because no earlier
  // request happened to catch it yet.
  const currentMatch = await checkChatUnlockExpiry(match);
  const unlockResult = await processChatUnlockForSend(currentMatch, userId);
  if (!unlockResult.success) {
    res.status(402).json({ error: unlockResult.errorMessage, balance: unlockResult.balance });
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
      reply_to_message_id: validatedReplyToId,
    })
    .select("*")
    .single();

  if (error || !message) {
    res.status(500).json({ error: "Failed to send message" });
    return;
  }

  // Stamps WHICH message started this unlock attempt — needed so a
  // later unsend of specifically this message (and no other) can be
  // recognized as "cancel the pending unlock attempt" rather than an
  // ordinary unsend. Only meaningful the moment an attempt starts/
  // restarts; harmless to leave stale on an already-unlocked or
  // still-mid-conversation match otherwise.
  if (unlockResult.unlockAction === "initiated") {
    supabase.from("matches").update({ chat_unlock_message_id: message.id }).eq("id", matchId).then(() => {});
  }

  // Best-effort, non-blocking — the sender doesn't need this confirmed
  // before seeing their own message appear, and message_count is only
  // read elsewhere (the Matches list preview), never by this same
  // response. Previously this was awaited before responding, adding a
  // full extra round-trip to the one action most in need of feeling
  // instant: sending a message.
  supabase
    .from("matches")
    .update({ message_count: match.message_count + 1 })
    .eq("id", matchId)
    .then(() => {});

  const [{ reply_to }] = await attachReplyContext([message]);

  res.status(201).json({
    ...message,
    reactions: [],
    reply_to,
    sparks_balance: unlockResult.balance,
    // The frontend's one-time (per-user, ever) educational toasts key
    // off this rather than re-deriving the state transition themselves
    // from chat_unlock_status alone — "initiated"/"unlocked"/"revived"
    // each need a DIFFERENT one-time message (see ChatPage.tsx), and
    // this is the one place that already knows unambiguously which one
    // just happened.
    chat_unlock_action: unlockResult.unlockAction,
    sparks_charged: unlockResult.sparksCharged,
  });
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

/** POST /api/messages/:messageId/unsend — normally costs
 *  cost_unsend_message, within 1 hour of sending. EXCEPTION: if this is
 *  specifically the message that started a still-pending, still-
 *  unanswered chat unlock attempt (chat_unlock_status is still
 *  'awaiting_reply' for the match, and this is the exact message that
 *  triggered it), unsending it instead REFUNDS the sender's half and
 *  cancels the attempt entirely — see refundIfUnsendingUnlockMessage's
 *  own doc comment for why that one case is treated differently from
 *  every other message. */
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
  if (now - sentAt > 60 * 60 * 1000) {
    res.status(410).json({ error: "Unsend window expired (1 hour)" });
    return;
  }

  const { data: match } = await supabase
    .from("matches")
    .select(`id, user1_id, user2_id, ${CHAT_UNLOCK_SELECT_FIELDS}`)
    .eq("id", message.match_id)
    .single();

  let balance: number | null = null;

  const unlockRefund = match ? await refundIfUnsendingUnlockMessage(match, messageId) : { applied: false, balance: null };

  if (unlockRefund.applied) {
    balance = unlockRefund.balance;
  } else {
    const { cost_unsend_message } = await getEconomyConfig();
    const spend = await spendSparks(userId, cost_unsend_message, "Message unsend");
    if (!spend.success) {
      res.status(402).json({ error: `Insufficient Sparks (need ${cost_unsend_message})`, balance: spend.balance });
      return;
    }
    balance = spend.balance;
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

  res.json({ ...updated, sparks_balance: balance, chat_unlock_refunded: unlockRefund.applied });
});

/** POST /api/messages/:messageId/hide — "Delete for me." Free, no time
 *  limit, affects only the caller's own view — the message is untouched
 *  for the other person. Idempotent: hiding an already-hidden message is
 *  a harmless no-op (upsert), not an error. */
router.post("/messages/:messageId/hide", requireAuth, async (req, res): Promise<void> => {
  const messageId = Array.isArray(req.params.messageId)
    ? req.params.messageId[0]
    : req.params.messageId;
  const userId = req.user!.id;

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

  await supabase
    .from("hidden_messages")
    .upsert({ user_id: userId, message_id: messageId }, { onConflict: "user_id,message_id" });

  res.sendStatus(204);
});

export default router;
