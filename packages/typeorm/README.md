# @pg-access/typeorm

[![npm](https://img.shields.io/npm/v/@pg-access/typeorm)](https://www.npmjs.com/package/@pg-access/typeorm)
[![license](https://img.shields.io/npm/l/@pg-access/typeorm)](https://github.com/JonasDias10/pg-access/blob/main/LICENSE)

Writes pg-access Row-Level Security policies as a
[TypeORM](https://typeorm.io) migration class, so they ship through
`typeorm migration:run` and come back out with `migration:revert`.

Most projects don't need to import it: the CLI uses it for
`pg-access generate --format typeorm`.

```bash
npx pg-access generate --format typeorm --database-url postgres://...
```

writes `src/migrations/<timestamp>-PgAccess.ts`:

```ts
import type { MigrationInterface, QueryRunner } from "typeorm";

export class PgAccess1790515916393 implements MigrationInterface {
  name = "PgAccess1790515916393";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table "notes" enable row level security;`);
    await queryRunner.query(`create policy "notes_select" ...`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop policy if exists "notes_select" on "notes";`);
    await queryRunner.query(`alter table "notes" disable row level security;`);
  }
}
```

## `down()`

- **With a database** (`--database-url`, or `planPolicyChanges()`): `down()`
  undoes exactly what `up()` did. Created policies are dropped, altered ones
  are altered back and dropped ones are recreated, each from its definition in
  `pg_policies`, and RLS is turned back off on tables that had it off.
- **Without one** (`compile()`): `up()` re-creates every policy, and `down()`
  can only drop them again; it can't restore a previous version it never saw.
  RLS stays on, so a table left with no policies denies everything rather
  than allowing it.

## API

```ts
import { generateTypeOrmMigration, toTypeOrmMigration } from "@pg-access/typeorm";
import { planPolicyChanges } from "@pg-access/postgres";

// From the config alone:
const { fileName, source } = generateTypeOrmMigration(auth);

// Against a live database (a single pg session, not a Pool):
const plan = await planPolicyChanges(client, auth);
const migration = toTypeOrmMigration({ up: plan.statements, down: plan.down.statements });
```

Both take `{ name?: string; now?: Date }`: `name` is the class and file name
prefix (default `PgAccess`); the class name always ends in the 13-digit
millisecond timestamp TypeORM orders migrations by.

See [examples/typeorm](https://github.com/JonasDias10/pg-access/tree/main/examples/typeorm)
for a full project.
