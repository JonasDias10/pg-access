import { randomUUID } from "node:crypto";
import {
  and,
  authenticated,
  defineAuth,
  not,
  or,
  owner,
  publicAccess,
  role,
} from "@pg-access/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../../src/compiler/compiler.js";

/**
 * Exercises the compiled SQL against a real PostgreSQL server, not just
 * string assertions. This is what actually proves the generated policies
 * enforce access control, since RLS semantics (USING vs WITH CHECK, role
 * scoping, NULL comparisons) are easy to get subtly wrong in a way that
 * still "looks right" as a SQL string.
 *
 * Requires a database reachable at PG_ACCESS_TEST_DATABASE_URL (defaults to
 * the docker-compose.test.yml service). Start it with:
 *   docker compose -f docker-compose.test.yml up -d
 */

const connectionString =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

// The compiled policies grant access `to "authenticated"` (or `to public`
// for publicAccess()), matching real Supabase's built-in roles of those
// names. A vanilla PostgreSQL instance doesn't have them, so the test
// creates them itself, mirroring how Supabase's own bootstrap defines them
// (nologin, noinherit).
const APP_ROLE = "authenticated";
const ANON_ROLE = "anon";

/**
 * Minimal stand-in for Supabase's real `auth.uid()` / `auth.jwt()`
 * functions. Supabase's PostgREST layer decodes the request's JWT and
 * exposes its claims to Postgres via the `request.jwt.claims` session
 * setting; `auth.uid()` / `auth.jwt()` just read that setting back out.
 * These definitions mirror the real ones so the compiled `owner()` SQL
 * behaves identically to how it would under actual Supabase. The test
 * simulates "sending a JWT" with `set local request.jwt.claims`.
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

function asJwt(claims: Record<string, unknown>): string {
  return JSON.stringify(claims);
}

describe("compiled RLS policies against real PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString });
  const admin = { user_id: randomUUID() };
  const other = { user_id: randomUUID() };

  beforeAll(async () => {
    try {
      await pool.query("select 1");
    } catch (error) {
      throw new Error(
        `Could not reach the test database at ${connectionString}. ` +
          "Start it with: docker compose -f docker-compose.test.yml up -d",
        { cause: error },
      );
    }

    await pool.query(AUTH_SCHEMA_SQL);

    await pool.query('drop table if exists "projects" cascade;');
    await pool.query(`
      create table "projects" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        name text not null
      );
    `);

    await pool.query('drop table if exists "documents" cascade;');
    await pool.query(`
      create table "documents" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        title text not null
      );
    `);

    await pool.query('drop table if exists "announcements" cascade;');
    await pool.query(`
      create table "announcements" (
        id uuid primary key default gen_random_uuid(),
        title text not null
      );
    `);

    // Must exist before compile()'s output runs, since the generated
    // policies reference them in their `to "authenticated"` / `to public`
    // clauses.
    await pool.query(`drop role if exists ${APP_ROLE};`);
    await pool.query(`create role ${APP_ROLE} nologin noinherit;`);
    await pool.query(`drop role if exists ${ANON_ROLE};`);
    await pool.query(`create role ${ANON_ROLE} nologin noinherit;`);

    const auth = defineAuth({
      projects: {
        rows: {
          select: owner("user_id"),
          insert: owner("user_id"),
          update: owner("user_id"),
          delete: owner("user_id"),
        },
      },
      // Exercises and()/or()/not()/role()/authenticated() composed
      // together against a real server, not just as SQL-string assertions.
      documents: {
        rows: {
          select: or(role("admin"), owner("user_id")),
          insert: and(authenticated(), owner("user_id")),
          update: or(owner("user_id"), role("admin")),
          delete: and(owner("user_id"), not(role("banned"))),
        },
      },
      // Exercises publicAccess() reaching a role that was never granted
      // `authenticated` membership at all, proving `to public` really means
      // "everyone", including a bare "anon"-style role.
      announcements: {
        rows: {
          select: publicAccess(),
        },
      },
    });
    const { sql } = compile(auth);
    await pool.query(sql);

    await pool.query(`grant usage on schema public, auth to ${APP_ROLE}, ${ANON_ROLE};`);
    await pool.query(`grant select, insert, update, delete on "projects" to ${APP_ROLE};`);
    await pool.query(`grant select, insert, update, delete on "documents" to ${APP_ROLE};`);
    await pool.query(`grant select on "announcements" to ${APP_ROLE}, ${ANON_ROLE};`);
    await pool.query(`grant execute on function auth.uid() to ${APP_ROLE}, ${ANON_ROLE};`);
    await pool.query(`grant execute on function auth.jwt() to ${APP_ROLE}, ${ANON_ROLE};`);

    await pool.query('insert into "projects" (user_id, name) values ($1, $2), ($3, $4);', [
      admin.user_id,
      "admin's project",
      other.user_id,
      "other's project",
    ]);

    await pool.query('insert into "documents" (user_id, title) values ($1, $2), ($3, $4);', [
      admin.user_id,
      "admin's document",
      other.user_id,
      "other's document",
    ]);

    await pool.query('insert into "announcements" (title) values ($1);', ["welcome"]);
  });

  afterAll(async () => {
    await pool.query('drop table if exists "projects" cascade;');
    await pool.query('drop table if exists "documents" cascade;');
    await pool.query('drop table if exists "announcements" cascade;');
    // DROP ROLE fails while grants to it still exist elsewhere (e.g. on the
    // auth.* functions); DROP OWNED revokes those first.
    await pool.query(`drop owned by ${APP_ROLE};`);
    await pool.query(`drop role if exists ${APP_ROLE};`);
    await pool.query(`drop owned by ${ANON_ROLE};`);
    await pool.query(`drop role if exists ${ANON_ROLE};`);
    await pool.query("drop schema if exists auth cascade;");
    await pool.end();
  });

  /** Runs `run` inside a rolled-back transaction, as `postgresRole` with the given JWT claims (or none, for an unauthenticated request). */
  async function asUser<T>(
    claims: Record<string, unknown> | null,
    run: (client: pg.PoolClient) => Promise<T>,
    postgresRole: string = APP_ROLE,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${postgresRole};`);
      if (claims) {
        await client.query("select set_config('request.jwt.claims', $1, true);", [asJwt(claims)]);
      }
      return await run(client);
    } finally {
      await client.query("rollback");
      client.release();
    }
  }

  it("SELECT only returns rows owned by the current user", async () => {
    const rows = await asUser({ sub: admin.user_id }, async (client) => {
      const result = await client.query('select name from "projects" order by name;');
      return result.rows;
    });

    expect(rows).toEqual([{ name: "admin's project" }]);
  });

  it("a different user sees only their own row", async () => {
    const rows = await asUser({ sub: other.user_id }, async (client) => {
      const result = await client.query('select name from "projects" order by name;');
      return result.rows;
    });

    expect(rows).toEqual([{ name: "other's project" }]);
  });

  it("an unauthenticated request (no JWT) sees no rows", async () => {
    const rows = await asUser(null, async (client) => {
      const result = await client.query('select name from "projects";');
      return result.rows;
    });

    expect(rows).toEqual([]);
  });

  it("INSERT is rejected by WITH CHECK when user_id doesn't match the caller", async () => {
    await expect(
      asUser({ sub: admin.user_id }, (client) =>
        client.query('insert into "projects" (user_id, name) values ($1, $2);', [
          other.user_id,
          "spoofed project",
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("INSERT succeeds by WITH CHECK when user_id matches the caller", async () => {
    const rows = await asUser({ sub: admin.user_id }, async (client) => {
      await client.query('insert into "projects" (user_id, name) values ($1, $2);', [
        admin.user_id,
        "admin's second project",
      ]);
      const result = await client.query('select name from "projects" where name = $1;', [
        "admin's second project",
      ]);
      return result.rows;
    });

    expect(rows).toEqual([{ name: "admin's second project" }]);
  });

  it("UPDATE is silently filtered by USING for rows the caller doesn't own", async () => {
    const rowCount = await asUser({ sub: admin.user_id }, async (client) => {
      const result = await client.query('update "projects" set name = $1 where user_id = $2;', [
        "hijacked",
        other.user_id,
      ]);
      return result.rowCount;
    });

    expect(rowCount).toBe(0);
  });

  it("UPDATE succeeds for rows the caller owns", async () => {
    const name = await asUser({ sub: admin.user_id }, async (client) => {
      await client.query('update "projects" set name = $1 where user_id = $2;', [
        "renamed",
        admin.user_id,
      ]);
      const result = await client.query('select name from "projects" where user_id = $1;', [
        admin.user_id,
      ]);
      return result.rows[0]?.name;
    });

    expect(name).toBe("renamed");
  });

  it("DELETE only affects rows the caller owns", async () => {
    const rowCount = await asUser({ sub: admin.user_id }, async (client) => {
      const result = await client.query('delete from "projects" where user_id = $1;', [
        other.user_id,
      ]);
      return result.rowCount;
    });

    expect(rowCount).toBe(0);
  });

  describe("or(role(), owner()): admin sees every row, a plain owner only their own", () => {
    it("an admin sees every document, not just their own", async () => {
      const rows = await asUser(
        { sub: randomUUID(), app_metadata: { role: "admin" } },
        async (client) => {
          const result = await client.query('select title from "documents" order by title;');
          return result.rows;
        },
      );

      expect(rows).toEqual([{ title: "admin's document" }, { title: "other's document" }]);
    });

    it("a non-admin only sees their own document", async () => {
      const rows = await asUser({ sub: other.user_id }, async (client) => {
        const result = await client.query('select title from "documents";');
        return result.rows;
      });

      expect(rows).toEqual([{ title: "other's document" }]);
    });
  });

  describe("and(authenticated(), owner()) on INSERT", () => {
    it("rejects a spoofed user_id even though the caller is authenticated", async () => {
      await expect(
        asUser({ sub: admin.user_id }, (client) =>
          client.query('insert into "documents" (user_id, title) values ($1, $2);', [
            other.user_id,
            "spoofed document",
          ]),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe("or(owner(), role()) on UPDATE", () => {
    it("an admin can update a document they don't own", async () => {
      const title = await asUser(
        { sub: randomUUID(), app_metadata: { role: "admin" } },
        async (client) => {
          await client.query('update "documents" set title = $1 where user_id = $2;', [
            "edited by admin",
            other.user_id,
          ]);
          const result = await client.query('select title from "documents" where user_id = $1;', [
            other.user_id,
          ]);
          return result.rows[0]?.title;
        },
      );

      expect(title).toBe("edited by admin");
    });

    it("a non-admin cannot update someone else's document", async () => {
      const rowCount = await asUser({ sub: admin.user_id }, async (client) => {
        const result = await client.query('update "documents" set title = $1 where user_id = $2;', [
          "hijacked",
          other.user_id,
        ]);
        return result.rowCount;
      });

      expect(rowCount).toBe(0);
    });
  });

  describe("and(owner(), not(role())) on DELETE", () => {
    it("the owner can delete their own document", async () => {
      const rowCount = await asUser({ sub: admin.user_id }, async (client) => {
        const result = await client.query('delete from "documents" where user_id = $1;', [
          admin.user_id,
        ]);
        return result.rowCount;
      });

      expect(rowCount).toBe(1);
    });

    it("not(role('banned')) blocks a banned owner from deleting their own document", async () => {
      const rowCount = await asUser(
        { sub: other.user_id, app_metadata: { role: "banned" } },
        async (client) => {
          const result = await client.query('delete from "documents" where user_id = $1;', [
            other.user_id,
          ]);
          return result.rowCount;
        },
      );

      expect(rowCount).toBe(0);
    });
  });

  describe("publicAccess()", () => {
    it("a role with no relationship to 'authenticated' at all can still read it", async () => {
      const rows = await asUser(
        null,
        async (client) => {
          const result = await client.query('select title from "announcements";');
          return result.rows;
        },
        ANON_ROLE,
      );

      expect(rows).toEqual([{ title: "welcome" }]);
    });
  });
});

describe("regenerating a migration after changing a policy", () => {
  const pool = new pg.Pool({ connectionString });
  const owner1 = randomUUID();

  beforeAll(async () => {
    await pool.query(AUTH_SCHEMA_SQL);

    await pool.query('drop table if exists "tasks" cascade;');
    await pool.query(`
      create table "tasks" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        title text not null
      );
    `);

    await pool.query(`drop role if exists ${APP_ROLE};`);
    await pool.query(`create role ${APP_ROLE} nologin noinherit;`);

    await pool.query(`grant usage on schema public, auth to ${APP_ROLE};`);
    await pool.query(`grant select on "tasks" to ${APP_ROLE};`);
    await pool.query(`grant execute on function auth.uid() to ${APP_ROLE};`);
    await pool.query(`grant execute on function auth.jwt() to ${APP_ROLE};`);

    await pool.query('insert into "tasks" (user_id, title) values ($1, $2);', [
      owner1,
      "private task",
    ]);
  });

  afterAll(async () => {
    await pool.query('drop table if exists "tasks" cascade;');
    await pool.query(`drop owned by ${APP_ROLE};`);
    await pool.query(`drop role if exists ${APP_ROLE};`);
    await pool.query("drop schema if exists auth cascade;");
    await pool.end();
  });

  async function selectTitlesAs(claims: Record<string, unknown> | null): Promise<string[]> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${APP_ROLE};`);
      if (claims) {
        await client.query("select set_config('request.jwt.claims', $1, true);", [asJwt(claims)]);
      }
      const result = await client.query<{ title: string }>('select title from "tasks";');
      return result.rows.map((row) => row.title);
    } finally {
      await client.query("rollback");
      client.release();
    }
  }

  it("re-applying the first migration (unchanged policy) is a no-op, not an error", async () => {
    const v1 = defineAuth({ tasks: { rows: { select: owner("user_id") } } });
    await pool.query(compile(v1).sql);

    // Same policy, compiled again, applied a second time: the DROP POLICY
    // IF EXISTS must make this safe, since a plain CREATE POLICY would
    // error with "policy already exists" the second time around.
    await expect(pool.query(compile(v1).sql)).resolves.toBeDefined();

    expect(await selectTitlesAs({ sub: owner1 })).toEqual(["private task"]);
  });

  it("applying a regenerated migration with a changed expression takes effect, not errors", async () => {
    const v2 = defineAuth({ tasks: { rows: { select: publicAccess() } } });

    // Same table, same operation, therefore the same deterministic policy
    // name ("tasks_select") as the v1 migration already applied above; this
    // is exactly the collision DROP POLICY IF EXISTS exists to avoid.
    await expect(pool.query(compile(v2).sql)).resolves.toBeDefined();

    // The old owner()-only rule no longer applies: an unrelated caller with
    // no claims at all can now see the row too, proving the policy was
    // actually replaced, not just re-created identically.
    expect(await selectTitlesAs(null)).toEqual(["private task"]);
  });
});

describe("a table named after a PostgreSQL reserved keyword", () => {
  const pool = new pg.Pool({ connectionString });
  const owner1 = randomUUID();

  beforeAll(async () => {
    await pool.query(AUTH_SCHEMA_SQL);

    // "user" is reserved; if identifier quoting were ever wrong, this whole
    // setup would fail with a syntax error before any assertion even runs.
    await pool.query('drop table if exists "user" cascade;');
    await pool.query(`
      create table "user" (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        name text not null
      );
    `);

    await pool.query(`drop role if exists ${APP_ROLE};`);
    await pool.query(`create role ${APP_ROLE} nologin noinherit;`);

    const auth = defineAuth({ user: { rows: { select: owner("user_id") } } });
    const { sql } = compile(auth);
    await pool.query(sql);

    await pool.query(`grant usage on schema public, auth to ${APP_ROLE};`);
    await pool.query(`grant select on "user" to ${APP_ROLE};`);
    await pool.query(`grant execute on function auth.uid() to ${APP_ROLE};`);
    await pool.query(`grant execute on function auth.jwt() to ${APP_ROLE};`);

    await pool.query('insert into "user" (user_id, name) values ($1, $2);', [owner1, "Ada"]);
  });

  afterAll(async () => {
    await pool.query('drop table if exists "user" cascade;');
    await pool.query(`drop owned by ${APP_ROLE};`);
    await pool.query(`drop role if exists ${APP_ROLE};`);
    await pool.query("drop schema if exists auth cascade;");
    await pool.end();
  });

  it("RLS on a reserved-keyword table name still filters correctly", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${APP_ROLE};`);
      await client.query("select set_config('request.jwt.claims', $1, true);", [
        JSON.stringify({ sub: owner1 }),
      ]);
      const result = await client.query('select name from "user";');
      expect(result.rows).toEqual([{ name: "Ada" }]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
