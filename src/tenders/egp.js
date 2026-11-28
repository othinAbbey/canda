import { FEED_USER_AGENT } from "./rss.js";
import { matches, mentions } from "./feedTools.js";

/**
 * Uganda's Electronic Government Procurement portal (eGP, https://egpuganda.go.ug), run by PPDA. It has no feed or API,
 * but its public pages are open to readers (its robots.txt allows all). The home page lists current bid notices with a
 * category (Works, Supplies, Consultancy Services, Non Consultancy Services) and a date; each notice has its own page,
 * /index/<id>_egp, with the procurement reference and the full subject. We read the list, then each notice's page.
 * Every notice is in Uganda. If the portal changes its pages, this source shows an error and the others carry on.
 */
export const EGP_BASE = "https://egpuganda.go.ug";
const CATEGORIES = ["Non Consultancy Services", "Consultancy Services", "Works", "Supplies"];   // longest first, so "Consultancy" doesn't swallow "Non Consultancy"
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const decode = (s) => String(s || "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
export const textOf = (html) => decode(String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** "Dec-11 2026" or "11 Dec 2026" -> "2026-12-11". */
export function egpDate(s) {
  const t = String(s || "");
  let m = /\b([A-Za-z]{3})[a-z]*-(\d{1,2}),?\s+(\d{4})\b/.exec(t) || null, mo, d, y;
  if (m) [, mo, d, y] = m;
  else if ((m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})\b/.exec(t))) [, d, mo, y] = m;
  else return null;
  const n = MONTHS[mo.toLowerCase()];
  return n ? `${y}-${String(n).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
}

/** The bid notices on a list page: [{ id, title, category, date, url }]. */
export function parseEgpList(html) {
  const src = String(html || ""), seen = new Set(), out = [];
  const rows = /<tr\b/i.test(src) ? src.split(/<tr\b/i).slice(1) : src.split(/(?=<a\b[^>]*_egp)/i);
  for (const row of rows) {
    const body = row.split(/<\/tr>/i)[0];
    // A row links to its notice three times: the coat of arms (no text), the category, then the title (bold, cut short with "...").
    const links = [...body.matchAll(/<a\b([^>]*?)href="([^"]*\/index\/(\d+)_egp)"([^>]*)>([\s\S]*?)<\/a>/gi)];
    if (!links.length || seen.has(links[0][3])) continue;
    const id = links[0][3], text = textOf(body);
    seen.add(id);
    const category = CATEGORIES.find((c) => text.toLowerCase().includes(c.toLowerCase())) || null;
    const words = links.filter((a) => a[3] === id).map((a) => {
      const t = /title="([^"]*)"/i.exec(`${a[1]} ${a[4]}`);
      return (decode(t?.[1] || "") || textOf(a[5])).replace(/\s*(\.{3}|…)$/, "").trim();
    }).filter((w) => w && !CATEGORIES.some((c) => c.toLowerCase() === w.toLowerCase()));
    const href = links.find((a) => a[3] === id)[2];
    out.push({
      id,
      title: words.sort((a, b) => b.length - a.length)[0] || "",
      category,
      date: egpDate(text),
      url: href.startsWith("http") ? href : `${EGP_BASE}${href.startsWith("/") ? "" : "/"}${href}`,
    });
  }
  return out;
}

/** The details on a notice's page: { ref, subject, entity, deadline }. Labels may repeat (a header row, then values), so each is looked for with care. */
export function parseEgpNotice(html) {
  const t = textOf(html);
  // A PPDA procurement reference looks like MOICT/NCONS/2026-2027/00047 or UNRA/WRKS/25-26/00012.
  const ref = /\b([A-Z][A-Za-z]{1,15}(?:\/[A-Za-z]{2,10})?\/[A-Za-z]{2,8}\/\d{2,4}(?:-\d{2,4})?\/\d{2,6})\b/.exec(t)?.[1] || null;
  const STOP = /\s+(?:Email Address|Bid Security|Procurement Method|Procurement Ref|Deadline|The deadline|No #|Description|Title|Subject of|Suppliers|Bidders|Login|Register|Lodge|Complaint|\d{1,2}\s+[A-Z][A-Za-z]{1,15}\/)\b|\s+(?:The\s+)?(?:[A-Z][\w&,'()-]*\s+){1,10}has allocated funds/;
  const clean = (v) => {
    v = v.trim().replace(/[\s|:;,-]+$/, "").replace(/^\d{1,3}\s+/, "");         // a table row starts "1 | <ref> | <subject>"
    if (ref && v.startsWith(ref)) v = v.slice(ref.length).trim();
    return v.length >= 3 && v.length <= 300 && !/^(No #|Procurement|Email|Title|Description|Subject)\b/i.test(v) ? v : null; };
  let subject = null;
  for (const m of t.matchAll(/Subject of (?:the )?Procurement\s*:?\s*/gi)) { subject = clean(t.slice(m.index + m[0].length).split(STOP)[0]); if (subject) break; }
  if (!subject && ref) {          // in a table: "No # | Procurement Ref Number | Subject of Procurement" then "1 | <ref> | <subject>"
    for (let i = t.indexOf(ref); i >= 0 && !subject; i = t.indexOf(ref, i + 1)) subject = clean(t.slice(i + ref.length).split(STOP)[0]);
  }
  const WORD = "(?:[A-Z][\\w&,'()-]*|of|and|for|the|&)";
  const em = new RegExp(`\\bThe\\s+((?:${WORD}\\s+){1,14}?)(?:now\\s+)?invites?\\s+(?:sealed\\s+)?(?:bids|bidders|eligible)`).exec(t)
    || new RegExp(`(?:^|[.:|]\\s+|Notice\\s+|\\s)(?:The\\s+)?((?:${WORD}\\s+){1,14}?)has allocated funds`).exec(t)
    || new RegExp(`Notice from (?:the\\s+)?((?:${WORD}\\s+){1,14}?)(?:on|via|published|\\(|$)`).exec(t);
  // the page heading ("Request for Quotation Notice", "Bid Notice") can run into the name: drop those words from the front
  const entity = em ? em[1].trim().replace(/[,\s]+$/, "").replace(/^(?:(?:Request|for|Quotation|Quotations|Notice|Bid|Bids|Invitation|to|Tender|Expression|of|Interest|Open|Domestic|Bidding)\s+)+/i, "") || null : null;
  const dl = /deadline for (?:the )?(?:bid )?submission[^.]{0,80}?((?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4})|(?:[A-Za-z]{3}-\d{1,2},?\s+\d{4}))/i.exec(t);
  return { ref, subject, entity, deadline: dl ? egpDate(dl[1]) : null };
}

async function getPage(fetchImpl, url, name) {
  let res;
  try { res = await fetchImpl(url, { headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": "en", "user-agent": FEED_USER_AGENT }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error(`${name} did not answer.`); }
  if (!res.ok) throw new Error(`${name} returned an error (${res.status}).`);
  return res.text();
}

export function createEgpProvider({ fetchImpl = fetch, base = EGP_BASE, ttl = 30 * 60_000, details = 30 } = {}) {
  const name = "Uganda's eGP portal";
  let at = 0, cache = null, pending = null;
  const detailCache = new Map();          // id -> details: a notice's page doesn't change, so it is read once

  async function load() {
    const list = parseEgpList(await getPage(fetchImpl, `${base}/`, name));
    if (!list.length) throw new Error(`${name} answered, but no bid notices could be read from it (its pages may have changed).`);
    const open = list.filter((n) => !n.date || n.date >= new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10));
    const todo = open.slice(0, details).filter((n) => !detailCache.has(n.id));
    for (let i = 0; i < todo.length; i += 4) {              // four pages at a time, to be gentle with the portal
      await Promise.all(todo.slice(i, i + 4).map(async (n) => {
        try { detailCache.set(n.id, parseEgpNotice(await getPage(fetchImpl, n.url, name))); } catch { /* the list's own words are used instead */ }
      }));
    }
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);   // Kampala's date
    return list.filter((n) => !n.date || n.date >= today).map((n) => {
      const d = detailCache.get(n.id) || {};
      return {
        source: "egp", external_id: n.id, title: d.subject || n.title, buyer: d.entity || null, country: "Uganda",
        type: n.category, method: null, reference: d.ref || null,
        published: null, deadline: d.deadline || n.date || null,
        description: d.ref ? `Procurement reference ${d.ref}` : null, url: n.url,
      };
    });
  }
  const notices = async () => {
    if (cache && Date.now() - at < ttl) return cache;
    pending ||= load().then((x) => { cache = x; at = Date.now(); return x; }).catch((e) => { if (cache) return cache; throw e; }).finally(() => { pending = null; });
    return pending;
  };

  return {
    id: "egp",
    name: "Uganda eGP (PPDA)",
    note: "Current bid notices from Uganda's Electronic Government Procurement portal (egpuganda.go.ug), read from its public pages. Always check the notice on the portal before you bid.",
    async search({ q = "", country = "", rows = 50, offset = 0 } = {}) {
      if (country && !mentions("Uganda", country)) return { total: 0, items: [] };
      const all = (await notices()).filter((n) => matches(`${n.title} ${n.buyer || ""} ${n.type || ""} ${n.reference || ""}`, q));
      return { total: all.length, items: all.slice(offset, offset + rows) };
    },
  };
}
