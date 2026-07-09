import { getText, sleep } from "../lib/http.js";
import { parseAtom, stripHtml } from "../lib/feed.js";

// Two access paths:
// 1. Official OAuth API (preferred) — set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET
//    (a free "script" app from reddit.com/prefs/apps). Needed on GitHub
//    runners: Reddit blocks datacenter IPs for the anonymous RSS endpoints.
// 2. Anonymous RSS fallback for local runs — slow pacing, 429 aborts the run.
// Read-only either way; this module never writes anything to Reddit.

const UA = "script:wecult-radar:1.0 (read-only community monitor for wecult.app)";
const RSS_DELAY_MS = 7000;
const API_DELAY_MS = 1500;

const viaProxy = (url) =>
  process.env.REDDIT_PROXY ? `${process.env.REDDIT_PROXY}${encodeURIComponent(url)}` : url;

async function apiToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`reddit token ${res.status}`);
  return (await res.json()).access_token;
}

function mapListing(json) {
  return (json?.data?.children ?? [])
    .filter((c) => c.kind === "t3" && c.data)
    .map(({ data: d }) => ({
      source: "reddit",
      id: `reddit:${d.name}`,
      url: `https://www.reddit.com${d.permalink}`,
      title: stripHtml(d.title ?? ""),
      text: stripHtml(d.selftext ?? "").slice(0, 2000),
      author: d.author ?? "",
      venue: `r/${d.subreddit}`,
      created_at: new Date((d.created_utc ?? 0) * 1000).toISOString(),
    }));
}

async function collectViaApi(cfg, log) {
  const token = await apiToken();
  const headers = { Authorization: `Bearer ${token}`, "User-Agent": UA };
  const urls = [
    ...cfg.subredditsNew.map((s) => `https://oauth.reddit.com/r/${s}/new?limit=25&raw_json=1`),
    ...cfg.searches.map(
      (q) =>
        `https://oauth.reddit.com/search?q=${encodeURIComponent(q)}&sort=new&limit=25&type=link&raw_json=1`
    ),
  ];
  const items = [];
  for (const url of urls) {
    try {
      items.push(...mapListing(JSON.parse(await getText(url, { headers }))));
    } catch (err) {
      log(`reddit api failed (${url}): ${err.message}`);
    }
    await sleep(API_DELAY_MS);
  }
  return items;
}

async function collectViaRss(cfg, log) {
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
    await sleep(RSS_DELAY_MS);
  }
  return items;
}

export async function collectReddit(cfg, log) {
  if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
    try {
      return await collectViaApi(cfg, log);
    } catch (err) {
      log(`reddit api path failed (${err.message}) — falling back to RSS`);
    }
  }
  return collectViaRss(cfg, log);
}
