---
"@pg-access/postgres": minor
"@pg-access/cli": minor
---

`pg-access generate` no longer needs a database to emit only what changed. It keeps `pgaccess.snapshot.json` next to the config and diffs against it (`planSnapshotChanges()`), writing no migration when nothing changed; `--database-url` still diffs against the live database, and also updates the snapshot. With no snapshot yet it re-emits every policy as before. New `pg-access baseline` records the snapshot from a live database that matches the config.
