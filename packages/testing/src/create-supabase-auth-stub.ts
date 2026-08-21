import type { Pool } from "pg";

/**
 * Minimal stand-in for Supabase's real `auth.uid()` / `auth.jwt()`
 * functions. Supabase's PostgREST layer decodes the request's JWT and
 * exposes its claims to Postgres via the `request.jwt.claims` session
 * setting; `auth.uid()` / `auth.jwt()` just read that setting back out.
 * These definitions mirror the real ones, so `owner()`/`authenticated()`
 * policies compiled by `@pg-access/postgres`'s default dialect behave
 * identically against a plain, non-Supabase PostgreSQL test database.
 *
 * Only needed when testing against a database that isn't already Supabase
 * (which ships the real functions) - and only needed once per database,
 * not per test.
 */
const AUTH_SCHEMA_SQL = `
  create schema if not exists auth;

  create or replace function auth.jwt() returns jsonb
  language sql stable
  as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;

  create or replace function auth.uid() returns uuid
  language sql stable
  as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
`;

export async function createSupabaseAuthStub(pool: Pool): Promise<void> {
  await pool.query(AUTH_SCHEMA_SQL);
}
