import { defineAuth, or, owner, role } from "@pg-access/core";

export default defineAuth({
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
      select: or(owner("user_id"), role("admin")),
      update: or(owner("user_id"), role("admin")),
    },
  },
});
