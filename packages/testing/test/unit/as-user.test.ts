import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { asUser } from "../../src/as-user.js";

interface Call {
  readonly text: string;
  readonly values?: readonly unknown[];
}

function fakePool(): { pool: Pool; calls: Call[]; released: boolean[] } {
  const calls: Call[] = [];
  const released: boolean[] = [];

  const client = {
    query: vi.fn(async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return { rows: [] };
    }),
    release: vi.fn(() => {
      released.push(true);
    }),
  } as unknown as PoolClient;

  const pool = {
    connect: vi.fn(async () => client),
  } as unknown as Pool;

  return { pool, calls, released };
}

describe("asUser", () => {
  it("begins a transaction, sets the default authenticated role, and rolls back", async () => {
    const { pool, calls } = fakePool();

    await asUser(pool, {}, async () => "result");

    expect(calls.map((c) => c.text)).toEqual([
      "begin",
      'set local role "authenticated";',
      "rollback",
    ]);
  });

  it("sets request.jwt.claims as JSON when claims are given", async () => {
    const { pool, calls } = fakePool();

    await asUser(pool, { claims: { sub: "user-1" } }, async () => undefined);

    const setConfigCall = calls.find((c) => c.text.includes("set_config"));
    expect(setConfigCall?.values).toEqual([JSON.stringify({ sub: "user-1" })]);
  });

  it("doesn't call set_config for an unauthenticated request (no claims)", async () => {
    const { pool, calls } = fakePool();

    await asUser(pool, {}, async () => undefined);
    await asUser(pool, { claims: null }, async () => undefined);

    expect(calls.some((c) => c.text.includes("set_config"))).toBe(false);
  });

  it("quotes a custom role", async () => {
    const { pool, calls } = fakePool();

    await asUser(pool, { role: "service_role" }, async () => undefined);

    expect(calls.map((c) => c.text)).toContain('set local role "service_role";');
  });

  it("returns run()'s result", async () => {
    const { pool } = fakePool();

    const result = await asUser(pool, {}, async () => 42);

    expect(result).toBe(42);
  });

  it("still rolls back and releases the client even when run() throws", async () => {
    const { pool, calls, released } = fakePool();

    await expect(
      asUser(pool, {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(calls.map((c) => c.text)).toContain("rollback");
    expect(released).toEqual([true]);
  });
});
