import { getJson, sleep } from "../lib/http.js";
import { stripHtml } from "../lib/feed.js";

// YouTube Data API v3 — comments are people. Quota discipline: search.list
// costs 100 units AND has a separate 100-searches/day cap, so each run does
// exactly ONE search query (rotated per 30-min slot), then reads comments
// (1 unit/page) for the top videos. Worst case ≈ 4.9k units/day of the 10k.

const API = "https://www.googleapis.com/youtube/v3";
const VIDEOS_PER_RUN = 5;

export async function collectYoutube(queries, log) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    log("youtube skipped (no YOUTUBE_API_KEY)");
    return [];
  }
  const q = queries[Math.floor(Date.now() / 1800000) % queries.length];
  const items = [];
  try {
    const publishedAfter = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const search = await getJson(
      `${API}/search?part=snippet&type=video&order=date&maxResults=${VIDEOS_PER_RUN}` +
        `&publishedAfter=${publishedAfter}&q=${encodeURIComponent(q)}&key=${key}`
    );
    for (const v of search.items ?? []) {
      const videoId = v.id?.videoId;
      if (!videoId) continue;
      const videoTitle = stripHtml(v.snippet?.title ?? "");
      try {
        const threads = await getJson(
          `${API}/commentThreads?part=snippet&videoId=${videoId}&order=time&maxResults=50&textFormat=plainText&key=${key}`
        );
        for (const t of threads.items ?? []) {
          const c = t.snippet?.topLevelComment;
          const s = c?.snippet;
          if (!c?.id || !s?.textDisplay) continue;
          items.push({
            source: "youtube",
            id: `yt:${c.id}`,
            url: `https://www.youtube.com/watch?v=${videoId}&lc=${c.id}`,
            title: `comment on: ${videoTitle}`.slice(0, 120),
            text: s.textDisplay.slice(0, 2000),
            author: s.authorDisplayName ?? "",
            venue: "YouTube",
            created_at: s.publishedAt,
          });
        }
      } catch (err) {
        // comments disabled on the video etc. — skip quietly
        log(`youtube comments failed (${videoId}): ${err.message.slice(0, 80)}`);
      }
      await sleep(500);
    }
  } catch (err) {
    log(`youtube search failed (${q}): ${err.message.slice(0, 120)}`);
  }
  return items;
}
