import { readFileSync } from "node:fs";
import { collectReddit } from "./collectors/reddit.js";
import { collectHn } from "./collectors/hn.js";
import { collectGnews } from "./collectors/gnews.js";
import { collectBluesky } from "./collectors/bluesky.js";
import { freshness } from "./lib/freshness.js";
import { scoreItems, draftReplies } from "./score.js";
import { filterNew, saveOpportunities, pendingOpportunities, markNotified } from "./seen.js";
import { sendTelegram, formatInstant, formatDigest } from "./telegram.js";

const INSTANT_THRESHOLD = 75;
const SAVE_THRESHOLD = 45;
const MAX_SCORED_PER_RUN = 120; // Groq free-tier guardrail
const DIGEST_LIMIT = 25;
const DIGEST_DRAFTS = 3;

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry");
const JOB = [...args].find((a) => a.startsWith("--job="))?.slice(6) ?? "scan";
// Reddit runs from a residential IP (local scheduled task); GitHub runners
// are blocked there, so the cloud workflow passes --sources=hn,gnews.
const SOURCES = ([...args].find((a) => a.startsWith("--sources="))?.slice(10) ?? "reddit,hn,gnews").split(",");
const log = (m) => console.log(`[radar] ${m}`);

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}`);
    process.exit(1);
  }
}

async function deliver(text) {
  if (DRY) {
    console.log("\n===== TELEGRAM (dry) =====\n" + text.replace(/<[^>]+>/g, "") + "\n==========================\n");
    return true;
  }
  return sendTelegram(text, log);
}

async function scan() {
  const cfg = JSON.parse(readFileSync(new URL("../config/keywords.json", import.meta.url)));

  let items = [];
  for (const [name, fn] of [
    ["reddit", () => collectReddit(cfg.reddit, log)],
    ["hn", () => collectHn(cfg.hn, log)],
    ["gnews", () => collectGnews(cfg.gnews, log)],
    ["bluesky", () => collectBluesky(cfg.bluesky, log)],
  ].filter(([name]) => SOURCES.includes(name))) {
    try {
      const got = await fn();
      log(`${name}: ${got.length} items`);
      items.push(...got);
    } catch (err) {
      log(`${name} collector failed entirely: ${err.message}`);
    }
  }

  // In-run dedupe (same post can match several search feeds)
  items = [...new Map(items.map((i) => [i.id, i])).values()];

  // Hard freshness gate (code-enforced, never delegated to the AI)
  const fresh = [];
  for (const it of items) {
    const f = freshness(it, cfg.brandTerms);
    if (f.keep) {
      it.freshPenalty = f.penalty;
      fresh.push(it);
    }
  }
  log(`fresh: ${fresh.length}/${items.length}`);

  // Cross-run dedupe via Supabase
  let fresh2 = fresh;
  if (!DRY) {
    const newIds = await filterNew(fresh);
    fresh2 = fresh.filter((i) => newIds.has(i.id));
  }
  log(`new since last run: ${fresh2.length}`);
  if (!fresh2.length) return;

  const toScore = fresh2.slice(0, MAX_SCORED_PER_RUN);
  await scoreItems(toScore, log);
  for (const it of toScore) {
    if (it.score > 0) it.score = Math.max(0, it.score - it.freshPenalty);
  }

  const scoredOk = toScore.filter((i) => i.score >= 0 && i.klass !== "UNSCORED");
  if (!scoredOk.length && toScore.length) {
    await deliver("⚠️ Radar: bu turda Groq skorlaması tamamen başarısız — tarama sürüyor ama eleme yok. Log'a bak.");
  }

  // Product rule (2026-07-10): only conversations count. Articles/news are
  // not deliverable opportunities — people's posts and comments are.
  const people = scoredOk.filter((i) => PEOPLE_CLASSES.has(i.klass));
  const instant = people.filter((i) => i.score >= INSTANT_THRESHOLD);
  const queued = people.filter((i) => i.score >= SAVE_THRESHOLD && i.score < INSTANT_THRESHOLD);
  log(`instant: ${instant.length}, queued for digest: ${queued.length}`);

  for (const it of instant.slice(0, 5)) {
    const drafts = await draftReplies(it, log);
    await deliver(formatInstant(it, drafts));
  }
  if (!DRY) {
    await saveOpportunities(instant, true);
    await saveOpportunities(queued, false);
  } else {
    for (const it of queued) log(`(dry queue) ${it.score} ${it.klass} ${it.title.slice(0, 90)}`);
  }
}

const PEOPLE_CLASSES = new Set(["LOST_USER", "SEEKER", "COMPETITOR_PAIN", "BRAND_MENTION"]);

async function digest() {
  let items = DRY ? [] : await pendingOpportunities(DIGEST_LIMIT);
  // People to talk to outrank articles regardless of score — the whole point
  // is conversations, not press clippings.
  items = items.sort(
    (a, b) =>
      (PEOPLE_CLASSES.has(b.klass) ? 1 : 0) - (PEOPLE_CLASSES.has(a.klass) ? 1 : 0) ||
      b.score - a.score
  );
  if (!items.length) {
    await deliver("📡 Radar günlük özeti: bekleyen yeni fırsat yok.");
    return;
  }
  const draftedById = new Map();
  for (const it of items.slice(0, DIGEST_DRAFTS)) {
    const d = await draftReplies(
      { ...it, text: it.item_text, klass: it.klass, venue: it.venue },
      log
    );
    if (d) draftedById.set(it.id, d);
  }
  const delivered = await deliver(formatDigest(items, draftedById));
  // Only mark on confirmed delivery — otherwise items retry in the next digest
  if (delivered && !DRY) await markNotified(items.map((i) => i.id));
}

requireEnv(DRY ? [] : ["GROQ_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);
if (JOB === "digest") await digest();
else await scan();
log("done");
