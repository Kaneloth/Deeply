import { supabase } from "./supabase";

/** Attaches a `photos: {url, media_type}[]` array (ordered) to each item
 *  in a list of profile-like objects with `id` and `photo_url`. Falls
 *  back to a single-element image array from photo_url for anyone who
 *  hasn't built a gallery yet. */
export async function attachPhotoGalleries<T extends { id: string; photo_url: string | null }>(
  items: T[],
): Promise<(T & { photos: { url: string; media_type: "image" | "video" }[] })[]> {
  if (items.length === 0) return [];

  const ids = items.map((i) => i.id);
  const { data: galleryPhotos } = await supabase
    .from("profile_photos")
    .select("user_id, photo_url, media_type, position")
    .in("user_id", ids)
    .order("position", { ascending: true });

  const photosByUser = new Map<string, { url: string; media_type: "image" | "video" }[]>();
  for (const p of galleryPhotos ?? []) {
    const list = photosByUser.get(p.user_id) ?? [];
    list.push({ url: p.photo_url, media_type: p.media_type });
    photosByUser.set(p.user_id, list);
  }

  return items.map((item) => {
    const gallery = photosByUser.get(item.id);
    const photos = gallery && gallery.length > 0
      ? gallery
      : item.photo_url
        ? [{ url: item.photo_url, media_type: "image" as const }]
        : [];
    return { ...item, photos };
  });
}
