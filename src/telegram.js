// Delivery. Meta layer is ALWAYS Turkish; drafts are in the target thread's
// language with a Turkish explanation line underneath (product rule, see
// GROWTH_RADAR_PLAN.md "DİL KURALI").

const esc = (s = "") => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendTelegram(text, log) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  // 4096 hard limit; chunk on paragraph boundaries.
  const chunks = [];
  let cur = "";
  for (const para of text.split("\n\n")) {
    if (cur.length + para.length > 3800) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + para;
  }
  if (cur) chunks.push(cur);
  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) log(`telegram send failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

const AGE = (iso) => {
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  if (!Number.isFinite(h)) return "?";
  return h < 1 ? `${Math.round(h * 60)} dk` : h < 48 ? `${Math.round(h)} sa` : `${Math.round(h / 24)} gün`;
};

export function formatInstant(item, drafts) {
  let msg =
    `🎯 <b>[${esc(item.klass)} · ${item.score} · ${esc(item.venue || item.source)} · ${AGE(item.created_at)} önce]</b>\n` +
    `📄 <b>Konu (TR):</b> ${esc(item.tr_summary || item.title)}\n` +
    `🔗 ${esc(item.url)}`;
  if (drafts) {
    msg +=
      `\n\n✍️ <b>Taslak A:</b>\n<code>${esc(drafts.a)}</code>\n` +
      `↳ <i>TR: ${esc(drafts.a_tr || "")}</i>\n\n` +
      `✍️ <b>Taslak B:</b>\n<code>${esc(drafts.b)}</code>\n` +
      `↳ <i>TR: ${esc(drafts.b_tr || "")}</i>`;
  }
  msg += `\n\n⚠️ Gönderirken KENDİ cümlelerinle kişiselleştir; günlük link tavanını hatırla (maks 3).`;
  return msg;
}

export function formatDigest(items, draftedById) {
  const lines = [`📡 <b>Radar günlük özeti</b> — ${items.length} fırsat\n`];
  items.forEach((it, n) => {
    lines.push(
      `${n + 1}. <b>[${esc(it.klass)} · ${it.score} · ${esc(it.venue || it.source)} · ${AGE(it.created_at)}]</b>\n` +
        `${esc(it.tr_summary || it.title)}\n${esc(it.url)}`
    );
    const d = draftedById.get(it.id);
    if (d) {
      lines.push(
        `✍️ <code>${esc(d.a)}</code>\n↳ <i>TR: ${esc(d.a_tr || "")}</i>`
      );
    }
  });
  return lines.join("\n\n");
}
