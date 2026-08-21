import { defineAuth, owner } from "@pg-access/core";

export default defineAuth({
  projects: { rows: { select: owner("user_id") } },
});
