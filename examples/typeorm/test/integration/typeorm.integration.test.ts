import { randomUUID } from "node:crypto";
import { planPolicyChanges } from "@pg-access/postgres";
import pg from "pg";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import auth from "../../pgaccess.config.js";
import { asUser } from "../../src/as-user.js";
import { createDataSource } from "../../src/data-source.js";
import { Note } from "../../src/entities/note.js";

/**
 * Runs the checked-in migrations through TypeORM itself (`runMigrations()` /
 * `undoLastMigration()`, what `migration:run` / `migration:revert` call) and
 * proves the pg-access one both enforces pgaccess.config.ts on repository
 * calls and reverts cleanly.
 *
 * Works in a throwaway database created on the server at
 * PG_ACCESS_TEST_DATABASE_URL (defaults to the docker-compose.test.yml
 * service), dropped again afterwards: the `authenticated` role is
 * cluster-wide, and grants to it left in the shared test database would stop
 * the other suites from dropping and recreating it. Start the server with:
 *   docker compose -f docker-compose.test.yml up -d
 */

const serverUrl =
  process.env["PG_ACCESS_TEST_DATABASE_URL"] ??
  "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

const DATABASE = "pg_access_example_typeorm";

function databaseUrl(name: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

describe("examples/typeorm migrations against real PostgreSQL", () => {
  const admin = new pg.Pool({ connectionString: serverUrl });
  let dataSource: DataSource;

  const alice = { id: randomUUID() };
  const bob = { id: randomUUID() };

  beforeAll(async () => {
    try {
      await admin.query("select 1");
    } catch (error) {
      throw new Error(
        `Could not reach the test database at ${serverUrl}. ` +
          "Start it with: docker compose -f docker-compose.test.yml up -d",
        { cause: error },
      );
    }

    await admin.query(`drop database if exists ${DATABASE} with (force)`);
    await admin.query(`create database ${DATABASE}`);

    dataSource = createDataSource(databaseUrl(DATABASE));
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    await admin.query(`drop database if exists ${DATABASE} with (force)`);
    await admin.end();
  });

  const insertNote = (user: { id: string }, userId: string, body: string) =>
    asUser(dataSource, user, (manager) => manager.getRepository(Note).insert({ userId, body }));

  const notesSeenBy = (user: { id: string; role?: string }) =>
    asUser(dataSource, user, (manager) => manager.getRepository(Note).find());

  it("lets a user read and write only their own notes", async () => {
    await insertNote(alice, alice.id, "alice's note");
    await insertNote(bob, bob.id, "bob's note");

    expect((await notesSeenBy(alice)).map((note) => note.body)).toEqual(["alice's note"]);
    expect((await notesSeenBy(bob)).map((note) => note.body)).toEqual(["bob's note"]);
    await expect(insertNote(bob, alice.id, "bob posing as alice")).rejects.toThrow(
      /row-level security/,
    );
  });

  it("lets an admin read everyone's notes, but not write them as someone else", async () => {
    const root = { id: randomUUID(), role: "admin" };

    expect(await notesSeenBy(root)).toHaveLength(2);
    await expect(insertNote(root, alice.id, "admin posing as alice")).rejects.toThrow(
      /row-level security/,
    );
  });

  it("matches pgaccess.config.ts exactly: no drift for `pg-access check` to report", async () => {
    // What `pg-access check` runs: a plain `pg` session, since
    // planPolicyChanges() opens (and rolls back) its own transaction.
    const client = new pg.Client({ connectionString: databaseUrl(DATABASE) });
    await client.connect();
    const plan = await planPolicyChanges(client, auth).finally(() => client.end());

    expect(plan.changes.every((change) => change.kind === "noop")).toBe(true);
  });

  it("migration:revert removes every policy and turns RLS back off", async () => {
    await dataSource.undoLastMigration();

    const policies = await dataSource.query(
      "select policyname from pg_policies where tablename = 'notes'",
    );
    const [table] = await dataSource.query(
      "select relrowsecurity from pg_class where relname = 'notes'",
    );

    expect(policies).toEqual([]);
    expect(table).toEqual({ relrowsecurity: false });
  });

  it("reverts the whole history, back to an empty database", async () => {
    await dataSource.undoLastMigration();
    await dataSource.undoLastMigration();

    const [notes] = await dataSource.query("select to_regclass('public.notes') as notes");
    const [schema] = await dataSource.query("select to_regnamespace('auth') as auth");

    expect(notes).toEqual({ notes: null });
    expect(schema).toEqual({ auth: null });
  });
});
