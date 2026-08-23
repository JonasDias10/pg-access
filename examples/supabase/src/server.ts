import { buildApp } from "./app.js";

async function main() {
  const port = Number(process.env["PORT"] ?? 3000);
  const app = buildApp();

  await app.listen({ port });

  console.log(`Listening on http://localhost:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
