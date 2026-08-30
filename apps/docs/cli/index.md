# CLI

`@pg-access/cli` is a thin wrapper around `@pg-access/postgres`; no
compiler or diffing logic lives in it.

::: code-group

```bash [pnpm]
pnpm add -D @pg-access/cli
```

```bash [npm]
npm install -D @pg-access/cli
```

```bash [yarn]
yarn add -D @pg-access/cli
```

:::

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

Without `--database-url` it has nothing to diff against, so it re-emits
every policy as `drop policy if exists` + `create policy`. Pass
`--database-url` (or set `DATABASE_URL`) and it diffs against that live
database: an unchanged policy is left out, a drifted one becomes an `ALTER
POLICY`, and a removed one becomes a `DROP`. If nothing has drifted, no
migration file is written. Nothing is executed against the database
directly; the diff opens one always-rolled-back transaction so PostgreSQL
can normalize the config's policies for a reliable comparison, which needs
a role allowed to create policies on the target tables.

```bash
npx pg-access generate --database-url postgres://...
```

## `check`

Connects to a live database and compares it against the config. Net
read-only; it only opens the same rolled-back normalization transaction
`generate --database-url` does, and exits non-zero when there's drift, so
it's usable as a CI gate.

```bash
npx pg-access check --database-url postgres://...
```

- **missing** - the config declares it, nothing applied it yet.
- **changed** - it's applied, but its compiled `USING` / `WITH CHECK` /
  `TO` no longer matches the config.
- **orphaned** - it's applied and pg-access-managed (named
  `<table>_<operation>`), no longer declared.

Fix any of them by running `generate --database-url` and applying the
migration. Drift detection (both `check` and `generate --database-url`)
only covers tables still declared in the config; a table removed from the
config entirely isn't visible to it yet.

## Options

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
