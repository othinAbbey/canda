import { HttpError, ValidationError, notFound } from "../errors.js";

/** The public Contact form and the admin inbox. */
export function createContact({ messages, audit, limiter }) {
  return {
    async submit(x, ip) {
      if (x.website) return;                                           // hidden spam-trap field: pretend it worked
      if (limiter.blocked(`contact:${ip}`)) throw new HttpError(429, "too many messages, please try again later");
      const name = String(x.name || "").trim(), email = String(x.email || "").trim(), message = String(x.message || "").trim();
      if (!name || name.length > 100) throw new ValidationError("please enter your name");
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200) throw new ValidationError("please enter a valid email");
      if (message.length < 5 || message.length > 2000) throw new ValidationError("message must be 5 to 2000 characters");
      limiter.strike(`contact:${ip}`, 2);                              // about 5 messages per 5 minutes
      await messages.insert({ name, email, phone: String(x.phone || "").trim().slice(0, 40) || null, message });
      await audit.log(null, { action: "contact", entity: "messages", summary: `message from ${name}` });
    },
    list: () => messages.list(),
    async setStatus(actor, id, status) {
      if (!["new", "read", "replied"].includes(status)) throw new ValidationError("status must be new, read or replied");
      const m = await messages.setStatus(id, status); if (!m) throw notFound();
      await audit.log(actor, { action: "update", entity: "messages", id, summary: `marked ${status}` });
      return m;
    },
    async remove(actor, id) { if (!(await messages.remove(id))) throw notFound(); await audit.log(actor, { action: "delete", entity: "messages", id, summary: "message deleted" }); },
  };
}
