# USING vs WITH CHECK

`USING` and `WITH CHECK` are easy to confuse by hand: an `INSERT` policy
that defines `USING` instead of `WITH CHECK` is simply rejected by
Postgres; an `UPDATE` policy that only defines `USING` lets a caller
retarget a row they own to values they shouldn't be able to write.

The compiler places the compiled condition according to Postgres's actual
rules per operation; this is not a detail you can get right by treating
every policy the same:

| Operation | Clause(s)                    | Why                                                                                                  |
| --------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `select`  | `USING`                      | filters existing rows; there's no new row to check.                                                  |
| `insert`  | `WITH CHECK`                 | there's no existing row to filter with; Postgres rejects a `USING` clause on an INSERT policy.       |
| `update`  | `USING` **and** `WITH CHECK` | `USING` picks which existing rows may be targeted, `WITH CHECK` validates the row _after_ the write. |
| `delete`  | `USING`                      | filters which existing rows may be deleted.                                                          |

For `update`, both clauses currently receive the _same_ compiled
expression; the DSL accepts one expression per operation, so expressing
"read with X, write with Y" for the same operation is future work, not
something you can misconfigure today.

```ts
defineAuth({
  projects: {
    rows: {
      update: owner("user_id"),
    },
  },
});
```

compiles to:

```sql
create policy "projects_update"
on "projects"
for update
to "authenticated"
using (
  "user_id" = (select auth.uid())
)
with check (
  "user_id" = (select auth.uid())
);
```

This is covered by dedicated tests in
[`packages/postgres/test/unit/policies.test.ts`](https://github.com/JonasDias10/pg-access/blob/main/packages/postgres/test/unit/policies.test.ts),
and exercised end-to-end, including the actual Postgres rejection error
for a misplaced clause, in
[`packages/postgres/test/integration/rls.integration.test.ts`](https://github.com/JonasDias10/pg-access/blob/main/packages/postgres/test/integration/rls.integration.test.ts).
