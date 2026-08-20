# @pg-access/testing (planned, v0.6)

Helpers for asserting RLS behavior against a real PostgreSQL instance from
consumers' own test suites (spin up a scratch schema, run as a given
role/JWT claims, assert row visibility). `@pg-access/postgres`'s own
integration tests (`packages/postgres/test/integration`) are the first,
in-repo version of this pattern; this package will extract it into a
reusable API. See the root README's roadmap.
