import { DataSource } from "typeorm";
import { Note } from "./entities/note.js";

/** The repo's docker-compose.test.yml database, unless DATABASE_URL says otherwise. */
export const DEFAULT_DATABASE_URL = "postgres://pgaccess:pgaccess@localhost:54329/pg_access_test";

export function createDataSource(url = process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL) {
  return new DataSource({
    type: "postgres",
    url,
    entities: [Note],
    migrations: [`${import.meta.dirname}/migrations/*.ts`],
    migrationsTableName: "typeorm_migrations",
  });
}

/** Default export for the TypeORM CLI (`pnpm typeorm ...`). */
export default createDataSource();
