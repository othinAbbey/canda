# Layer 1: Organizations (multi-tenancy foundation)

## How to apply
Extract this zip's `canda-api/` folder over your existing `canda-api/` project,
overwriting the files listed below. Then run your migration step as usual
(e.g. `npm run migrate` or however your project applies new `migrations/*.sql`
files) before starting the server.

**Back up your database before migrating** -- this changes the `users` table.

## New files
- `migrations/012_organizations.sql` -- creates `organizations`; adds
  `organization_id` to `users`, backfilling existing users into a
  `C & A Contractors Limited` organization so no existing data is orphaned.
- `src/repos/organizations.js`
- `src/services/organizations.js`

## Modified files
- `src/repos/users.js` -- `list()` and `countActiveAdmins()` now take an
  `organizationId` and scope to it; `create()` stores `organization_id`.
- `src/services/accounts.js` -- `register()` now always creates a brand-new
  organization (atomically, in one DB transaction, with the signing-up user
  as its admin). There is no more "first user in the whole system becomes
  admin" -- every signup is the start of a new company workspace. Admin
  actions (list users, invite a teammate, reset code, role/status change,
  delete) are scoped to the acting admin's own organization; touching another
  company's user returns 404, not 403, so one company's admin can't even
  confirm another company's account exists.
- `src/services/index.js`, `src/routes/index.js`, `src/routes/accounts.js` --
  wiring: pass `db` and the new `organizations` service where needed, drop
  the old `setup_required` health check, `/api/me` now includes
  `organization: {id, name, logo_url}`.
- `tests/support/testApp.js`, `tests/accounts.test.js` -- updated for the new
  registration shape and multi-tenant behavior (includes a dedicated test
  proving cross-tenant isolation).

## Breaking change for callers
`POST /api/auth/register` now REQUIRES `organization_name` in the body
(2-120 characters) alongside `email`, `password`, `name`. Your frontend
signup form has not been updated yet to collect this -- that's the next
small step, separate from this backend layer.

## Not included in this layer
Project data, tenders, BOQ jobs, forms, and the material catalog are not
yet scoped to an organization (that's Layer 2). `tenderWork.test.js` will
show 3 failures until that lands -- expected, not a regression.

## Verified
All 10 backend test files run clean (144 passing) after this change,
including the full `accounts.test.js` suite (12/12).
