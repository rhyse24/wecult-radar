// Dedupe + opportunity store on Supabase (PostgREST). Lead data deliberately
// lives OUTSIDE this public repo. Tables: docs/RADAR_TABLES.sql.

const url = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const headers = () => ({
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
});

async function rest(path, init = {}) {
  const res = await fetch(`${url()}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers(), ...init.headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`supabase ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/** Upsert ids into radar_seen; returns the Set of ids that were NEW. */
export async function filterNew(items) {
  const out = new Set();
  for (let off = 0; off < items.length; off += 200) {
    const chunk = items.slice(off, off + 200);
    const inserted = await rest("radar_seen?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(chunk.map((i) => ({ id: i.id, source: i.source }))),
    });
    for (const row of inserted ?? []) out.add(row.id);
  }
  return out;
}

export async function saveOpportunities(items, notified) {
  if (!items.length) return;
  await rest("radar_opportunities?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(
      items.map((i) => ({
        id: i.id,
        source: i.source,
        venue: i.venue ?? "",
        url: i.url,
        title: i.title.slice(0, 500),
        klass: i.klass,
        score: i.score,
        lang: i.lang ?? "en",
        tr_summary: i.tr_summary ?? "",
        item_text: (i.text ?? "").slice(0, 2000),
        created_at: i.created_at,
        notified,
      }))
    ),
  });
}

/** Pending (not yet digested) opportunities, best first. */
export async function pendingOpportunities(limit = 40) {
  return rest(
    `radar_opportunities?notified=eq.false&order=score.desc&limit=${limit}&select=*`
  );
}

export async function markNotified(ids) {
  if (!ids.length) return;
  const list = ids.map((i) => `"${i.replaceAll('"', "")}"`).join(",");
  await rest(`radar_opportunities?id=in.(${list})`, {
    method: "PATCH",
    body: JSON.stringify({ notified: true }),
  });
}
