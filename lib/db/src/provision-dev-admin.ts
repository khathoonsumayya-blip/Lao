/**
 * Development-only interactive Admin provisioning.
 *
 * Run with:
 *   DEV_ADMIN_PROVISION=true NODE_ENV=development pnpm --filter @workspace/db run provision:dev-admin
 *
 * This command intentionally prompts for the password without echoing it,
 * hashes it using the same scrypt encoding as the API, and never prints the
 * password or password hash.
 */
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { promisify } from "node:util";
import readline from "node:readline";
import pg from "pg";

const { Pool } = pg;
const scryptAsync = promisify(scrypt);

function requireDevelopmentMode(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to provision an Admin account in production.");
  }
  if (process.env.DEV_ADMIN_PROVISION !== "true") {
    throw new Error(
      "Refusing to provision an Admin account. Set DEV_ADMIN_PROVISION=true for this one-time command.",
    );
  }
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function ask(prompt: string): Promise<string> {
  const input = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await new Promise<string>((resolve) => input.question(prompt, resolve))).trim();
  } finally {
    input.close();
  }
}

async function askHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("A real interactive terminal is required for the secure password prompt.");
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const stdin = process.stdin;
    const stdout = process.stdout;

    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: Buffer | string): void => {
      for (const character of chunk.toString()) {
        if (character === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Provisioning cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function provision(): Promise<void> {
  requireDevelopmentMode();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set before provisioning an Admin account.");
  }

  const firstName = (await ask("First name [Admin]: ")) || "Admin";
  const lastName = (await ask("Last name [User]: ")) || "User";
  const email = (await ask("Admin email: ")).toLowerCase();
  if (!validEmail(email)) {
    throw new Error("Enter a valid email address.");
  }

  const password = await askHidden("Admin password (minimum 10 characters): ");
  if (password.length < 10) {
    throw new Error("The Admin password must be at least 10 characters.");
  }
  const confirmation = await askHidden("Confirm Admin password: ");
  if (password !== confirmation) {
    throw new Error("The password confirmation did not match.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM profiles WHERE email = $1 FOR UPDATE",
      [email],
    );
    if (existing.rowCount) {
      throw new Error("That email already has an account; no account was changed.");
    }

    const profileId = randomUUID();
    const authUserId = randomUUID();
    const encodedPassword = await passwordHash(password);
    await client.query(
      `INSERT INTO profiles (
         id, auth_user_id, role, first_name, last_name, email,
         password_hash, email_verified_at, status
       ) VALUES ($1, $2, 'admin', $3, $4, $5, $6, now(), 'active')`,
      [profileId, authUserId, firstName, lastName, email, encodedPassword],
    );
    await client.query("COMMIT");
    console.log(`Development Admin account created for ${email}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

try {
  await provision();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Admin provisioning failed.");
  process.exitCode = 1;
}