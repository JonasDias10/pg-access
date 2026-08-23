# Security Policy

pg-access generates the SQL that controls row- and (in the future)
column-level access to your PostgreSQL data. A bug in this compiler is a
security bug for every project that runs its output; please report it
privately, not as a public GitHub issue.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:
**Security → Report a vulnerability** on the repo's GitHub page. This opens
a private advisory visible only to maintainers until a fix is ready.

If you can't use that (e.g. the report is very sensitive or you want a
non-GitHub channel), open a regular issue asking for an alternative contact
method, without describing the vulnerability itself there.

Please include:

- The `defineAuth` config (or a minimal reproduction) that produces the
  incorrect SQL.
- What SQL pg-access generated, and what it should have generated instead.
- Why the difference is a security issue (e.g. "row X becomes readable by
  role Y, who shouldn't have access").

## Scope

In scope: `@pg-access/core` and `@pg-access/postgres` producing SQL that
grants broader access than the DSL describes, or that fails to enforce a
declared row/column policy correctly. This includes subtle cases like
NULL-handling in `USING`/`WITH CHECK` (see the `not()` NULL-safety fix in
`packages/postgres/src/compiler/expressions.ts` for the kind of issue this
covers) and identifier/literal escaping.

Out of scope: vulnerabilities in PostgreSQL itself, in Supabase's platform,
or in your own `defineAuth` configuration being an inaccurate model of your
actual authorization requirements (that's a design decision, not a bug in
this library); we're still glad to hear about confusing DSL behavior that
made such a mistake easy to make.

## Response

This is a young, unfunded open-source project maintained on a best-effort
basis; there's no SLA. Confirmed vulnerabilities are prioritized above
all other open work, and a fix, an advisory, and a new release are the
goal before any public disclosure.
