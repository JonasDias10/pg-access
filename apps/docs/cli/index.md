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

It only emits what changed: an unchanged policy is left out, a changed one
becomes an `ALTER POLICY`, a new one a `CREATE POLICY` and a removed one a
`DROP`. If nothing changed, no migration file is written. What it diffs
against:

- **The snapshot** (the default). `generate` keeps `pgaccess.snapshot.json`
  next to the config, recording the policies of the last migration it
  wrote, and diffs the config against it. No database needed, so it works
  offline and in CI. Commit the snapshot with the migration.
- **A live database**, with `--database-url` (or `DATABASE_URL`). The
  authoritative diff: it sees what's really applied, including changes made
  by hand. Nothing is executed against the database directly; the diff
  opens one always-rolled-back transaction so PostgreSQL can normalize the
  config's policies for a reliable comparison, which needs a role allowed
  to create policies on the target tables. It updates the snapshot too.
- **Nothing**, the first time, when there's no snapshot yet: every policy
  is re-emitted as `drop policy if exists` + `create policy`, which applies
  cleanly whatever the database already has, and the snapshot is created.

```bash
npx pg-access generate
npx pg-access generate --database-url postgres://...
```

### The snapshot

The snapshot is a claim about the database, not the database: it can't
see a policy changed by hand, a migration that was never applied, or one
edited after it was generated. That's what `check` against a live database
is for. Two differences in what an offline diff emits follow from that:
every `CREATE POLICY` is preceded by `drop policy if exists`, so a policy
that exists anyway doesn't fail the migration, and a TypeORM `down()` never
turns RLS back off, since the snapshot doesn't know it was off before.

The file is deterministic JSON (sorted, stable field order, formatted the
way Prettier would), so it only changes when the policies do. If two
branches both run `generate`, the snapshot conflicts on merge; that's the
signal. Resolve it by taking either side and running `generate` again
(the guarded creates make re-emitting the other branch's changes
harmless), or, once both migrations are applied somewhere, with `baseline`.

### TypeORM

`--format typeorm` writes a TypeORM migration class instead
(`src/migrations/<timestamp>-PgAccess.ts` by default), for
`typeorm migration:run` / `migration:revert`. Its `down()` drops what `up()`
created; with `--database-url` it also alters changed policies back,
recreates dropped ones, and turns RLS back off where it was off, so a revert
restores the database exactly. See
[examples/typeorm](https://github.com/JonasDias10/pg-access/tree/main/examples/typeorm).

```bash
npx pg-access generate --format typeorm --database-url postgres://...
```

## `baseline`

Records the snapshot from a live database, for a project whose database
already has its policies (adopting snapshots) or whose snapshot no longer
matches it. It first checks the database matches the config exactly, the
same comparison `check` makes, and writes nothing when it doesn't:

```bash
npx pg-access baseline --database-url postgres://...
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
pg-access generate [--config <path>] [--out <dir>] [--format <sql|typeorm>]
                   [--database-url <url>] [--snapshot <path>]
pg-access check [--config <path>] [--database-url <url>]
pg-access baseline [--config <path>] [--database-url <url>] [--snapshot <path>]

  --config <path>       Path to the pgaccess config file (default:
                         auto-detected, or pgaccess.config.ts for init)
  --out <dir>            Directory to write the migration into (generate
                         only, default: supabase/migrations, or
                         src/migrations for --format typeorm)
  --format <format>      Migration file to write (generate only): sql
                         (default) or typeorm, a class with up() and down()
  --database-url <url>  Database to diff against (required for check and
                         baseline; optional for generate, which otherwise
                         diffs against the snapshot. Default: the
                         DATABASE_URL environment variable)
  --snapshot <path>      Snapshot file (generate and baseline only,
                         default: pgaccess.snapshot.json next to the config)
```
