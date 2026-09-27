# pg-access + TypeORM example

A `notes` table managed by TypeORM, with its Row-Level Security policies
declared in [pgaccess.config.ts](pgaccess.config.ts) and shipped as an
ordinary TypeORM migration, so `migration:run` applies them and
`migration:revert` takes them back out.

```text
pgaccess.config.ts (DSL)
   -> pg-access generate --format typeorm   (@pg-access/cli)
   -> src/migrations/<timestamp>-PgAccess.ts (up() + down())
   -> typeorm migration:run                  (applies it with the rest)
   -> asUser(dataSource, user, fn)           (RLS filters repository calls)
```

## Layout

- [`src/entities/note.ts`](src/entities/note.ts): the `Note` entity.
- [`src/data-source.ts`](src/data-source.ts): the `DataSource`, also the
  default export the TypeORM CLI loads.
- [`src/migrations/`](src/migrations), applied in this order:
  - [`AuthSchema`](src/migrations/1790500000000-AuthSchema.ts), written by
    hand: creates the `authenticated` role and the `auth.uid()` /
    `auth.jwt()` functions pg-access's default dialect compiles to. Supabase
    ships these; a plain PostgreSQL database needs them once.
  - [`CreateNotes`](src/migrations/1790515875077-CreateNotes.ts), from
    `typeorm migration:generate`.
  - [`PgAccess`](src/migrations/1790515916393-PgAccess.ts), from
    `pg-access generate --format typeorm`. Its `down()` drops the policies
    and turns RLS back off, since the table had it off before.
- [`src/as-user.ts`](src/as-user.ts): runs a callback in a transaction as a
  given user (`set local role authenticated` plus the JWT claims
  `auth.uid()` reads), which is what makes the policies apply to TypeORM
  queries.
- [`src/demo.ts`](src/demo.ts): two users and an admin reading and writing
  notes through repositories.
- [`pgaccess.snapshot.json`](pgaccess.snapshot.json): written by
  `pg-access generate`, what it diffs the next change against.
- [`test/integration/`](test/integration): runs the migrations through
  TypeORM, checks each user sees only what the config allows, that
  `pg-access check` finds no drift, that the snapshot matches the config,
  and that every migration reverts.

## Run it

Needs Docker. From the repo root:

```bash
pnpm install
pnpm build
docker compose -f docker-compose.test.yml up -d
```

Then from `examples/typeorm`:

```bash
pnpm migration:run   # AuthSchema, CreateNotes, PgAccess
pnpm demo
```

```text
bob sees:   [ "bob's note" ]
admin sees: [ "alice's note", "bob's note" ]
bob writing as alice: new row violates row-level security policy for table "notes"
```

Every script targets `DATABASE_URL`, or the docker compose database when it
isn't set.

## Changing the policies

Edit `pgaccess.config.ts`, then:

```bash
pnpm generate      # a new PgAccess migration with only what changed
pnpm migration:run
```

`generate` needs no database: it diffs the config against
[pgaccess.snapshot.json](pgaccess.snapshot.json), the policies of the last
migration it wrote, and updates it. The new migration's `up()` holds only
`ALTER POLICY` / `CREATE POLICY` / `DROP POLICY` for what changed, and its
`down()` puts back each policy as the snapshot had it.

With the database running, `pnpm check` reports whether it really matches
the config, and `pnpm generate:db` diffs against it instead of the
snapshot, which also catches changes made outside migrations. Its `down()`
restores each policy from `pg_policies`, and turns RLS back off on tables
that had it off. If the snapshot is ever out of step with a database that
does match the config (a merge conflict on it, say), `pnpm baseline`
rewrites it.

## Using this in your own project

- Your app's login role must be allowed to switch to `authenticated`
  (`grant authenticated to app_user`). Queries outside `asUser()` run as
  that login role: RLS never applies to a superuser, and applies to the
  tables' owner only with `force row level security`.
- `typeorm migration:generate` imports `MigrationInterface` and
  `QueryRunner` as values, which fails at runtime in an ESM project because
  both are types only. `CreateNotes` here was switched to `import type`;
  pg-access's own migrations already use it.
- `tsx` and Vitest compile with esbuild, which doesn't emit decorator
  metadata, so every `@Column` names its type explicitly.
