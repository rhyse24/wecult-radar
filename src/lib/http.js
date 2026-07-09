const UA = "wecult-radar/1.0 (+https://wecult.app; low-volume community monitor)";

export async function getText(url, { timeoutMs = 15000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function getJson(url, opts = {}) {
  return JSON.parse(await getText(url, opts));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
