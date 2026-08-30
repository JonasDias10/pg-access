import { defineAuth, or, owner, publicAccess, role } from "@pg-access/core";
import { planPolicyChanges } from "@pg-access/postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import declaredAuth from "../../pgaccess.config.js";

/**
 * The other integration suite (api.integration.test.ts) proves the
 * *compiled* policies enforce access control. This one proves the other
 * half of the workflow: keeping `pgaccess.config.ts` and the live database
 * in step over time.
 *
 * `planPolicyChanges()` (what `pg-access check` and
 * `pg-access generate --database-url` run) diffs the config against the
 * database and returns only what has to change - and normalizes the
 * config's policies through PostgreSQL itself so an unchanged policy is
 * recognised as unchanged rather than needlessly rewritten. Nothing here
 * modifies the database; every check is net read-only.
 *
 * Requires `supabase start` and `supabase db reset` (see the README) and a
 * filled-in .env. Excluded from the repo-root `pnpm test:integration`,
 * which only provisions a plain Postgres server.
 */

const connectionString =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("pg-access diffing against the live Supabase database", () => {
  const pool = new pg.Pool({ connectionString });

  beforeAll(async () => {
    try {
      await pool.query("select 1");
    } catch (error) {
      throw new Error(
        `Could not reach the database at ${connectionString}. Run 'supabase start' and ` +
          "'supabase db reset' (see README), copy its output into .env, then rerun.",
        { cause: error },
      );
    }
  });

  afterAll(() => pool.end());

  const withSession = async <T>(fn: (session: pg.PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  };

  it("checked-in _pg_access.sql migration matches pgaccess.config.ts: no drift", async () => {
    const plan = await withSession((session) => planPolicyChanges(session, declaredAuth));

    expect(plan.changes.every((change) => change.kind === "noop")).toBe(true);
    expect(plan.sql).toBe("");
  });

  it("opening posts.select to everyone is an ALTER, not a drop+recreate", async () => {
    const opened = defineAuth({
      profiles: {
        rows: {
          insert: or(owner("user_id"), role("admin")),
          delete: or(owner("user_id"), role("admin")),
          select: or(owner("user_id"), role("admin")),
          update: or(owner("user_id"), role("admin")),
        },
      },
      posts: {
        rows: {
          insert: or(owner("user_id"), role("admin")),
          delete: or(owner("user_id"), role("admin")),
          select: publicAccess(),
          update: or(owner("user_id"), role("admin")),
        },
      },
    });

    const plan = await withSession((session) => planPolicyChanges(session, opened));

    expect(plan.changes).toContainEqual({
      table: "posts",
      operation: "select",
      name: "posts_select",
      kind: "alter",
    });
    // Every other policy is untouched.
    expect(plan.changes.filter((change) => change.kind !== "noop")).toHaveLength(1);
    expect(plan.sql).toContain('alter policy "posts_select"');
    expect(plan.sql).not.toContain("drop policy");
    expect(plan.sql).not.toContain("create policy");
  });

  it("removing posts.delete from the config is a DROP", async () => {
    const withoutDelete = defineAuth({
      profiles: {
        rows: {
          insert: or(owner("user_id"), role("admin")),
          delete: or(owner("user_id"), role("admin")),
          select: or(owner("user_id"), role("admin")),
          update: or(owner("user_id"), role("admin")),
        },
      },
      posts: {
        rows: {
          insert: or(owner("user_id"), role("admin")),
          select: or(owner("user_id"), role("admin")),
          update: or(owner("user_id"), role("admin")),
        },
      },
    });

    const plan = await withSession((session) => planPolicyChanges(session, withoutDelete));

    expect(plan.changes).toContainEqual({
      table: "posts",
      operation: "delete",
      name: "posts_delete",
      kind: "drop",
    });
    expect(plan.sql).toContain('drop policy if exists "posts_delete" on "posts";');
    expect(plan.sql).not.toContain("create policy");
    expect(plan.sql).not.toContain("alter policy");
  });
});
