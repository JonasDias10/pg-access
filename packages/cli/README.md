# @pg-access/cli

[![npm](https://img.shields.io/npm/v/@pg-access/cli)](https://www.npmjs.com/package/@pg-access/cli)
[![downloads](https://img.shields.io/npm/dm/@pg-access/cli)](https://www.npmjs.com/package/@pg-access/cli)
[![license](https://img.shields.io/npm/l/@pg-access/cli)](https://github.com/JonasDias10/pg-access/blob/main/LICENSE)

Command-line interface for pg-access. Removes the boilerplate from
`examples/basic/src/generate.ts`: point it at a config file, get a
migration written to disk.

## Usage

```bash
npx @pg-access/cli init
npx @pg-access/cli generate
npx @pg-access/cli check --database-url postgres://...
```

`init` scaffolds a starter `pgaccess.config.ts` in the current directory.
It refuses to overwrite one that already exists.

`generate` looks for `pgaccess.config.ts` (or `.mts` / `.js` / `.mjs` /
`.cjs`) in the current directory, expects it to default-export the result
of `defineAuth(...)` from `@pg-access/core`, and writes a timestamped
migration into `supabase/migrations/` (matching the Supabase CLI's own
naming convention).

Without `--database-url` it has nothing to diff against, so it re-emits
every policy as `drop policy if exists` + `create policy`. Pass
`--database-url` (or set `DATABASE_URL`) and it diffs against that live
database instead: an unchanged policy is left out entirely, a policy whose
compiled `USING` / `WITH CHECK` / `TO` drifted becomes an `ALTER POLICY`,
and a policy removed from the config becomes a `DROP`. If nothing has
drifted, no migration file is written at all. Nothing is ever executed
against the database directly; the diff just opens one transaction (always
rolled back) so PostgreSQL can normalize the config's policies for a
reliable comparison, which needs a role allowed to create policies on the
target tables.

`check` connects to a live database and compares it against the config,
reporting **missing** (declared, not applied yet), **changed** (applied,
but the config no longer matches), and **orphaned** (applied and
pg-access-managed, no longer declared). Net read-only - it only opens the
same rolled-back normalization transaction `generate --database-url` does -
and exits non-zero when there's drift, so it's usable as a CI gate. Fix any
category by running `generate --database-url <url>` and applying the
migration.

```ts
// pgaccess.config.ts
import { and, authenticated, defineAuth, owner } from "@pg-access/core";

export default defineAuth({
  projects: {
    rows: {
      select: owner("user_id"),
      insert: and(authenticated(), owner("user_id")),
      update: owner("user_id"),
      delete: owner("user_id"),
    },
  },
});
```

### Options

```text
pg-access init [--config <path>]
pg-access generate [--config <path>] [--out <dir>] [--database-url <url>]
pg-access check [--config <path>] [--database-url <url>]

  --config <path>       Path to the pgaccess config file (default:
                         auto-detected, or pgaccess.config.ts for init)
  --out <dir>            Directory to write the migration into (generate
                         only, default: supabase/migrations)
  --database-url <url>  Database to diff against (required for check;
                         optional for generate, to emit only what drifted.
                         Default: the DATABASE_URL environment variable)
```

The CLI is a thin wrapper: `init` just writes a template file, `generate`
locates and loads your config then calls `generateMigration()` (or, with
`--database-url`, `planPolicyChanges()`) from `@pg-access/postgres` and
writes the result, and `check` locates and loads your config then calls
`planPolicyChanges()` against a real connection. No compiler or diffing
logic lives here, see that package for how the SQL and the diff are
actually produced.

Drift detection (both `check` and `generate --database-url`) only ever
covers tables still declared in the config; a table removed from the config
entirely isn't visible to it yet (see `diffPolicies()`'s own docs in
`@pg-access/postgres` for why).
