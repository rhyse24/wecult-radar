import { sleep } from "./lib/http.js";

// Groq scoring. Free-tier budget rules (org-level, shared with the seed
// content pipeline): items are ALWAYS batched (never one request per item),
// requests run sequentially with a pause, and 429s back off exponentially.
// If Groq is exhausted, callers fall back to an unscored digest — the radar
// goes "un-filtered", never blind.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const BATCH = 10;
const PAUSE_MS = 3000;

const SCORE_SYSTEM = `You classify social posts for WeCult, a social tracking app for movies, TV shows, games and books (its killer features: TV Time ZIP import that preserves ratings, all 4 categories in one app, Letterboxd-like social layer). TV Time (26M users) shuts down 2026-07-15; its users are migrating.

For each numbered item, output a JSON object:
{"i": <item number>, "class": "LOST_USER"|"SEEKER"|"COMPETITOR_PAIN"|"BRAND_MENTION"|"ARTICLE"|"IRRELEVANT", "score": 0-100, "lang": "<2-letter language of the post>", "tr": "<ONE short Turkish sentence: who is asking what / what the post says>"}

Classes: LOST_USER = TV Time refugee needing a new home. SEEKER = actively asking for a tracker/app recommendation. COMPETITOR_PAIN = complaining about Trakt/Simkl/Serializd/Letterboxd limits. BRAND_MENTION = mentions WeCult. ARTICLE = journalist/blog piece about trackers or the shutdown. IRRELEVANT = anything else (score 0).

Score = how valuable replying is for winning a user: explicit "which app should I use?" from a real person = 85-100; vague relevance = 30-50. News articles score 60+ only if a comment/pitch opportunity exists.

Answer with ONLY a JSON array of these objects, no prose.`;

async function groq(messages, { maxTokens = 2000, attempts = 4 } = {}) {
  for (let a = 1; ; a++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.3,
        max_tokens: maxTokens,
        // gpt-oss models emit reasoning tokens that count against max_tokens;
        // low effort keeps the budget for the actual answer.
        ...(MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (res.status === 429 || res.status >= 500) {
      if (a >= attempts) throw new Error(`groq ${res.status} after ${attempts} attempts`);
      await sleep(5000 * 2 ** a);
      continue;
    }
    if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).choices?.[0]?.message?.content ?? "";
  }
}

function extractJson(text) {
  const m = text.match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
}

/** Mutates items: adds .klass, .score, .lang, .tr_summary. Unscored items get score -1. */
export async function scoreItems(items, log) {
  for (const it of items) {
    it.score = -1;
    it.klass = "UNSCORED";
  }
  for (let off = 0; off < items.length; off += BATCH) {
    const batch = items.slice(off, off + BATCH);
    const user = batch
      .map(
        (it, i) =>
          `#${i} [${it.source}/${it.venue}] ${it.title}\n${(it.text || "").slice(0, 500)}`
      )
      .join("\n---\n");
    try {
      const rows = extractJson(await groq([
        { role: "system", content: SCORE_SYSTEM },
        { role: "user", content: user },
      ]));
      for (const r of rows) {
        const it = batch[r.i];
        if (!it) continue;
        it.klass = r.class ?? "IRRELEVANT";
        it.score = Math.max(0, Math.min(100, Number(r.score) || 0));
        it.lang = r.lang || it.lang || "en";
        it.tr_summary = r.tr || "";
      }
    } catch (err) {
      log(`scoring batch failed (offset ${off}): ${err.message}`);
    }
    await sleep(PAUSE_MS);
  }
  return items;
}

const DRAFT_SYSTEM = `You write reply drafts for the WeCult founder to review, edit and post HIMSELF. Never sound like an ad.

FACTS about WeCult you may use (do NOT invent any other product claims; when unsure stay generic):
- Imports the TV Time GDPR export ZIP directly (~99% accurate) and PRESERVES ratings (the common TV Time -> Trakt path loses ratings).
- Tracks movies, TV shows, games AND books in one app, with a Letterboxd-style social layer.
- Free on iOS and Android; app name "WeCult", site wecult.app.
- True neutral facts you may share: export must be requested at gdpr.tvtime.com before July 15; TV Time deletes all data after shutdown.

Hard rules baked into every draft:
- Write in the SAME language as the target post (English for global venues, Turkish for Turkish venues).
- Answer THEIR actual question first with something concretely useful (e.g. "export at gdpr.tvtime.com before the 15th", honest comparison of options). The WeCult mention is a by-product of the help, never the point.
- WeCult at most once, briefly, with disclosure ("I'm building WeCult" / "WeCult'u geliştiriyorum") — in list-style answers place it alongside 1-2 honest alternatives. No CTA language ("check it out!", "download now"). A soft close is the ceiling: "...if you want to give it a shot".
- No naked links unless the platform culture expects them; the name alone is enough.
- Drafts A and B must take genuinely different angles.

Sound like a person, not an AI and not an ad:
- Mirror the post: match its length (never longer than the post unless it asks for detail), its energy and its formality. A one-line question gets a 1-3 sentence answer.
- Platform register — reddit: relaxed, first-person, contractions, a mild opinion is good; Hacker News: dry, precise, zero hype; YouTube comments: 1-2 short sentences max; news/article comments: brief and factual.
- BANNED AI tells: "Great question", "Hope this helps", "Absolutely!", "game-changer", "seamless", starting with a restatement of their problem, bullet lists, perfectly parallel sentence pairs, em-dash chains, exclamation marks more than once, emoji.
- BANNED fake warmth: "friend", "buddy", forced slang, over-enthusiasm. You're a fellow user/builder answering casually, not a community manager.
- Small natural roughness is good: starting a sentence with "And"/"But", a short fragment, one concrete personal detail. Don't over-polish.
- NEVER invent facts about other apps (features, add-ons, integrations you're not sure exist). If unsure, name them without claims ("Trakt and Simkl are the usual suggestions") — a wrong claim gets the reply (and the founder) called out publicly.

Output ONLY JSON:
{"a": "<draft A in post's language>", "a_tr": "<one Turkish sentence: what draft A says + its angle>", "b": "<draft B>", "b_tr": "<one Turkish sentence for B>"}`;

/** Returns {a, a_tr, b, b_tr} or null. */
export async function draftReplies(item, log) {
  try {
    const user = `Venue: ${item.source}/${item.venue}\nClass: ${item.klass}\nPost title: ${item.title}\nPost text: ${(item.text || "").slice(0, 800)}`;
    const text = await groq(
      [
        { role: "system", content: DRAFT_SYSTEM },
        { role: "user", content: user },
      ],
      { maxTokens: 1500 }
    );
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) log(`draft returned no JSON (${item.id}): ${text.slice(0, 120)}`);
    return m ? JSON.parse(m[0]) : null;
  } catch (err) {
    log(`draft failed (${item.id}): ${err.message}`);
    return null;
  }
}
