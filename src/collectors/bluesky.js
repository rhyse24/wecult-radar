import { getJson, sleep } from "../lib/http.js";

// Bluesky public AppView search — keyless, open by design, works from cloud
// runners. Real-people source: posts, not articles.

export async function collectBluesky(queries, log) {
  const items = [];
  for (const q of queries) {
    try {
      const data = await getJson(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&sort=latest&limit=25`
      );
      for (const p of data.posts ?? []) {
        const rkey = p.uri?.split("/").pop();
        if (!p.uri || !rkey || !p.author?.handle) continue;
        items.push({
          source: "bluesky",
          id: `bsky:${p.uri}`,
          url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
          title: (p.record?.text ?? "").slice(0, 120),
          text: (p.record?.text ?? "").slice(0, 2000),
          author: p.author.handle,
          venue: "Bluesky",
          created_at: p.record?.createdAt ?? p.indexedAt,
          lang: p.record?.langs?.[0],
        });
      }
    } catch (err) {
      log(`bluesky query failed (${q}): ${err.message}`);
    }
    await sleep(1000);
  }
  return items;
}
