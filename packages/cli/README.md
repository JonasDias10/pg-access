# @pg-access/cli

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

`check` connects to a live database and compares it against the config:
policies the config declares that aren't applied yet show up as
**missing**, and pg-access-managed policies (named `<table>_<operation>`)
that are applied but no longer in the config show up as **orphaned**. It's
read-only - it never touches the database - and exits non-zero when there's
drift, so it's usable as a CI gate. Fixing "missing" means running
`generate` and applying the result; fixing "orphaned" is printed as a
ready-to-run `drop policy ...` statement, deliberately left for you to run
by hand rather than auto-applied.

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
pg-access generate [--config <path>] [--out <dir>]
pg-access check [--config <path>] [--database-url <url>]

  --config <path>       Path to the pgaccess config file (default:
                         auto-detected, or pgaccess.config.ts for init)
  --out <dir>            Directory to write the migration into (generate
                         only, default: supabase/migrations)
  --database-url <url>  Database to check against (check only, default:
                         the DATABASE_URL environment variable)
```

The CLI is a thin wrapper: `init` just writes a template file, `generate`
locates and loads your config then calls `generateMigration()` from
`@pg-access/postgres` and writes the result, and `check` locates and loads
your config then calls `listManagedPolicies()` and `diffPolicies()` from
`@pg-access/postgres` against a real connection. No compiler or diffing
logic lives here, see that package for how the SQL and the diff are
actually produced.

`check` only ever detects orphaned policies within tables still declared in
the config; a table removed from the config entirely isn't visible to it
yet (see `diffPolicies()`'s own docs in `@pg-access/postgres` for why).
Full `ALTER POLICY`-based diffing (rather than always drop+recreate) is
also still ahead; see the root README's roadmap.
