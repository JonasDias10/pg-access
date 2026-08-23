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
naming convention). Pass `--database-url` (or set `DATABASE_URL`) and it
also drops any pg-access-managed policy that's applied to that database but
no longer in the config - still just written into the migration file, not
executed against the database itself.

`check` connects to a live database and compares it against the config:
policies the config declares that aren't applied yet show up as
**missing**, and pg-access-managed policies (named `<table>_<operation>`)
that are applied but no longer in the config show up as **orphaned**. It's
read-only - it never touches the database - and exits non-zero when there's
drift, so it's usable as a CI gate. Fixing "missing" means running
`generate` and applying the result; fixing "orphaned" means running
`generate --database-url <url>` and applying that result too.

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
  --database-url <url>  Database to compare against (required for check;
                         optional for generate, to also drop policies no
                         longer in the config. Default: the DATABASE_URL
                         environment variable)
```

The CLI is a thin wrapper: `init` just writes a template file, `generate`
locates and loads your config then calls `generateMigration()` (and, with
`--database-url`, `listManagedPolicies()`) from `@pg-access/postgres` and
writes the result, and `check` locates and loads your config then calls
`listManagedPolicies()` and `diffPolicies()` against a real connection. No
compiler or diffing logic lives here, see that package for how the SQL and
the diff are actually produced.

Orphan detection (both `check` and `generate --database-url`) only ever
covers tables still declared in the config; a table removed from the
config entirely isn't visible to it yet (see `diffPolicies()`'s own docs in
`@pg-access/postgres` for why). Full `ALTER POLICY`-based diffing (rather
than always drop+recreate) is also still ahead; see the open issues on
GitHub.
