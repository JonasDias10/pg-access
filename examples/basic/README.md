# pg-access basic example

Shows the full pipeline without needing the (not yet built) CLI:

```text
src/auth.ts (DSL)
   -> defineAuth()  (AST)
   -> compile()     (@pg-access/postgres)
   -> generateMigration()
   -> migrations/<timestamp>_pg_access.sql
```

## Run it

From the repo root:

```bash
pnpm install
pnpm --filter @pg-access/example-basic generate
```

This writes a runnable SQL migration to `migrations/` and prints it to stdout.
Apply it to any PostgreSQL database (Supabase or otherwise) with `psql` or
your migration tool of choice.
