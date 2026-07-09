import { getText, sleep } from "../lib/http.js";
import { parseRss } from "../lib/feed.js";

// Google News RSS: catches articles/blogs (the "best alternatives" listicle
// wave). Per-language queries; lang is stamped so the meta layer stays right.

const LOCALES = {
  en: "hl=en-US&gl=US&ceid=US:en",
  tr: "hl=tr&gl=TR&ceid=TR:tr",
};

export async function collectGnews(cfg, log) {
  const items = [];
  for (const [lang, queries] of Object.entries(cfg)) {
    const locale = LOCALES[lang];
    if (!locale) continue;
    for (const q of queries) {
      try {
        const xml = await getText(
          `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${locale}`
        );
        for (const e of parseRss(xml).slice(0, 15)) {
          if (!e.id || !e.url) continue;
          items.push({ ...e, source: "gnews", id: `gnews:${e.id}`.slice(0, 500), lang });
        }
      } catch (err) {
        log(`gnews query failed (${q}): ${err.message}`);
      }
      await sleep(1000);
    }
  }
  return items;
}
