import crypto from "node:crypto";
import { HttpError, ValidationError, notFound } from "../errors.js";
import { newId, now } from "../ids.js";
import { permissionsOf, ROLES } from "../auth/permissions.js";
import { hashPassword, sha256, verifyPassword } from "../auth/passwords.js";
import { signToken, verifyToken } from "../auth/tokens.js";

const EMAIL = /^\S+@\S+\.\S+$/;
const normEmail = (e) => String(e || "").trim().toLowerCase();

function checkCredentials(email, password) {
  if (!EMAIL.test(email) || email.length > 200) throw new ValidationError("enter a valid email");
  if (String(password).length < 8) throw new ValidationError("password must be at least 8 characters");
}

/** Accounts: sign-up, sign-in, password reset, roles. Knows nothing about HTTP. */
export function createAccounts({ users, audit, config, secret, limiter }) {
  const pub = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, permissions: permissionsOf(u.role) });
  const session = (u) => ({ token: signToken({ uid: u.id, tv: u.token_version }, secret, config.tokenHours), user: pub(u) });
  const throttle = (ip) => { if (limiter.blocked(`auth:${ip}`)) throw new HttpError(429, "too many attempts, try again in a few minutes"); };
  const create = (email, name, role, password) => users.create({ id: newId(), email, name: String(name || "").trim() || email, role, passwordHash: hashPassword(password), created: now() });
  const lastAdminGuard = async (target, what) => {
    if (target.role === "admin" && target.status === "active" && (await users.countActiveAdmins()) <= 1) throw new ValidationError(`you cannot ${what} the only admin`);
  };

  return {
    pub,

    /** Turns a "Bearer <token>" header into the signed-in user, or throws 401. */
    async authenticate(header) {
      const m = /^Bearer (.+)$/.exec(header || "");
      const p = m && verifyToken(m[1], secret);
      const u = p && (await users.byId(p.uid));
      if (!u || u.status !== "active" || p.tv !== u.token_version) throw new HttpError(401, "please sign in");
      return u;
    },
    setupRequired: async () => (await users.count()) === 0,

    async register({ email, name, password }, ip) {
      throttle(ip);
      email = normEmail(email); checkCredentials(email, password);
      const first = (await users.count()) === 0;
      if (!first && !config.allowSignup) throw new HttpError(403, "sign-up is closed; ask an admin to create your account");
      if (await users.byEmail(email)) throw new HttpError(409, "that email already has an account");
      const u = await create(email, name, first ? "admin" : "user", String(password));
      await audit.log(u, { action: "register", entity: "users", id: u.id, summary: first ? `first admin ${u.email}` : `new account ${u.email}` });
      return session(u);
    },

    async login({ email, password }, ip) {
      throttle(ip);
      email = normEmail(email);
      const u = await users.byEmail(email);
      if (!u || u.status !== "active" || !verifyPassword(String(password || ""), u.password_hash)) {
        limiter.strike(`auth:${ip}`);
        await audit.log({ email }, { action: "login_failed", entity: "users", summary: `failed sign-in for ${email}` });
        throw new HttpError(401, "wrong email or password");
      }
      limiter.clear(`auth:${ip}`);
      await audit.log(u, { action: "login", entity: "users", id: u.id, summary: "signed in" });
      return session(u);
    },

    /** Finish a reset with the one-time code an admin gave the user. */
    async resetWithCode({ email, code, password }, ip) {
      throttle(ip);
      email = normEmail(email); checkCredentials(email, password);
      const u = await users.byEmail(email);
      const clean = String(code || "").replace(/[^0-9a-z]/gi, "").toUpperCase();
      const row = u && (await users.findReset(u.id, sha256(clean)));
      if (!row || row.expires < now()) { limiter.strike(`auth:${ip}`); throw new ValidationError("that code is wrong or has expired"); }
      const fresh = await users.setPassword(u.id, hashPassword(String(password)));
      await users.clearResets(u.id);
      await audit.log(fresh, { action: "password_reset", entity: "users", id: fresh.id, summary: "password reset with a one-time code" });
      return session(fresh);
    },

    async changePassword(user, { current, password }, ip) {
      throttle(ip);
      if (!verifyPassword(String(current || ""), user.password_hash)) { limiter.strike(`auth:${ip}`); throw new ValidationError("current password is wrong"); }
      checkCredentials(user.email, password);
      const fresh = await users.setPassword(user.id, hashPassword(String(password)));
      await audit.log(fresh, { action: "password_change", entity: "users", id: fresh.id, summary: "changed own password" });
      return session(fresh);                      // every older token (other devices) stops working
    },

    // ---- admin ----
    list: () => users.list(),
    async createUser(admin, { email, name, password, role }) {
      email = normEmail(email); checkCredentials(email, password);
      if (!ROLES.includes(role)) throw new ValidationError(`role must be one of ${ROLES.join(", ")}`);
      if (await users.byEmail(email)) throw new HttpError(409, "that email already has an account");
      const u = await create(email, name, role, String(password));
      await audit.log(admin, { action: "create", entity: "users", id: u.id, summary: `${u.email} (${u.role})` });
      return pub(u);
    },
    async issueResetCode(admin, id) {
      const target = await users.byId(id); if (!target) throw notFound("user not found");
      const raw = crypto.randomBytes(5).toString("hex").toUpperCase(), expires = new Date(Date.now() + config.resetMinutes * 60_000).toISOString();
      await users.replaceReset(id, sha256(raw), expires);
      await audit.log(admin, { action: "reset_code_issued", entity: "users", id, summary: `reset code issued for ${target.email}` });
      return { email: target.email, code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expires };
    },
    async setRole(admin, id, role) {
      const target = await users.byId(id); if (!target) throw notFound("user not found");
      if (!ROLES.includes(role)) throw new ValidationError(`role must be one of ${ROLES.join(", ")}`);
      if (role !== "admin") await lastAdminGuard(target, "demote");
      const u = await users.setRole(id, role);
      await audit.log(admin, { action: "update", entity: "users", id, summary: target.email, changes: { role: [target.role, role] } });
      return pub(u);
    },
    async setStatus(admin, id, status) {
      const target = await users.byId(id); if (!target) throw notFound("user not found");
      if (!["active", "disabled"].includes(status)) throw new ValidationError("status must be active or disabled");
      if (status === "disabled") await lastAdminGuard(target, "disable");
      const u = await users.setStatus(id, status);                  // also signs the user out everywhere
      await audit.log(admin, { action: "update", entity: "users", id, summary: target.email, changes: { status: [target.status, status] } });
      return pub(u);
    },
    async remove(admin, id) {
      const target = await users.byId(id); if (!target) throw notFound("user not found");
      if (id === admin.id) throw new ValidationError("you cannot delete your own account");
      await lastAdminGuard(target, "delete");
      await users.remove(id);
      await audit.log(admin, { action: "delete", entity: "users", id, summary: target.email });
    },
  };
}
