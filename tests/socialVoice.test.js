import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { startTestApp } from "./support/testApp.js";
import { speechSsml } from "../src/services/social.js";

describe("advert voiceovers (Azure text to speech)", () => {
  let t, team, other, azure, seen = [], reply = 200;
  before(async () => {
    azure = http.createServer((req, res) => {
      let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
        seen.push({ headers: req.headers, body });
        if (reply !== 200) { res.writeHead(reply); return res.end(); }
        res.writeHead(200, { "content-type": "audio/mpeg" }); res.end(Buffer.from("ID3-fake-mp3"));
      });
    });
    await new Promise((r) => azure.listen(0, "127.0.0.1", r));
    t = await startTestApp({ env: { BUILDSUITE_TEAM_EMAILS: "team@b.test", AZURE_SPEECH_KEY: "k123", AZURE_SPEECH_REGION: "southafricanorth", AZURE_SPEECH_ENDPOINT: `http://127.0.0.1:${azure.address().port}/tts` } });
    team = await t.account("team@b.test"); other = await t.account("boss@acme.test");
  });
  after(() => { t.close(); azure.close(); });

  it("tells the team the voice is on, and nobody else", async () => {
    assert.deepEqual((await t.call("GET", "/api/social/voice", null, team)).body, { configured: true, voice: "en-KE-AsiliaNeural", name: "Asilia" });
    assert.equal((await t.call("GET", "/api/social/voice", null, other)).status, 403);
  });
  it("reads each line with the key and the female Kenyan voice, and returns one MP3 per line", async () => {
    const r = await t.call("POST", "/api/social/voice", { lines: ["New tender for Ugandan contractors!", "", "Find it on buildsuite360.org"] }, team);
    assert.equal(r.status, 200);
    assert.equal(r.body.parts.length, 3); assert.equal(r.body.parts[1], null);
    assert.equal(Buffer.from(r.body.parts[0].audio, "base64").toString(), "ID3-fake-mp3");
    assert.equal(seen.length, 2);
    assert.equal(seen[0].headers["ocp-apim-subscription-key"], "k123");
    assert.equal(seen[0].headers["x-microsoft-outputformat"], "audio-24khz-96kbitrate-mono-mp3");
    assert.match(seen[0].body, /<voice name="en-KE-AsiliaNeural">/); assert.match(seen[0].body, /xml:lang="en-KE"/);
    assert.match(seen[1].body, /<sub alias="Build suite three sixty dot org">buildsuite360\.org<\/sub>/);
  });
  it("refuses outsiders, long text, and explains a wrong key", async () => {
    assert.equal((await t.call("POST", "/api/social/voice", { lines: ["hi"] }, other)).status, 403);
    assert.equal((await t.call("POST", "/api/social/voice", { lines: ["x".repeat(401)] }, team)).status, 400);
    assert.equal((await t.call("POST", "/api/social/voice", { lines: [] }, team)).status, 400);
    reply = 401;
    const r = await t.call("POST", "/api/social/voice", { lines: ["hi"] }, team);
    assert.equal(r.status, 502); assert.match(r.body.error, /AZURE_SPEECH_KEY/);
    reply = 200;
  });
  it("escapes the text so it can't break the speech markup", () => {
    const s = speechSsml("Bids <close> & UGX 100,000 for UNDP", "en-KE-AsiliaNeural");
    assert.match(s, /Bids &lt;close&gt; &amp; <sub alias="Uganda shillings">UGX<\/sub> 100,000 for <say-as interpret-as="characters">UNDP<\/say-as>/);
  });
});

describe("advert voiceovers when Azure isn't set up", () => {
  let t, team;
  before(async () => { t = await startTestApp({ env: { BUILDSUITE_TEAM_EMAILS: "team@b.test" } }); team = await t.account("team@b.test"); });
  after(() => t.close());
  it("says the voice is off", async () => {
    assert.equal((await t.call("GET", "/api/social/voice", null, team)).body.configured, false);
    assert.equal((await t.call("POST", "/api/social/voice", { lines: ["hi"] }, team)).status, 503);
  });
});
