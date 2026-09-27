import { defineAuth, or, owner, role } from "@pg-access/core";

/**
 * Everyone manages their own notes; an admin (`role: "admin"` in the JWT's
 * `app_metadata`) can also read and delete anyone's, but not write them.
 */
export default defineAuth({
  notes: {
    rows: {
      select: or(owner("user_id"), role("admin")),
      insert: owner("user_id"),
      update: owner("user_id"),
      delete: or(owner("user_id"), role("admin")),
    },
  },
});
