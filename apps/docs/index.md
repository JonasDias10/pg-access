---
layout: home

hero:
  name: pg-access
  text: Type-safe PostgreSQL Row-Level Security
  tagline: A declarative TypeScript DSL that compiles to real SQL. No runtime layer, no query interception; PostgreSQL enforces it.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/JonasDias10/pg-access

features:
  - title: Real SQL, not a runtime
    details: pg-access does not intercept your queries or check permissions in your application process. It generates the exact ALTER TABLE / CREATE POLICY statements PostgreSQL itself enforces, for every client, every query, forever.
  - title: Postgres-correct by construction
    details: The compiler places USING / WITH CHECK per operation according to Postgres's actual rules, and wraps auth.uid() as (select auth.uid()) so it's evaluated once per statement, not once per row.
  - title: One typed place for the rules
    details: "Table access rules live in ordinary, type-checked TypeScript; defineAuth() validates the config immediately (empty column/role names, malformed compositions) instead of silently producing broken SQL."
---
