import { readFileSync } from "node:fs";
import { collectReddit } from "./collectors/reddit.js";
import { collectHn } from "./collectors/hn.js";
import { collectGnews } from "./collectors/gnews.js";
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
  } else {
    await sendTelegram(text, log);
  }
}

async function scan() {
  const cfg = JSON.parse(readFileSync(new URL("../config/keywords.json", import.meta.url)));

  let items = [];
  for (const [name, fn] of [
    ["reddit", () => collectReddit(cfg.reddit, log)],
    ["hn", () => collectHn(cfg.hn, log)],
    ["gnews", () => collectGnews(cfg.gnews, log)],
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

  const instant = scoredOk.filter((i) => i.score >= INSTANT_THRESHOLD);
  const queued = scoredOk.filter((i) => i.score >= SAVE_THRESHOLD && i.score < INSTANT_THRESHOLD);
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

async function digest() {
  const items = DRY ? [] : await pendingOpportunities(DIGEST_LIMIT);
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
  await deliver(formatDigest(items, draftedById));
  if (!DRY) await markNotified(items.map((i) => i.id));
}

requireEnv(DRY ? [] : ["GROQ_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);
if (JOB === "digest") await digest();
else await scan();
log("done");
