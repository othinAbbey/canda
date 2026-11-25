import zlib from "node:zlib";

/** Plain text out of a web page: scripts, styles and tags removed, common entities decoded. */
export function htmlToText(html) {
  return decode(String(html)
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v\r]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', bull: "-" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** Links on a page that look like bid documents (PDF or Word), made absolute. */
export function documentLinks(html, baseUrl, max = 4) {
  const out = [], seen = new Set();
  for (const m of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url; try { url = new URL(decode(m[1]), baseUrl).toString(); } catch { continue; }
    if (!/^https?:/i.test(url)) continue;
    const label = htmlToText(m[2]).slice(0, 120);
    if (!/\.(pdf|docx)(\?|$)/i.test(url) && !/\b(pdf|bid document|tender document|solicitation|itb|rfq|rfp|download)\b/i.test(label)) continue;
    if (seen.has(url)) continue; seen.add(url);
    out.push({ url, label: label || url.split("/").pop() });
    if (out.length >= max) break;
  }
  return out;
}

/** The text of a .docx (Word) file: reads word/document.xml from the zip, with no outside library. */
export function docxText(buf) {
  const xml = zipEntry(buf, "word/document.xml");
  if (!xml) throw new Error("not a Word (.docx) document");
  return decode(xml.toString("utf8").replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function zipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), entry = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 50 * 1048576 });
      return null;
    }
    p += 46 + nameLen + extra + comment;
  }
  return null;
}
