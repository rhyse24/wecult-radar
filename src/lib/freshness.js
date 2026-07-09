// Hard freshness rules (see docs/GROWTH_RADAR_PLAN.md in the WeCult repo):
// replies to stale threads are invisible and read as necro-spam, so staleness
// is enforced in code, never delegated to the AI. Brand mentions are exempt.

const H = 3600 * 1000;

export function ageHours(item) {
  const t = Date.parse(item.created_at);
  return Number.isFinite(t) ? (Date.now() - t) / H : Infinity;
}

export function isBrandMention(item, brandTerms) {
  const hay = `${item.title} ${item.text}`.toLowerCase();
  return brandTerms.some((t) => hay.includes(t));
}

/** Returns { keep, penalty } — penalty is subtracted from the AI score. */
export function freshness(item, brandTerms) {
  if (isBrandMention(item, brandTerms)) return { keep: true, penalty: 0 };
  const h = ageHours(item);
  if (h < 6) return { keep: true, penalty: 0 };
  if (h < 48) return { keep: true, penalty: 5 };
  if (h < 168) return { keep: true, penalty: 25 }; // 2-7 days: only high intent survives
  return { keep: false, penalty: 100 };
}
