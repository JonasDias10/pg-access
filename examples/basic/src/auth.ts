import { and, authenticated, defineAuth, owner } from "@pg-access/core";

/**
 * A `projects` table where:
 *  - anyone signed in can create a project for themselves,
 *  - only the owner can see, edit, or delete their own projects.
 */
export default defineAuth({
  projects: {
    rows: {
      select: owner("user_id"),
      insert: and(authenticated(), owner("user_id")),
      update: owner("user_id"),
      delete: owner("user_id"),
    },
  },
});
