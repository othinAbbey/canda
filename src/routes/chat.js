import { created } from "../http/reply.js";

/** Site Chat (services/siteChat.js): rooms, messages, and the site log / issue drafts the bot or people put in them. */
export default function chatRoutes(r, { siteChat }) {
  const use = { perm: "chat:use" };
  r.get("/api/chat/rooms", use, (c) => siteChat.rooms(c.user));
  r.post("/api/chat/rooms/open", use, async (c) => siteChat.open(c.user, await c.json()));
  r.get("/api/chat/rooms/:id/messages", use, (c) => siteChat.messages(c.user, c.params.id, c.query));
  r.post("/api/chat/rooms/:id/messages", use, async (c) => created(await siteChat.send(c.user, c.params.id, await c.json())));
  r.post("/api/chat/rooms/:id/drafts", use, async (c) => created(await siteChat.newDraft(c.user, c.params.id, await c.json())));
  r.post("/api/chat/drafts/:id/save", use, async (c) => siteChat.saveDraft(c.user, c.params.id, await c.json()));
  r.post("/api/chat/drafts/:id/dismiss", use, (c) => siteChat.dismissDraft(c.user, c.params.id));
}
