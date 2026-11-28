import { created } from "../http/reply.js";

/** Buildsuite360's adverts and daily social media posts (the Buildsuite360 team only: see auth/team.js). */
export default function socialRoutes(r, { social }) {
  const m = {};          // signed in; the service checks the person is on the Buildsuite360 team (by email)
  r.get("/api/social/posts", m, (c) => social.list(c.user));
  r.post("/api/social/posts/generate", m, async (c) => created(await social.generate(c.user, await c.json())));
  r.get("/api/social/posts/:id", m, (c) => social.get(c.user, c.params.id));
  r.patch("/api/social/posts/:id", m, async (c) => social.update(c.user, c.params.id, await c.json()));
  r.post("/api/social/posts/:id/approve", m, (c) => social.approve(c.user, c.params.id));
  r.post("/api/social/posts/:id/posted", m, async (c) => social.markPosted(c.user, c.params.id, await c.json()));
  r.post("/api/social/posts/:id/skip", m, (c) => social.skip(c.user, c.params.id));
  r.get("/api/social/voice", m, (c) => social.voiceInfo(c.user));
  r.post("/api/social/voice", m, async (c) => social.voice(c.user, await c.json()));
  // a photo / screenshot / PDF of a notice, sent as the request body -> advert fields (nothing saved)
  r.post("/api/social/read-notice", m, async (c) => social.readNotice(c.user, await c.raw(social.noticeMaxBytes)));
}
