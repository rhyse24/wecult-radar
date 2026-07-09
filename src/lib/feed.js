// Minimal, dependency-free Atom (Reddit) and RSS 2.0 (Google News) parsing.
// Deliberately regex-based: both feeds have a stable, well-known shape, and
// every entry is wrapped in try/catch upstream so one malformed item never
// kills a run.

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&#x27;": "'", "&#32;": " ", "&nbsp;": " " };

export function decodeEntities(s = "") {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m] ?? m);
}

export function stripHtml(s = "") {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function blocks(xml, tag) {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "g");
  return xml.match(re) ?? [];
}

function inner(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : v;
}

function attr(block, tag, name) {
  const m = block.match(new RegExp(`<${tag}[^>]*\\b${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : "";
}

/** Reddit-style Atom feed -> normalized entries. */
export function parseAtom(xml) {
  return blocks(xml, "entry").map((e) => ({
    id: inner(e, "id"),
    url: attr(e, "link", "href"),
    title: stripHtml(inner(e, "title")),
    text: stripHtml(inner(e, "content")).slice(0, 2000),
    author: stripHtml(inner(e, "name")),
    venue: attr(e, "category", "label") || attr(e, "category", "term"),
    created_at: inner(e, "updated") || inner(e, "published"),
  }));
}

/** RSS 2.0 feed (Google News) -> normalized entries. */
export function parseRss(xml) {
  return blocks(xml, "item").map((e) => ({
    id: inner(e, "guid") || inner(e, "link"),
    url: decodeEntities(inner(e, "link")),
    title: stripHtml(inner(e, "title")),
    text: stripHtml(inner(e, "description")).slice(0, 2000),
    author: stripHtml(inner(e, "source")),
    venue: stripHtml(inner(e, "source")),
    created_at: new Date(inner(e, "pubDate") || Date.now()).toISOString(),
  }));
}
