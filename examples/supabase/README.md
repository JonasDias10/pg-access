# pg-access + Supabase example

A small Fastify API (signup, login, `posts` CRUD) in front of a real, local
Supabase project, to show pg-access's generated RLS policies enforced
through an ordinary web framework, not just direct
`@supabase/supabase-js` calls.

```text
pgaccess.config.ts (DSL)
   -> pg-access generate         (@pg-access/cli)
   -> supabase/migrations/<timestamp>_pg_access.sql
   -> supabase db reset          (applies it)
   -> src/server.ts              (Fastify API, signup/login/posts)
   -> test/integration/          (proves RLS through the API, not around it)
```

## Layout

- [`src/schemas/`](src/schemas): zod schemas, and the types the rest of the
  app imports from `z.infer`. Declared once and used both to validate each
  request (via `fastify-type-provider-zod`) and to generate the OpenAPI
  document Swagger UI renders; there's no separate, hand-written docs to
  keep in sync.
- [`src/supabase.ts`](src/supabase.ts): Supabase client factories, an anon
  client for signup/login, and a per-request client that forwards the
  caller's JWT so RLS evaluates as that user.
- [`src/plugins/auth.ts`](src/plugins/auth.ts): the `requireAuth` preHandler
  hook that validates the `Authorization: Bearer <token>` header.
- [`src/routes/`](src/routes): `/signup` + `/login`, and `/posts` CRUD.
- [`src/app.ts`](src/app.ts) / [`src/server.ts`](src/server.ts): wires the
  routes, `@fastify/swagger`, and `@fastify/swagger-ui` into a Fastify
  instance and starts it.
- [`test/integration/api.integration.test.ts`](test/integration/api.integration.test.ts):
  drives the API with Fastify's `.inject()` (no real HTTP socket) against
  the live database, and asserts on what each user can and can't do.

## Schema

[supabase/migrations/20260823173715_initial_schema.sql](supabase/migrations/20260823173715_initial_schema.sql)
defines two tables, both keyed off `auth.users(id)`:

- `profiles`: one row per user, inserted automatically by an
  `on_auth_user_created` trigger on sign-up.
- `posts`: `user_id`-owned.

and [pgaccess.config.ts](pgaccess.config.ts) says who can touch them: the
row's owner, or anyone carrying `role: "admin"` in their JWT `app_metadata`.
[supabase/migrations/20260823180129_pg_access.sql](supabase/migrations/20260823180129_pg_access.sql)
is what `pg-access generate` compiled that config into.

## Run it

Needs the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker.

```bash
pnpm install
pnpm --filter @pg-access/example-supabase exec supabase start
```

Copy its printed API URL, anon key, and service role key into `.env` (copy
`.env.example` to `.env` first), then apply the schema and the
pg-access-generated policies:

```bash
pnpm --filter @pg-access/example-supabase exec supabase db reset
```

Run the API:

```bash
pnpm --filter @pg-access/example-supabase dev
```

and open [localhost:3000](http://localhost:3000): that's Swagger UI, generated
from the same zod schemas that validate each request, with "Try it out" for
every route. `POST /signup` returns an `accessToken`; paste it into the
"Authorize" button (top right) and every `/posts` call after that carries it
as a Bearer token, so you can exercise the RLS-scoped routes from the
browser without writing a client.

or run the tests against the same live database instead:

```bash
pnpm --filter @pg-access/example-supabase test:integration
```

The suite signs up real users through `POST /signup`, has them create
`posts` through the API, and checks that `GET /posts` only ever returns the
caller's own rows and that `PATCH`/`DELETE` on someone else's post comes
back `404`, not `403`: RLS filters the row out before the write ever runs,
so from the API's point of view it simply doesn't exist for that caller.

## Regenerating the migration

After editing `pgaccess.config.ts`:

```bash
pnpm --filter @pg-access/example-supabase generate
```

writes a new timestamped `supabase/migrations/<timestamp>_pg_access.sql`
via [`@pg-access/cli`](../../packages/cli). Apply it with `supabase db reset`
(or `supabase migration up` against a project with data worth keeping).

## Table-level GRANTs

pg-access only emits RLS policies, never `GRANT`s; that's a deliberate scope
boundary, see the root README's [Security](../../README.md#security) section.
A fresh `supabase init` project doesn't expose new tables by default, so
without an explicit `GRANT` every request fails with `permission denied for
table` before RLS ever runs. [The initial schema migration](supabase/migrations/20260823173715_initial_schema.sql)
grants `select, insert, update, delete` on `profiles`/`posts` to
`authenticated` for that reason.
