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

Routes are protected by **permission names**, never role names. `GET /api/me` returns the user's `permissions` list; clients check that list instead of hard-coding roles.
Roles are rows in the `roles` table: an admin can create roles and choose their rights (`/api/roles`). The catalog of rights that exist, with labels, is in
`src/auth/permissions.js` (`GET /api/permissions`). The built-in roles are created on first start and can be adjusted by an admin, except **Administrator**, which always has everything.

| Built-in role (code) | Starting rights |
|---|---|
| Administrator (`admin`) | everything, including `users:manage` and `roles:manage` (only this role can hold those two) |
| General Project Manager (`general_pm`) | project work and documents, tenders incl. `tenders:assign`, audit, website inbox. **Copied in automatically on every tender task** |
| Project Manager (`manager`) | project work and documents, tenders (read/write), audit, website inbox. **Receives tender tasks** |
| Viewer (`viewer`) | read-only projects, documents and tenders, plus the customer rights |
| Customer (`user`) | material catalog (read, suggest), calculator, own BOQ jobs, own plan |

## Endpoints

### Roles and people
`GET /roles`, `GET /permissions`, `POST /roles {name, description, permissions[]}`, `PATCH /roles/:code`, `DELETE /roles/:code` (`roles:manage`; `GET /roles` needs `users:manage`).
Custom roles cannot hold admin-only rights; a role that people still have cannot be deleted; `admin` cannot be edited. Role changes apply on the next request.
`GET /team?role=manager` lists active staff (used for the project-manager dropdown); without `role` it lists everyone with project access. Customers are never listed.

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
(PDF bytes as the body), `GET /boq/jobs/:id`, `POST /boq/jobs/:id/rebuild`, `GET /boq/jobs/:id/boq.xlsx`, `GET /boq/jobs/:id/pdf`, `POST /boq/jobs/:id/retry` (a failed job, re-sent from the PDF stored in the database), `DELETE /boq/jobs/:id`
(removes the database row **and** asks the BOQ service to delete its copy). `GET /boq/jobs` returns light rows (no `result`); open a job for the full result.
The PDF and the Excel result are stored in the database. Someone else's job answers `404`.

### Schedule (MS Project style)
Tasks carry `duration` (working days), `percent`, `milestone` (0/1), `parent` (a task with children is a summary task), `sort_order`, `baseline_start`, `baseline_end`;
a project has a `workweek` (`mon-fri`, `mon-sat`, `all`). A task's `start` is a "start no earlier than" constraint; links can only push it later.
`GET /projects/:id/schedule` returns every task with `scheduled_start/finish`, `float`, `critical`, `wbs`, `level`, `summary`, `percent_complete`, `finish_variance`
(working days late against the baseline) and `differs` (saved dates differ from the schedule), plus `links`, `warnings` and `project {start, finish, working_days, critical_tasks}`.
`POST /projects/:id/schedule/apply` writes the scheduled dates into the tasks. `POST /projects/:id/baseline` saves (or `{clear:true}` clears) the baseline.
Dependencies: `POST /task_links {predecessor, successor, type: FS|SS|FF|SF, lag}`, `PATCH /task_links/:id`, `DELETE /task_links/:id`.
Self-links, duplicates, loops and links across projects are refused. The maths is `src/domain/schedule.js` (pure, documented, fully tested): port it as is.

### Tenders
Pipeline rows carry `value` and `currency` (`UGX`, `USD`, `EUR`, `KES`, `TZS`). `GET /tenders/summary` totals the open pipeline (saved, interested, bidding, submitted), won and lost **per currency**; currencies are never converted or mixed.
**Assigning work:** `POST /tenders/:id/tasks {title, assignee, due?, priority?, notes?, cc?[]}` (`tenders:assign`). `assignee` must be an active user with role `manager` (Project Manager).
Every active `general_pm` user is copied in automatically (plus any `cc` ids that are active staff). `GET /tender_tasks?mine=1` returns tasks assigned to me **or** copied to me, each with `relation`;
`?tender=ID` lists a tender's tasks. `PATCH /tender_tasks/:id`: the assignee may change `status`, `notes`, `due`; changing `title` or `priority`, or deleting, needs `tenders:assign`. Email is not sent.
`GET /tenders/sources`, `GET /tenders/search?q=&country=&source=&page=` (live, cached 10 minutes; each item says if it is already in the pipeline),
and the resources `tenders` (the pipeline: status saved, interested, bidding, submitted, won, lost, dismissed) and `tender_searches` (shared saved searches).
Sources are providers in `src/tenders/`. Built in: World Bank procurement notices (free public API). Uganda's e-GP portal has no public API, so those are added by hand.

### Subscriptions (placeholders)
`GET /billing` returns plan, limits, usage and available plans with `billing_enabled:false`; `POST /billing/checkout` returns `501`.
Usage is recorded; limits apply only when `ENFORCE_PLAN_LIMITS=true` (then `402`).

### Other
`GET /audit?project=&entity=&action=&user=&limit=&before=` (`audit:read`, append-only, newest first, `next` is the paging cursor).
`POST /contact` (public, rate-limited, hidden `website` field is a spam trap), `GET/PATCH/DELETE /messages`.

## Database

PostgreSQL. The schema is `migrations/*.sql`, applied in order by `npm run migrate`. The SQL in `src/repos` uses only portable
features (`$1` placeholders, `RETURNING`, no vendor functions), which is why the test suite can also run it on an in-memory engine.
