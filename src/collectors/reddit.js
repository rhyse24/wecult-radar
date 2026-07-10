import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getText, sleep } from "../lib/http.js";
import { parseAtom, stripHtml } from "../lib/feed.js";

const execFileP = promisify(execFile);

// Reddit's edge hard-403s Node's (undici) TLS fingerprint even from clean
// residential IPs, while curl with the same UA and IP passes. So the RSS
// path shells out to curl (ships with Windows 10+/Linux runners).
async function curlText(url, ua) {
  const { stdout } = await execFileP(
    "curl",
    ["-s", "--max-time", "20", "-A", ua, "-w", "\n__HTTP_STATUS__%{http_code}", url],
    { maxBuffer: 8 * 1024 * 1024 }
  );
  const idx = stdout.lastIndexOf("\n__HTTP_STATUS__");
  const status = Number(stdout.slice(idx + 16));
  if (status !== 200) throw new Error(`HTTP ${status} for ${url}`);
  return stdout.slice(0, idx);
}

// Two access paths:
// 1. Official OAuth API (preferred) — set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET
//    (a free "script" app from reddit.com/prefs/apps). Needed on GitHub
//    runners: Reddit blocks datacenter IPs for the anonymous RSS endpoints.
// 2. Anonymous RSS fallback for local runs — slow pacing, 429 aborts the run.
// Read-only either way; this module never writes anything to Reddit.

const UA = "script:wecult-radar:1.0 (read-only community monitor for wecult.app)";
// Anonymous budget is ~1 req / 10s per IP in practice; stay well under it and
// rotate the search list so each run only fetches a third of it (every search
// is still visited every ~90 min at the 30-min cadence).
const RSS_DELAY_MS = 30000;
const RSS_ROTATION_GROUPS = 3;
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
  // Subreddit feeds every run; searches rotate in thirds per 30-min slot.
  const slot = Math.floor(Date.now() / 1800000) % RSS_ROTATION_GROUPS;
  const searches = cfg.searches.filter((_, i) => i % RSS_ROTATION_GROUPS === slot);
  const urls = [
    ...cfg.subredditsNew.map((s) => `https://www.reddit.com/r/${s}/new/.rss?limit=25`),
    ...searches.map(
      (q) => `https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}&sort=new&limit=25`
    ),
  ];
  const items = [];
  for (const url of urls) {
    // Single attempt per feed: under budget pressure retries double the
    // request count and make everything worse. A missed feed is simply
    // caught by the next 30-min run.
    try {
      const xml = process.env.REDDIT_PROXY
        ? await getText(viaProxy(url))
        : await curlText(url, UA);
      for (const e of parseAtom(xml)) {
        if (!e.id || !e.url) continue;
        items.push({ ...e, source: "reddit", id: `reddit:${e.id}` });
      }
    } catch (err) {
      log(`reddit feed failed (${url}): ${err.message}`);
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
