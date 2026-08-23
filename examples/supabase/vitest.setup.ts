try {
  process.loadEnvFile();
} catch {
  // No .env file; env vars are expected to already be exported (e.g. in CI).
}
