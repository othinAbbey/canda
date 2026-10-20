# C & A API contract

This document is the contract between the API and any client (the website today, anything else tomorrow). It is also the
specification for a future rewrite in another language (for example Rust): an implementation that follows this document, applies
the same `migrations/*.sql`, and passes the same `tests/*.test.js` against its HTTP port is a drop-in replacement.

## Conventions

- Base path `/api`. JSON in and out (`content-type: application/json`), except file uploads (raw bytes) and downloads.
- Sign in with `POST /api/auth/login`; send `Authorization: Bearer <token>` on every other call.
- Ids are opaque strings. Dates are `YYYY-MM-DD`; timestamps are ISO 8601 UTC. Money and quantities are JSON numbers.
- Errors: `{"error": "readable message"}` with `400` bad input, `401` not signed in, `402` plan limit, `403` not allowed,
  `404` not found (also used to hide other people's records), `405` wrong method, `409` conflict, `413` too large, `429` slow down,
  `501` not built yet, `502/503` the BOQ service failed or is down, `500` bug.
- Unknown JSON fields are ignored. Empty strings are stored as `null`.
- Tokens are HMAC-signed and expire after `TOKEN_HOURS`. Changing a password or disabling an account invalidates all older tokens.

## Roles and permissions

Routes are protected by permission names, never by role names. `GET /api/me` returns the signed-in user's `permissions` list;
clients should check that list instead of hard-coding roles. The mapping lives in `src/auth/permissions.js`.

| Permission | user | viewer | manager | admin | Allows |
|---|:-:|:-:|:-:|:-:|---|
| `catalog:read` | x | x | x | x | Read materials, suppliers, locations, rates; use the calculator |
| `catalog:propose` | x | x | x | x | Suggest a material, supplier or location |
| `boq:use` | x | x | x | x | Upload drawings and see **your own** BOQ jobs |
| `billing:read` | x | x | x | x | See your plan and usage |
| `projects:read`, `files:read` |  | x | x | x | Read project data and documents |
| `projects:write`, `files:write` |  |  | x | x | Create, edit, delete project data and documents |
| `audit:read`, `messages:read` |  |  | x | x | Audit trail, website inbox |
| `catalog:write` |  |  |  | x | Edit the catalog directly |
| `proposals:review` |  |  |  | x | Approve or reject suggestions |
| `users:manage` |  |  |  | x | Create, disable, delete users; roles; reset codes |
| `boq:all`, `boq:rates` |  |  |  | x | See everyone's BOQ jobs; edit the shared BOQ rate book |
| `billing:manage`, `messages:manage` |  |  |  | x | Change a user's plan; delete messages |

## Endpoints

### Accounts
| Method and path | Who | Purpose |
|---|---|---|
| `GET /health` | public | `{ok, setup_required}` |
| `POST /auth/register` | public | `{email, password(8+), name?}`. First account becomes admin; later ones are role `user` if `ALLOW_SIGNUP`. Returns `{token, user}` |
| `POST /auth/login` | public | `{email, password}` returns `{token, user}` (10 failures per 5 minutes per IP, then 429) |
| `POST /auth/reset` | public | `{email, code, password}` with a one-time code from an admin |
| `GET /me` | signed in | `{id, email, name, role, status, permissions[], plan:{code,name}}` |
| `POST /me/password` | signed in | `{current, password}` returns a fresh `{token, user}`; other sessions end |
| `GET/POST /users`, `PATCH /users/:id`, `DELETE /users/:id` | `users:manage` | PATCH takes `{role}` and/or `{status: active|disabled}`. The last active admin cannot be demoted, disabled or deleted |
| `POST /users/:id/reset` | `users:manage` | Returns `{email, code, expires}` shown once |
| `PATCH /users/:id/plan` | `billing:manage` | `{plan}` |

### Project data (resources: `projects`, `tasks`, `costs`, `logs`, `issues`)
`GET /{resource}` (`?project=ID` for children), `GET /{resource}/:id`, `POST /{resource}`, `PATCH /{resource}/:id`, `DELETE /{resource}/:id`.
Read needs `projects:read`, write needs `projects:write`. Deleting a project deletes its children and documents.
Fields per resource are listed in `src/domain/resources.js`. Also: `GET /data` (all five lists), `GET /export` (everything, JSON),
`GET /projects/:id/summary`, `GET /summary` (portfolio) with progress, schedule, budget, forecast, issues, site logs, health `green|amber|red` and `reasons[]`.

### Documents
`GET /files?project=ID`, `POST /files?project=ID&name=plan.pdf&category=&note=` (the file is the request body, up to `MAX_UPLOAD_MB`),
`GET /files/:id/download`, `DELETE /files/:id`. Stored in the database.

### Material catalog (resources: `locations`, `materials`, `suppliers`, `rates`)
Same five routes. Read needs `catalog:read`, write needs `catalog:write`. Plus:
`GET /sourcing` (all four lists at once), `GET /structures`, `POST /quantities`
(`{structure, length, width, height, mix?, wastage?, block?, location_id?}` in metres, returns priced lines).

### Catalog suggestions
`POST /proposals {kind: material|supplier|location, payload}` creates a pending proposal (an admin's is approved at once),
`GET /proposals?status=` (admins see all, others their own), `POST /proposals/:id/approve|reject {note?}` (`proposals:review`),
`DELETE /proposals/:id` (withdraw your own pending one). Approval creates the real record, owned by the submitter.

### BOQ jobs (owned by the uploader)
`GET /boq/config`, `GET/PUT /boq/rates` (`boq:rates`), `GET /boq/jobs` (`?scope=all` for admins), `POST /boq/jobs?name=plan.pdf&force=false`
(PDF bytes as the body), `GET /boq/jobs/:id`, `POST /boq/jobs/:id/rebuild`, `GET /boq/jobs/:id/boq.xlsx`, `GET /boq/jobs/:id/pdf`, `DELETE /boq/jobs/:id`.
The PDF and the Excel result are stored in the database. Someone else's job answers `404`.

### Subscriptions (placeholders)
`GET /billing` returns plan, limits, usage and available plans with `billing_enabled:false`; `POST /billing/checkout` returns `501`.
Usage is recorded; limits apply only when `ENFORCE_PLAN_LIMITS=true` (then `402`).

### Other
`GET /audit?project=&entity=&action=&user=&limit=&before=` (`audit:read`, append-only, newest first, `next` is the paging cursor).
`POST /contact` (public, rate-limited, hidden `website` field is a spam trap), `GET/PATCH/DELETE /messages`.

## Database

PostgreSQL. The schema is `migrations/*.sql`, applied in order by `npm run migrate`. The SQL in `src/repos` uses only portable
features (`$1` placeholders, `RETURNING`, no vendor functions), which is why the test suite can also run it on an in-memory engine.
