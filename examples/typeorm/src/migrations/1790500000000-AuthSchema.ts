import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * pg-access's default dialect compiles `owner()` / `role()` to Supabase's
 * `auth.uid()` / `auth.jwt()` and grants policies to an `authenticated`
 * role. Supabase ships those; a plain PostgreSQL database needs them created
 * once, which is all this hand-written migration does. `auth.jwt()` reads
 * the claims `asUser()` sets per transaction, the same convention
 * PostgREST uses.
 */
export class AuthSchema1790500000000 implements MigrationInterface {
  name = "AuthSchema1790500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      do $$
      begin
        if not exists (select from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin noinherit;
        end if;
      end
      $$;
    `);
    await queryRunner.query(`create schema if not exists auth`);
    await queryRunner.query(`
      create or replace function auth.jwt() returns jsonb
      language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $$
    `);
    await queryRunner.query(`
      create or replace function auth.uid() returns uuid
      language sql stable as $$
        select nullif(auth.jwt() ->> 'sub', '')::uuid
      $$
    `);
    await queryRunner.query(`grant usage on schema auth to authenticated`);
    await queryRunner.query(`grant usage on schema public to authenticated`);
    await queryRunner.query(
      `alter default privileges in schema public grant select, insert, update, delete on tables to authenticated`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The role is cluster-wide and may be used by other databases, so it stays.
    await queryRunner.query(
      `alter default privileges in schema public revoke select, insert, update, delete on tables from authenticated`,
    );
    await queryRunner.query(`revoke usage on schema public from authenticated`);
    await queryRunner.query(`drop function auth.uid()`);
    await queryRunner.query(`drop function auth.jwt()`);
    await queryRunner.query(`drop schema auth`);
  }
}
