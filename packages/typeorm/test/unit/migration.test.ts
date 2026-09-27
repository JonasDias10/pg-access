import { defineAuth, owner, role } from "@pg-access/core";
import { describe, expect, it } from "vitest";
import { generateTypeOrmMigration, toTypeOrmMigration } from "../../src/migration.js";

const now = new Date("2026-09-27T14:03:07.123Z");

/** Pulls every `queryRunner.query(...)` template literal back out of a method, evaluated. */
function queriesIn(source: string, method: "up" | "down"): string[] {
  const start = source.indexOf(`public async ${method}(`);
  const end = source.indexOf("\n  }", start);
  const body = source.slice(start, end);
  const literals = [...body.matchAll(/queryRunner\.query\((`(?:[^`\\]|\\.)*`)\);/g)];

  return literals.map((match) => new Function(`return ${match[1]};`)() as string);
}

describe("toTypeOrmMigration", () => {
  it("names the file and class the way TypeORM expects, with a millisecond timestamp", () => {
    const migration = toTypeOrmMigration({ up: [], down: [] }, { now });

    expect(migration.fileName).toBe("1790517787123-PgAccess.ts");
    expect(migration.className).toBe("PgAccess1790517787123");
    expect(migration.source).toContain(
      "export class PgAccess1790517787123 implements MigrationInterface {",
    );
    expect(migration.source).toContain('name = "PgAccess1790517787123";');
  });

  it("accepts a custom name prefix", () => {
    const migration = toTypeOrmMigration({ up: [], down: [] }, { now, name: "NotesRls" });

    expect(migration.fileName).toBe("1790517787123-NotesRls.ts");
    expect(migration.className).toBe("NotesRls1790517787123");
  });

  it("rejects a name that can't start a class name", () => {
    expect(() => toTypeOrmMigration({ up: [], down: [] }, { name: "pg-access" })).toThrow(
      /valid class name prefix/,
    );
  });

  it("imports only types from typeorm, so it has no runtime import to resolve", () => {
    const { source } = toTypeOrmMigration({ up: [], down: [] }, { now });

    expect(source).toContain('import type { MigrationInterface, QueryRunner } from "typeorm";');
  });

  it("runs each statement as its own queryRunner.query() call, in order", () => {
    const { source } = toTypeOrmMigration(
      { up: ["select 1;", "select 2;"], down: ["select 3;"] },
      { now },
    );

    expect(queriesIn(source, "up")).toEqual(["select 1;", "select 2;"]);
    expect(queriesIn(source, "down")).toEqual(["select 3;"]);
  });

  it("escapes backticks, backslashes and ${ so the SQL survives the template literal", () => {
    const sql = "select '`tick`', E'back\\\\slash', '${not_interpolated}';";
    const { source } = toTypeOrmMigration({ up: [sql], down: [] }, { now });

    expect(queriesIn(source, "up")).toEqual([sql]);
  });
});

describe("generateTypeOrmMigration", () => {
  it("puts the compiled policies in up() and drops them again in down()", () => {
    const auth = defineAuth({ notes: { rows: { select: owner("user_id") } } });

    const { source } = generateTypeOrmMigration(auth, { now });
    const up = queriesIn(source, "up");

    expect(up[0]).toBe('alter table "notes" enable row level security;');
    expect(up).toContain('drop policy if exists "notes_select" on "notes";');
    expect(up.some((sql) => sql.startsWith('create policy "notes_select"'))).toBe(true);
    expect(queriesIn(source, "down")).toEqual(['drop policy if exists "notes_select" on "notes";']);
  });

  it("keeps role() string literals intact", () => {
    const auth = defineAuth({ notes: { rows: { select: role("admin") } } });

    const up = queriesIn(generateTypeOrmMigration(auth, { now }).source, "up");

    expect(up.find((sql) => sql.startsWith("create policy"))).toContain("= 'admin'");
  });
});
