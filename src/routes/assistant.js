/** The AI project assistant (services/assistant.js). Every change it proposes needs the asker's Confirm. */
export default function assistantRoutes(r, { assistant }) {
  const use = { perm: "assistant:use" };
  r.get("/api/assistant", use, (c) => assistant.status(c.user));
  r.post("/api/assistant/chat", use, async (c) => assistant.chat(c.user, await c.json()));
  r.post("/api/assistant/actions/:id/confirm", use, (c) => assistant.confirm(c.user, c.params.id));
  r.post("/api/assistant/actions/:id/cancel", use, (c) => assistant.cancel(c.user, c.params.id));
}
