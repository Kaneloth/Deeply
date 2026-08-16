import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
}

function mapGiphyResults(data: unknown[]): GifResult[] {
  return (data ?? []).map((g: any) => ({
    id: g.id,
    url: g.images?.fixed_height?.url ?? g.images?.original?.url,
    previewUrl: g.images?.fixed_height_small?.url ?? g.images?.fixed_height?.url,
  }));
}

/** GET /api/gifs/trending */
router.get("/gifs/trending", requireAuth, async (_req, res): Promise<void> => {
  if (!GIPHY_API_KEY) {
    console.error("GIPHY_API_KEY is not set");
    res.status(500).json({ error: "GIF search is temporarily unavailable." });
    return;
  }

  try {
    const giphyRes = await fetch(
      `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=pg-13`,
    );
    const body = await giphyRes.json();
    if (!giphyRes.ok || body.meta?.status >= 400) {
      throw new Error(body.meta?.msg || `GIPHY request failed (${giphyRes.status})`);
    }
    res.json(mapGiphyResults(body.data));
  } catch (err) {
    console.error("GIPHY trending fetch failed:", err);
    res.status(502).json({ error: "Couldn't load GIFs" });
  }
});

/** GET /api/gifs/search?q=... — empty/missing query returns an empty
 *  array rather than erroring, matching what the frontend expects while
 *  someone is still typing. */
router.get("/gifs/search", requireAuth, async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!GIPHY_API_KEY) {
    console.error("GIPHY_API_KEY is not set");
    res.status(500).json({ error: "GIF search is temporarily unavailable." });
    return;
  }
  if (!q) {
    res.json([]);
    return;
  }

  try {
    const giphyRes = await fetch(
      `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`,
    );
    const body = await giphyRes.json();
    if (!giphyRes.ok || body.meta?.status >= 400) {
      throw new Error(body.meta?.msg || `GIPHY request failed (${giphyRes.status})`);
    }
    res.json(mapGiphyResults(body.data));
  } catch (err) {
    console.error("GIPHY search fetch failed:", err);
    res.status(502).json({ error: "Couldn't load GIFs" });
  }
});

export default router;
