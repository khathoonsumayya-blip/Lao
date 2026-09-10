import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const testDatabaseUrl = process.env.SUPABASE_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "SUPABASE_TEST_DATABASE_URL must point to an isolated Supabase test database before running test:rls.",
  );
}

const parsedUrl = new URL(testDatabaseUrl);
assert.ok(
  parsedUrl.protocol === "postgres:" || parsedUrl.protocol === "postgresql:",
  "SUPABASE_TEST_DATABASE_URL must be a PostgreSQL connection URL.",
);

if (process.env.DATABASE_URL) {
  const developmentUrl = new URL(process.env.DATABASE_URL);
  const databaseIdentity = (url: URL) =>
    `${url.protocol}//${url.hostname}:${url.port || "5432"}${url.pathname}`;
  if (databaseIdentity(parsedUrl) === databaseIdentity(developmentUrl)) {
    throw new Error(
      "SUPABASE_TEST_DATABASE_URL must not be the same database as DATABASE_URL.",
    );
  }
}

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const migrationDirectory = join(workspaceRoot, "lib/db/migrations");
const migrationFiles = (await readdir(migrationDirectory))
  .filter((file) => file.endsWith(".sql") && file !== "supabase_rls.sql")
  .sort()
  .concat("supabase_rls.sql");

process.env.DATABASE_URL = testDatabaseUrl;
const { pool } = await import("@workspace/db");
const client = await pool.connect();

try {
  await client.query("BEGIN");

  for (const migrationFile of migrationFiles) {
    const migration = await readFile(
      join(migrationDirectory, migrationFile),
      "utf8",
    );
    await client.query(migration);
  }

  await client.query("COMMIT");
  console.log(
    `Applied ${migrationFiles.length} schema migrations to the isolated RLS test database.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
