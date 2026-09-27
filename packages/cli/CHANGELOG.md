# @pg-access/cli

## 0.2.0

### Minor Changes

- be256f0: `pg-access generate` no longer needs a database to emit only what changed. It keeps `pgaccess.snapshot.json` next to the config and diffs against it (`planSnapshotChanges()`), writing no migration when nothing changed; `--database-url` still diffs against the live database, and also updates the snapshot. With no snapshot yet it re-emits every policy as before. New `pg-access baseline` records the snapshot from a live database that matches the config.
- be256f0: Add `@pg-access/typeorm` and `pg-access generate --format typeorm`, which write the policies as a TypeORM migration class. `compile()` and `planPolicyChanges()` now also return a `down` that undoes their statements: against a live database it restores altered and dropped policies from `pg_policies` and turns RLS back off where it was off before.

### Patch Changes

- Updated dependencies [be256f0]
- Updated dependencies [be256f0]
  - @pg-access/postgres@0.2.0
  - @pg-access/typeorm@0.1.0
