import { supabase } from "./supabase";

export type NotificationType = "announcement" | "spark_grant" | "spark_low" | "profile_views";

/** Creates a standalone notification for one user. Used for one-off
 *  events (Spark grant, low balance) where there's no batching concern. */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body?: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body: body ?? null,
    data: data ?? null,
    is_read: false,
  });
}

/** Fans a notification out to many users at once — used for admin
 *  announcements (all users, or a specific target list). Best-effort:
 *  failures here shouldn't block the announcement itself from being
 *  created. */
export async function createNotificationForUsers(
  userIds: string[],
  type: NotificationType,
  title: string,
  body?: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await supabase.from("notifications").insert(
      userIds.map((userId) => ({
        user_id: userId,
        type,
        title,
        body: body ?? null,
        data: data ?? null,
        is_read: false,
      })),
    );
  } catch {
    // Non-fatal — see doc comment above.
  }
}

/** Records a profile view (always, regardless of notification
 *  preference — Who Viewed You keeps working either way) and, if the
 *  viewed user has profile-view notifications enabled, rolls it into a
 *  batched "X people viewed your profile" notification so opening/
 *  closing the same profile repeatedly doesn't spam one notification per
 *  view. A new view only counts (and re-triggers the notification) if
 *  this same viewer hasn't viewed this same profile in the last 6 hours. */
export async function recordProfileView(viewerId: string, viewedId: string): Promise<void> {
  if (viewerId === viewedId) return; // viewing your own profile never counts

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: recentView } = await supabase
    .from("profile_views")
    .select("id")
    .eq("viewer_id", viewerId)
    .eq("viewed_id", viewedId)
    .gt("created_at", sixHoursAgo)
    .maybeSingle();

  if (recentView) return; // already counted recently, don't double up

  await supabase.from("profile_views").insert({ viewer_id: viewerId, viewed_id: viewedId });

  const { data: viewedProfile } = await supabase
    .from("profiles")
    .select("notify_profile_views")
    .eq("id", viewedId)
    .single();

  if (viewedProfile?.notify_profile_views === false) return;

  // Roll into the existing unread profile_views notification if one
  // exists, otherwise start a new one.
  const { data: existing } = await supabase
    .from("notifications")
    .select("id, data")
    .eq("user_id", viewedId)
    .eq("type", "profile_views")
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const count = ((existing.data as { count?: number } | null)?.count ?? 1) + 1;
    await supabase
      .from("notifications")
      .update({
        title: `${count} people viewed your profile`,
        data: { count },
        created_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await createNotification(
      viewedId,
      "profile_views",
      "1 person viewed your profile",
      "Tap to see who's interested",
      { count: 1 },
    );
  }
}

/** Call when a user pays to reveal their profile viewers — schedules
 *  their profile_views notification(s) to auto-clear from the bell 24
 *  hours from now, rather than sitting there indefinitely just because
 *  it's already been read. Only touches notifications that don't already
 *  have a clear_at set, so this is safe to call even if triggered more
 *  than once. */
export async function scheduleProfileViewNotificationClear(userId: string): Promise<void> {
  const clearAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from("notifications")
    .update({ clear_at: clearAt })
    .eq("user_id", userId)
    .eq("type", "profile_views")
    .is("clear_at", null);
}
