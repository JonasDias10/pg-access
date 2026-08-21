# CLI

`@pg-access/cli` is a thin wrapper around `@pg-access/postgres`; no
compiler or diffing logic lives in it.

```bash
pnpm add -D @pg-access/cli
```

## `init`

Scaffolds a starter `pgaccess.config.ts` in the current directory. It
refuses to overwrite one that already exists.

```bash
npx pg-access init
```

## `generate`

Locates `pgaccess.config.ts` (or `.mts` / `.js` / `.mjs` / `.cjs`), expects
it to default-export the result of `defineAuth(...)`, and writes a
timestamped migration into `supabase/migrations/` (matching the Supabase
CLI's own naming convention).

```bash
npx pg-access generate
```

Pass `--database-url` (or set `DATABASE_URL`) and it also drops any
pg-access-managed policy that's applied to that database but no longer in
the config; still just written into the migration file, never executed
against the database directly.

```bash
npx pg-access generate --database-url postgres://...
```

## `check`

Connects to a live database and compares it against the config. Read-only;
it never touches the database, and exits non-zero when there's drift, so
it's usable as a CI gate.

```bash
npx pg-access check --database-url postgres://...
```

- Policies the config declares that aren't applied yet show up as
  **missing**; fix by running `generate` and applying the result.
- pg-access-managed policies (named `<table>_<operation>`) that are
  applied but no longer in the config show up as **orphaned**; fix by
  running `generate --database-url` and applying that result.

Orphan detection (both `check` and `generate --database-url`) only covers
tables still declared in the config; a table removed from the config
entirely isn't visible to it yet.

## Options

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
