import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateMigration } from "@pg-access/postgres";
import auth from "./auth.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const migration = generateMigration(auth);

await mkdir(migrationsDir, { recursive: true });
await writeFile(path.join(migrationsDir, migration.fileName), migration.sql, "utf8");

console.log(`Wrote migrations/${migration.fileName}:\n`);
console.log(migration.sql);
