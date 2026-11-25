/**
 * A small, dependency-free reader for RSS 2.0, RSS 1.0 (RDF) and Atom feeds: enough to read procurement-notice feeds.
 * It never executes anything from the feed; it only pulls text out of a few known elements.
 */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decode XML/HTML entities, twice, because some feeds double-encode (&amp;#039;). */
export function decode(s) {
  const once = (x) => x.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return once(once(String(s ?? "")));
}

/** Text of an element: CDATA unwrapped, tags removed, entities decoded, spaces collapsed. */
export function textOf(xml) {
  if (xml == null) return null;
  const s = String(xml).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const t = decode(decode(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return t || null;
}

const tag = (block, name) => {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = re.exec(block);
  return m ? m[1] : null;
};
const attr = (block, name, attribute) => {
  const m = new RegExp(`<${name}\\b[^>]*\\b${attribute}="([^"]*)"`, "i").exec(block);
  return m ? decode(m[1]) : null;
};

/** -> [{ title, link, description, date, id }] for every <item> (RSS) or <entry> (Atom). */
export function parseFeed(xml) {
  const src = String(xml || "");
  const blocks = [...src.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => ({ b: m[1], about: (/rdf:about="([^"]*)"/i.exec(m[0]) || [])[1] }));
  const entries = blocks.length ? blocks : [...src.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((m) => ({ b: m[1] }));
  return entries.map(({ b, about }) => {
    const link = textOf(tag(b, "link")) || attr(b, "link", "href") || (about ? decode(about) : null);
    return {
      title: textOf(tag(b, "title")),
      link,
      description: textOf(tag(b, "description")) || textOf(tag(b, "summary")) || textOf(tag(b, "content")) || textOf(tag(b, "content:encoded")),
      date: textOf(tag(b, "pubDate")) || textOf(tag(b, "dc:date")) || textOf(tag(b, "updated")) || textOf(tag(b, "published")),
      id: textOf(tag(b, "guid")) || textOf(tag(b, "id")) || link,
    };
  }).filter((x) => x.title || x.link);
}

/** Fetch and parse a feed, with a timeout and a readable error. */
export async function fetchFeed(url, { fetchImpl = fetch, name = "The feed" } = {}) {
  let res;
  try { res = await fetchImpl(url, { headers: { accept: "application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5", "user-agent": "ProjectAssistant/1.0 (tender feed reader)" }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error(`${name} did not answer.`); }
  if (!res.ok) throw new Error(`${name} returned an error (${res.status}).`);
  // Decode with the charset the feed declares (UNDP's feeds are ISO-8859-1), not blindly as UTF-8.
  const bytes = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 200));
  const charset = (/encoding="([^"]+)"/i.exec(head) || /charset=([\w-]+)/i.exec(res.headers?.get?.("content-type") || "") || [])[1] || "utf-8";
  let body;
  try { body = new TextDecoder(charset.toLowerCase()).decode(bytes); } catch { body = new TextDecoder("utf-8").decode(bytes); }
  if (!/<(rss|rdf:RDF|feed)\b/i.test(body)) throw new Error(`${name} did not send a feed (check the address).`);
  return parseFeed(body);
}

/** Keeps a feed for `ttl` ms, so every search does not download it again. */
export function cachedFeed(url, { fetchImpl = fetch, name, ttl = 10 * 60_000 } = {}) {
  let at = 0, items = null, pending = null;
  return async () => {
    if (items && Date.now() - at < ttl) return items;
    pending ||= fetchFeed(url, { fetchImpl, name }).then((x) => { items = x; at = Date.now(); return x; }).finally(() => { pending = null; });
    return pending;
  };
}
