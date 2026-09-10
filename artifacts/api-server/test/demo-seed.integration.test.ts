import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) {
  throw new Error(
    "DATABASE_URL must be set before running the demo seed integration test.",
  );
}

const sourceDatabase = decodeURIComponent(
  new URL(sourceDatabaseUrl).pathname.slice(1),
);
if (!sourceDatabase) {
  throw new Error("DATABASE_URL must include a database name.");
}

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const migrationDirectory = join(workspaceRoot, "lib/db/migrations");
const databaseName = `aa_seed_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const testDatabaseUrl = new URL(sourceDatabaseUrl);
testDatabaseUrl.pathname = `/${databaseName}`;

let app: any;
let database: { pool: { end: () => Promise<void> } } | undefined;
let server: any;
let baseUrl = "";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: workspaceRoot,
      env,
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof commandError.code === "number" ? commandError.code : 1,
      stdout: commandError.stdout ?? "",
      stderr: commandError.stderr ?? "",
    };
  }
}

function postgresEnvironment(database: string): NodeJS.ProcessEnv {
  const parsed = new URL(sourceDatabaseUrl);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGDATABASE: database,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

async function runPsql(
  database: string,
  args: string[],
): Promise<CommandResult> {
  return runCommand("psql", args, postgresEnvironment(database));
}

function assertCommandSucceeded(result: CommandResult, command: string): void {
  assert.equal(
    result.code,
    0,
    `${command} failed:\n${result.stdout}\n${result.stderr}`,
  );
}

async function runSeed(
  nodeEnvironment: string,
  allowDemoSeed: string,
): Promise<CommandResult> {
  return runCommand("pnpm", ["--filter", "@workspace/db", "run", "seed"], {
    ...process.env,
    DATABASE_URL: testDatabaseUrl.toString(),
    NODE_ENV: nodeEnvironment,
    ALLOW_DEMO_SEED: allowDemoSeed,
  });
}

async function jsonRequest(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Preserve non-JSON responses for useful assertion failures.
  }
  return { response, body };
}

function sessionCookie(response: Response, cookieName = "aa_session"): string {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headers.getSetCookie?.() ?? [headers.get("set-cookie")].filter(
    (value): value is string => Boolean(value),
  );
  const setCookie = setCookies.find((value) => value.startsWith(`${cookieName}=`));
  assert.ok(setCookie, "The sign-in response should set a session cookie.");
  return setCookie.split(";", 1)[0];
}

before(async () => {
  assert.match(databaseName, /^aa_seed_test_\d+_[a-f0-9]+$/);
  const createDatabase = await runPsql(sourceDatabase, [
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE "${databaseName}"`,
  ]);
  assertCommandSucceeded(createDatabase, "CREATE DATABASE");

  const migrationFiles = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql") && file !== "supabase_rls.sql")
    .sort();
  for (const migrationFile of migrationFiles) {
    const migration = await runPsql(databaseName, [
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      join(migrationDirectory, migrationFile),
    ]);
    assertCommandSucceeded(migration, `Applying ${migrationFile}`);
  }

  const productionSeed = await runSeed("production", "true");
  assert.notEqual(
    productionSeed.code,
    0,
    "The seed command must reject production mode.",
  );
  assert.match(
    `${productionSeed.stdout}\n${productionSeed.stderr}`,
    /Refusing to seed/,
  );

  const developmentSeed = await runSeed("development", "true");
  assertCommandSucceeded(developmentSeed, "Development demo seed");
  const repeatedDevelopmentSeed = await runSeed("development", "true");
  assertCommandSucceeded(
    repeatedDevelopmentSeed,
    "Repeated development demo seed",
  );

  process.env.NODE_ENV = "development";
  process.env.DATABASE_URL = testDatabaseUrl.toString();
  process.env.ALLOW_DEMO_SESSION = "false";
  process.env.CORS_ORIGIN = "";
  process.env.PAYMENTS_TEST_MODE = "true";

  const [{ default: importedApp }, importedDatabase] = await Promise.all([
    import("../src/app.ts"),
    import("@workspace/db"),
  ]);
  app = importedApp;
  database = importedDatabase;

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((error: Error | undefined) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  if (database) await database.pool.end();

  const droppedDatabase = await runPsql(sourceDatabase, [
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `DROP DATABASE IF EXISTS "${databaseName}"`,
  ]);
  assertCommandSucceeded(droppedDatabase, "DROP DATABASE");
});

test("authenticates the seeded Admin Desk and forbids customers from staff routes", async () => {
  const adminSignIn = await jsonRequest("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({
      email: "demo.admin@anything-anywhere.local",
      password: "DemoAdmin2026!",
      adminSession: true,
    }),
  });
  assert.equal(adminSignIn.response.status, 200);
  assert.equal(
    (adminSignIn.body as { profile: { email: string; role: string } }).profile
      .email,
    "demo.admin@anything-anywhere.local",
  );
  assert.equal(
    (adminSignIn.body as { profile: { role: string } }).profile.role,
    "admin",
  );

  const adminDashboard = await jsonRequest("/api/admin/dashboard", {
    headers: { cookie: sessionCookie(adminSignIn.response, "aa_admin_session") },
  });
  assert.equal(adminDashboard.response.status, 200);
  assert.equal(
    typeof (adminDashboard.body as { deliveriesToday: unknown })
      .deliveriesToday,
    "number",
  );

  const customerEmail = `seed-test-customer-${randomUUID()}@example.test`;
  const customerRegistration = await jsonRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Test",
      lastName: "Customer",
      email: customerEmail,
      phone: "9195550147",
      password: "CustomerDemo2026!",
    }),
  });
  assert.equal(customerRegistration.response.status, 201);
  assert.equal(
    (customerRegistration.body as { profile: { role: string } }).profile.role,
    "customer",
  );

  const customerDashboard = await jsonRequest("/api/admin/dashboard", {
    headers: { cookie: sessionCookie(customerRegistration.response) },
  });
  assert.equal(customerDashboard.response.status, 401);
});
