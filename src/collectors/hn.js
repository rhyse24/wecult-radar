import { getJson, sleep } from "../lib/http.js";
import { stripHtml } from "../lib/feed.js";

// Hacker News via Algolia (free, keyless). Stories + comments from the
// last 8 days; freshness filtering happens downstream.

export async function collectHn(queries, log) {
  const since = Math.floor(Date.now() / 1000) - 8 * 86400;
  const items = [];
  for (const q of queries) {
    try {
      const data = await getJson(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}` +
          `&tags=(story,comment)&numericFilters=created_at_i>${since}&hitsPerPage=30`
      );
      for (const h of data.hits ?? []) {
        items.push({
          source: "hn",
          id: `hn:${h.objectID}`,
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          title: h.title || h.story_title || "(comment)",
          text: stripHtml(h.comment_text || h.story_text || "").slice(0, 2000),
          author: h.author ?? "",
          venue: "Hacker News",
          created_at: h.created_at,
        });
      }
    } catch (err) {
      log(`hn query failed (${q}): ${err.message}`);
    }
    await sleep(500);
  }
  return items;
}
