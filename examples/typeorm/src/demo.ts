import { randomUUID } from "node:crypto";
import { In } from "typeorm";
import { asUser } from "./as-user.js";
import dataSource from "./data-source.js";
import { Note } from "./entities/note.js";

/**
 * Applies the migrations, then shows the policies from pgaccess.config.ts
 * filtering ordinary TypeORM repository calls, one `asUser()` per simulated
 * request.
 */

await dataSource.initialize();
await dataSource.runMigrations();

const alice = { id: randomUUID() };
const bob = { id: randomUUID() };
const admin = { id: randomUUID(), role: "admin" };

try {
  await asUser(dataSource, alice, (manager) =>
    manager.getRepository(Note).insert({ userId: alice.id, body: "alice's note" }),
  );
  await asUser(dataSource, bob, (manager) =>
    manager.getRepository(Note).insert({ userId: bob.id, body: "bob's note" }),
  );

  const seenByBob = await asUser(dataSource, bob, (manager) => manager.getRepository(Note).find());
  console.log(
    "bob sees:  ",
    seenByBob.map((note) => note.body),
  );

  const seenByAdmin = await asUser(dataSource, admin, (manager) =>
    manager.getRepository(Note).find({ order: { body: "asc" } }),
  );
  console.log(
    "admin sees:",
    seenByAdmin.map((note) => note.body),
  );

  await asUser(dataSource, bob, (manager) =>
    manager.getRepository(Note).insert({ userId: alice.id, body: "bob posing as alice" }),
  ).catch((error: Error) => console.log("bob writing as alice:", error.message));
} finally {
  // The data source's own login role owns the table, so RLS doesn't apply to it.
  await dataSource.getRepository(Note).delete({ userId: In([alice.id, bob.id]) });
  await dataSource.destroy();
}
