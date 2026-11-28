import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cachedFeed, fetchFeed, FEED_USER_AGENT } from "../src/tenders/rss.js";

const XML = '<?xml version="1.0"?><rss><channel><item><title>EOI - Uganda - Roads</title><link>https://x.test/1</link></item></channel></rss>';
const reply = (status, body = XML) => ({ ok: status < 400, status, headers: { get: () => "application/xml" }, arrayBuffer: async () => new TextEncoder().encode(body).buffer });

describe("feed fetching", () => {
  it("introduces itself as Buildsuite360 and tries a refusal once more", async () => {
    const seen = [];
    const fetchImpl = async (url, opts) => { seen.push(opts.headers["user-agent"]); return seen.length === 1 ? reply(403) : reply(200); };
    const items = await fetchFeed("https://x.test/feed", { fetchImpl, retryDelay: 0 });
    assert.equal(items.length, 1); assert.equal(seen.length, 2);
    assert.equal(seen[0], FEED_USER_AGENT); assert.match(FEED_USER_AGENT, /Buildsuite360.*buildsuite360\.org/);
  });
  it("gives a plain error when refused twice, and doesn't retry a 404", async () => {
    let n = 0;
    await assert.rejects(fetchFeed("u", { fetchImpl: async () => { n++; return reply(403); }, retryDelay: 0, name: "The AfDB feed" }), /The AfDB feed returned an error \(403\)/);
    assert.equal(n, 2); n = 0;
    await assert.rejects(fetchFeed("u", { fetchImpl: async () => { n++; return reply(404); }, retryDelay: 0 }), /404/);
    assert.equal(n, 1);
  });
  it("uses the last good copy when a later download is refused", async () => {
    let fail = false;
    const feed = cachedFeed("u", { fetchImpl: async () => reply(fail ? 403 : 200), ttl: 0, retryDelay: 0, name: "The AfDB feed" });
    assert.equal((await feed()).length, 1);
    fail = true;
    assert.equal((await feed()).length, 1);              // still served, from the earlier copy
    assert.match(feed.lastError, /403/);
    const cold = cachedFeed("u", { fetchImpl: async () => reply(403), ttl: 0, retryDelay: 0 });
    await assert.rejects(cold(), /403/);                  // nothing to fall back on
  });
});
