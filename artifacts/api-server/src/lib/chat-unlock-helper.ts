import { supabase } from "./supabase";
import { addPaidSparks, spendSparks } from "./sparks-helper";
import { createNotification } from "./notifications-helper";
import { getEconomyConfig } from "./economy-config";

// No scheduled/cron job infrastructure exists in this backend, so the
// 48-hour expiry can't be swept proactively in the background — instead,
// checkChatUnlockExpiry below is called from every place that reads or
// acts on a match's chat-unlock state (messages.ts before sending,
// matches.ts on list/detail fetch), and lazily processes the expiry
// itself the moment any such request notices the window has passed.
export const CHAT_UNLOCK_EXPIRY_MS = 48 * 60 * 60 * 1000;

export type ChatUnlockStatus = "locked" | "awaiting_reply" | "unlocked" | "missed_connection";

// Appended to any existing profiles/matches select that needs these
// fields, so the exact column list only has to be maintained in one
// place.
export const CHAT_UNLOCK_SELECT_FIELDS =
  "chat_unlock_status, chat_unlock_initiator_id, chat_unlock_initiated_at, chat_unlock_message_id";

export interface ChatUnlockFields {
  id: string;
  user1_id: string;
  user2_id: string;
  chat_unlock_status: ChatUnlockStatus;
  chat_unlock_initiator_id: string | null;
  chat_unlock_initiated_at: string | null;
  chat_unlock_message_id: string | null;
}

/** Lazily checks whether a match's 48-hour reply window has expired
 *  without a reply, and if so, processes the refund and status
 *  transition right then. Idempotent and cheap to call unconditionally
 *  on every request touching this match's chat-unlock state — does
 *  nothing at all unless status is specifically 'awaiting_reply' AND
 *  the window has genuinely passed.
 *
 *  Returns the match's CURRENT chat-unlock fields — either the exact
 *  same object passed in (no-op case), or freshly updated if this call
 *  is what actually caught the expiry, so callers can immediately act
 *  on the up-to-date status without a second round trip. */
export async function checkChatUnlockExpiry<T extends ChatUnlockFields>(match: T): Promise<T> {
  if (match.chat_unlock_status !== "awaiting_reply" || !match.chat_unlock_initiated_at) {
    return match;
  }

  const initiatedAt = new Date(match.chat_unlock_initiated_at).getTime();
  if (Date.now() - initiatedAt < CHAT_UNLOCK_EXPIRY_MS) {
    return match;
  }

  const initiatorId = match.chat_unlock_initiator_id;
  if (!initiatorId) {
    // Shouldn't be reachable given the state machine (awaiting_reply
    // always sets an initiator when it's entered) — fail safe by
    // treating it as expired anyway rather than throwing, but skip the
    // refund since there's no one to refund.
    return { ...match, chat_unlock_status: "missed_connection" };
  }

  // Atomic claim — only proceeds if the row is STILL 'awaiting_reply' at
  // the moment of this update. Guards against two concurrent requests
  // (e.g. both users' apps happening to poll at the exact moment the
  // window closes) both processing the same refund twice.
  const { data: claimed } = await supabase
    .from("matches")
    .update({ chat_unlock_status: "missed_connection" })
    .eq("id", match.id)
    .eq("chat_unlock_status", "awaiting_reply")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    // Lost the race — a concurrent request already claimed this
    // transition (and already sent the refund/notifications below).
    // Re-fetch rather than assume, so the caller gets accurate current
    // state either way.
    const { data: fresh } = await supabase
      .from("matches")
      .select(`id, user1_id, user2_id, ${CHAT_UNLOCK_SELECT_FIELDS}`)
      .eq("id", match.id)
      .single();
    return (fresh as T) ?? { ...match, chat_unlock_status: "missed_connection" };
  }

  const { cost_chat_unlock } = await getEconomyConfig();
  const refundAmount = Math.ceil(cost_chat_unlock / 2);
  const recipientId = match.user1_id === initiatorId ? match.user2_id : match.user1_id;

  await addPaidSparks(initiatorId, refundAmount, "Chat unlock refunded — no reply within 48 hours");

  createNotification(
    initiatorId,
    "chat_unlock_refunded",
    "Sparks refunded",
    `Your ${refundAmount} Sparks were refunded since your match hasn't replied within 48 hours.`,
  ).catch(() => {});

  createNotification(
    recipientId,
    "chat_missed_connection",
    "You have a missed connection",
    "Someone messaged you, but the window to reply for half price has passed. You can still revive the chat.",
  ).catch(() => {});

  return { ...match, chat_unlock_status: "missed_connection" };
}

export interface ChatUnlockSendResult {
  success: boolean;
  balance: number | null;
  errorMessage?: string;
  // "none": ordinary message, chat was already unlocked (or this is a
  // follow-up from the initiator while still awaiting reply) — normal
  // cost_send_message applies, no state change.
  // "initiated": this message is what started (or restarted, after a
  // missed connection) the 50/50 unlock process.
  // "unlocked": this message is the recipient's in-window reply,
  // completing the 50/50 unlock.
  // "revived": this message is a late reply after the 48h window,
  // paying the full cost alone to reopen a missed connection.
  unlockAction: "none" | "initiated" | "unlocked" | "revived";
  sparksCharged: number;
}

/** Determines and applies the correct Sparks charge for a message being
 *  sent into `match`, given its CURRENT chat-unlock status (the caller
 *  must have already run checkChatUnlockExpiry on it first, so a stale
 *  'awaiting_reply' past its window is never mistaken for a still-live
 *  one here), and updates that status/related fields as needed.
 *
 *  Does NOT insert the actual message, and does NOT set
 *  chat_unlock_message_id — the caller (messages.ts's route handler)
 *  does the actual insert immediately after this resolves, and only
 *  then knows the new message's real id to stamp onto the match when
 *  unlockAction is "initiated" (see that handler for exactly where). */
export async function processChatUnlockForSend(
  match: ChatUnlockFields,
  senderId: string,
): Promise<ChatUnlockSendResult> {
  const { cost_chat_unlock, cost_send_message } = await getEconomyConfig();
  const halfCost = Math.ceil(cost_chat_unlock / 2);

  const chargeAndReport = async (
    amount: number,
    reason: string,
    action: ChatUnlockSendResult["unlockAction"],
  ): Promise<ChatUnlockSendResult> => {
    const spend = await spendSparks(senderId, amount, reason);
    if (!spend.success) {
      return { success: false, balance: spend.balance, unlockAction: "none", sparksCharged: amount, errorMessage: `Insufficient Sparks (need ${amount})` };
    }
    return { success: true, balance: spend.balance, unlockAction: action, sparksCharged: amount };
  };

  if (match.chat_unlock_status === "unlocked") {
    return chargeAndReport(cost_send_message, "Message sent", "none");
  }

  if (match.chat_unlock_status === "locked") {
    const result = await chargeAndReport(halfCost, "Chat unlock — your half", "initiated");
    if (!result.success) return result;
    await supabase
      .from("matches")
      .update({
        chat_unlock_status: "awaiting_reply",
        chat_unlock_initiator_id: senderId,
        chat_unlock_initiated_at: new Date().toISOString(),
      })
      .eq("id", match.id);
    return result;
  }

  if (match.chat_unlock_status === "awaiting_reply") {
    if (senderId === match.chat_unlock_initiator_id) {
      // A follow-up message from the person already waiting — they've
      // already paid their half to start this; sending more while
      // waiting is just ordinary messaging.
      return chargeAndReport(cost_send_message, "Message sent", "none");
    }
    // The recipient's first reply, within the window (an expired one
    // would already have been transitioned to missed_connection by
    // checkChatUnlockExpiry before this function was ever called).
    const result = await chargeAndReport(halfCost, "Chat unlock — your half", "unlocked");
    if (!result.success) return result;
    await supabase.from("matches").update({ chat_unlock_status: "unlocked" }).eq("id", match.id);
    if (match.chat_unlock_initiator_id) {
      createNotification(
        match.chat_unlock_initiator_id,
        "chat_unlocked",
        "Chat unlocked",
        "Your match replied — the chat is now open.",
      ).catch(() => {});
    }
    return result;
  }

  // missed_connection
  if (senderId === match.chat_unlock_initiator_id) {
    // The original initiator, already refunded, trying again — this is
    // exactly the same as starting fresh from 'locked'.
    const result = await chargeAndReport(halfCost, "Chat unlock — your half", "initiated");
    if (!result.success) return result;
    await supabase
      .from("matches")
      .update({
        chat_unlock_status: "awaiting_reply",
        chat_unlock_initiator_id: senderId,
        chat_unlock_initiated_at: new Date().toISOString(),
      })
      .eq("id", match.id);
    return result;
  }

  // A late reply from the original recipient — reviving a missed
  // connection costs the full amount, paid alone.
  const result = await chargeAndReport(cost_chat_unlock, "Chat unlock — reviving missed connection", "revived");
  if (!result.success) return result;
  await supabase.from("matches").update({ chat_unlock_status: "unlocked" }).eq("id", match.id);
  if (match.chat_unlock_initiator_id) {
    createNotification(
      match.chat_unlock_initiator_id,
      "chat_revived",
      "Chat revived",
      "Your match replied and revived the conversation — it's now open.",
    ).catch(() => {});
  }
  return result;
}

/** Checks whether `messageId` is specifically the message that started
 *  a still-pending, still-unanswered chat unlock attempt for `match` —
 *  if so, refunds the sender's half immediately and resets the match
 *  back to 'locked' (cancelling the attempt entirely, as though it
 *  never happened), INSTEAD of the normal cost_unsend_message charge.
 *  This is the one exception to messages generally never being
 *  refunded on unsend — because this specific message hasn't actually
 *  been "used" yet in any sense the recipient could be said to have
 *  benefited from: they haven't replied, haven't unlocked their side,
 *  nothing has happened as a result of it existing.
 *
 *  Returns `applied: true` if this special case fired (the caller
 *  should skip the normal unsend cost/logic entirely) or `applied:
 *  false` if it doesn't apply here (status isn't 'awaiting_reply', this
 *  isn't the message that started it, or a concurrent request already
 *  changed the status) — in which case the caller should proceed with
 *  ordinary unsend behavior. */
export async function refundIfUnsendingUnlockMessage(
  match: ChatUnlockFields,
  messageId: string,
): Promise<{ applied: boolean; balance: number | null }> {
  if (match.chat_unlock_status !== "awaiting_reply" || match.chat_unlock_message_id !== messageId) {
    return { applied: false, balance: null };
  }
  const initiatorId = match.chat_unlock_initiator_id;
  if (!initiatorId) return { applied: false, balance: null };

  // Atomic claim, same reasoning as checkChatUnlockExpiry — only
  // proceeds if the row is STILL genuinely 'awaiting_reply' at this
  // exact moment, guarding against a race with the recipient replying
  // (or the 48h expiry firing) concurrently with this unsend.
  const { data: claimed } = await supabase
    .from("matches")
    .update({
      chat_unlock_status: "locked",
      chat_unlock_initiator_id: null,
      chat_unlock_initiated_at: null,
      chat_unlock_message_id: null,
    })
    .eq("id", match.id)
    .eq("chat_unlock_status", "awaiting_reply")
    .select("id")
    .maybeSingle();

  if (!claimed) return { applied: false, balance: null };

  const { cost_chat_unlock } = await getEconomyConfig();
  const refundAmount = Math.ceil(cost_chat_unlock / 2);
  const newBalance = await addPaidSparks(initiatorId, refundAmount, "Chat unlock cancelled — message unsent before reply");
  return { applied: true, balance: newBalance };
}
