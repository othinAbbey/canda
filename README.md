# canda-api

The backend for C & A Contractors: accounts and roles, projects, documents, material catalog, BOQ jobs, audit trail, subscription placeholders.
Node 22.13+, **PostgreSQL**, one runtime dependency (`pg`). It exposes a JSON HTTP API described in `docs/API.md`; it does not depend on the website.

## Run it

    docker compose up -d                 # optional: a local PostgreSQL (or use your own and set DATABASE_URL)
    copy .env.example .env               # macOS/Linux: cp .env.example .env     then edit DATABASE_URL, BOQ_SERVICE_KEY
    npm install
    npm start                            # applies migrations, seeds an empty catalog, listens on http://127.0.0.1:8100

The first account created through `POST /api/auth/register` becomes the admin. Locked out? `npm run reset-admin -- you@example.com`.

## Layout (read top to bottom)

    migrations/        plain SQL schema, numbered, never edited after release
    src/server.js      starts everything          src/cli.js   migrate | seed | reset-admin
    src/http/          router, request/response helpers, app wiring, rate limiter
    src/routes/        thin: read the request, call ONE service method, return the result
    src/services/      business rules (accounts, proposals, boq, billing ...). No HTTP, no SQL
    src/repos/         all SQL, one file per area. No business rules
    src/domain/        pure logic with no I/O: calculator, health rules, field definitions
    src/auth/          permissions matrix (single source of truth for rights), passwords, tokens
    src/db/            the small database interface + PostgreSQL adapter + migration runner
    tests/             `npm test` (84 tests); tests/support has the in-memory test database
    docs/API.md        the contract

Rules that keep it maintainable: routes never touch SQL; services never touch HTTP; repos never hold business rules;
rights are checked by permission name (`src/auth/permissions.js`), never by role name.

## Common changes

- **New right or changed role:** edit `src/auth/permissions.js` and the table in `docs/API.md`.
- **New simple table:** add a migration, add it to `src/domain/resources.js` (gets all five routes, validation and audit for free).
- **New feature:** a repo (SQL), a service (rules), a route file, tests.
- **Turn on subscriptions later:** connect a payment provider in `services/billing.js` (`checkout`), set `ENFORCE_PLAN_LIMITS=true`.

## Testing note

`npm test` runs against an in-memory engine through `tests/support/sqliteDb.js` with the same migrations and queries, so it needs no database
server. It does not replace one check against real PostgreSQL: run `npm start` against your database and click through once (see the root README).
