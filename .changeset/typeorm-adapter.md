---
"@pg-access/typeorm": minor
"@pg-access/postgres": minor
"@pg-access/cli": minor
---

Add `@pg-access/typeorm` and `pg-access generate --format typeorm`, which write the policies as a TypeORM migration class. `compile()` and `planPolicyChanges()` now also return a `down` that undoes their statements: against a live database it restores altered and dropped policies from `pg_policies` and turns RLS back off where it was off before.
