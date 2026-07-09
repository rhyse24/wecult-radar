import { getText, sleep } from "../lib/http.js";
import { parseAtom } from "../lib/feed.js";

// RSS endpoints only (no API key, no OAuth). Polite pacing: sequential
// fetches with a long delay (unauthenticated Reddit tolerates ~10 req/min
// per IP); a 429 aborts the whole collector for this run.
// If GitHub runner IPs get blocked, set REDDIT_PROXY to a passthrough
// fetcher (e.g. a CF Worker: https://.../fetch?url=) and requests route
// through it unchanged.

const DELAY_MS = 7000;

const viaProxy = (url) =>
  process.env.REDDIT_PROXY ? `${process.env.REDDIT_PROXY}${encodeURIComponent(url)}` : url;

export async function collectReddit(cfg, log) {
  const urls = [
    ...cfg.subredditsNew.map((s) => `https://www.reddit.com/r/${s}/new/.rss?limit=25`),
    ...cfg.searches.map(
      (q) => `https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}&sort=new&limit=25`
    ),
  ];
  const items = [];
  for (const url of urls) {
    try {
      const xml = await getText(viaProxy(url));
      for (const e of parseAtom(xml)) {
        if (!e.id || !e.url) continue;
        items.push({ ...e, source: "reddit", id: `reddit:${e.id}` });
      }
    } catch (err) {
      log(`reddit feed failed (${url}): ${err.message}`);
      if (String(err.message).includes("429")) {
        log("reddit rate-limited — aborting reddit collector for this run");
        break;
      }
    }
    await sleep(DELAY_MS);
  }
  return items;
}
