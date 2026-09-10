import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, driversTable, passwordResetTokensTable, profilesTable, sessionsTable, securitySettingsTable } from "@workspace/db";
import { RegisterAccountBody } from "@workspace/api-zod";
import { currentAuth } from "../lib/auth";
import { EmailProviderError, sendPasswordResetEmail } from "../lib/resend";

const router: IRouter = Router();
const scryptAsync = promisify(scrypt);
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const passwordResetLifetimeMs = 30 * 60 * 1000;
const passwordResetPath = "/reset-password";
const adminPasswordResetPath = "/admin/reset-password";
const previewCustomerAppUrl = "https://98003e0a-5b5f-4eab-a93b-da51a054e5db-00-8h9noluamrze.picard.replit.dev";
const staffRoles = ["admin", "dispatcher", "support"] as const;

const isProduction = process.env.NODE_ENV === "production";
const maxAttempts = 6;
const attemptWindowMs = 10 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const maxPasswordResetRequests = 3;
const passwordResetRequestWindowMs = 10 * 60 * 1000;
const passwordResetRequests = new Map<string, { count: number; resetAt: number }>();

type Credentials = {
  email?: unknown;
  password?: unknown;
  adminSession?: unknown;
};
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function emailFrom(value: unknown): string {
  return text(value).toLowerCase();
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^[+().\s\d-]+$/.test(value) && digits.length >= 10 && digits.length <= 15;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === derived.length && timingSafeEqual(expectedBuffer, derived);
}

function requestKey(ip: string | undefined, email: string): string {
  return `${ip ?? "unknown"}:${email}`;
}

function blocked(key: string): boolean {
  const record = failedAttempts.get(key);
  if (!record) return false;
  if (record.resetAt <= Date.now()) {
    failedAttempts.delete(key);
    return false;
  }
  return record.count >= maxAttempts;
}

function markFailed(key: string): void {
  const prior = failedAttempts.get(key);
  if (!prior || prior.resetAt <= Date.now()) {
    failedAttempts.set(key, { count: 1, resetAt: Date.now() + attemptWindowMs });
    return;
  }
  failedAttempts.set(key, { ...prior, count: prior.count + 1 });
}

function clearFailures(key: string): void {
  failedAttempts.delete(key);
}

function allowPasswordResetRequest(key: string): boolean {
  const prior = passwordResetRequests.get(key);
  if (!prior || prior.resetAt <= Date.now()) {
    passwordResetRequests.set(key, { count: 1, resetAt: Date.now() + passwordResetRequestWindowMs });
    return true;
  }
  if (prior.count >= maxPasswordResetRequests) return false;
  passwordResetRequests.set(key, { ...prior, count: prior.count + 1 });
  return true;
}

function customerAppUrl(): string {
  const configured = process.env.CUSTOMER_APP_URL?.trim().replace(/\/+$/, "");
  if (!configured) {
    if (isProduction) return "https://www.anythinganywhere.com";
    return previewCustomerAppUrl;
  }
  const url = new URL(configured);
  if (
    url.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("CUSTOMER_APP_URL must be a bare http(s) origin without a path, query, or fragment.");
  }
  if (isProduction && url.origin !== "https://www.anythinganywhere.com") {
    throw new Error("CUSTOMER_APP_URL must use the approved customer application origin in production.");
  }
  return url.origin;
}

function adminAppUrl(): string {
  const configured = process.env.ADMIN_APP_URL?.trim().replace(/\/+$/, "");
  if (!configured) {
    return isProduction ? "https://admin.anythinganywhere.com" : previewCustomerAppUrl;
  }
  const url = new URL(configured);
  if (
    url.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("ADMIN_APP_URL must be a bare HTTPS origin without a path, query, or fragment.");
  }
  if (isProduction && url.origin !== "https://admin.anythinganywhere.com") {
    throw new Error("ADMIN_APP_URL must use the approved Admin application origin in production.");
  }
  return url.origin;
}

async function createSession(profileId: string, userAgent: string | undefined): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(48).toString("base64url");
  const [profile] = await db.select({ role: profilesTable.role }).from(profilesTable).where(eq(profilesTable.id, profileId)).limit(1);
  const [security] = profile && staffRoles.includes(profile.role as typeof staffRoles[number])
    ? await db.select({ sessionTimeoutMinutes: securitySettingsTable.sessionTimeoutMinutes }).from(securitySettingsTable).where(eq(securitySettingsTable.id, "security")).limit(1)
    : [];
  const configuredMinutes = Number(security?.sessionTimeoutMinutes);
  const lifetime = Number.isInteger(configuredMinutes) && configuredMinutes >= 15 && configuredMinutes <= 1440
    ? configuredMinutes * 60_000
    : sessionLifetimeMs;
  const expiresAt = new Date(Date.now() + lifetime);
  await db.insert(sessionsTable).values({
    profileId,
    tokenHash: tokenHash(token),
    expiresAt,
    userAgent: userAgent?.slice(0, 512) ?? null,
  });
  return { token, expiresAt };
}

function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  setNamedSessionCookie(res, "aa_session", token, expiresAt);
}

function setAdminSessionCookie(res: Response, token: string, expiresAt: Date): void {
  setNamedSessionCookie(res, "aa_admin_session", token, expiresAt);
}

function setNamedSessionCookie(
  res: Response,
  name: "aa_session" | "aa_admin_session",
  token: string,
  expiresAt: Date,
): void {
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    ...(sessionCookieDomain ? { domain: sessionCookieDomain } : {}),
    expires: expiresAt,
    path: "/",
  });
}

function authResponse(profile: { id: string; role: string; firstName: string; lastName: string; email: string; phone: string | null; emailVerifiedAt: Date | null; phoneVerifiedAt: Date | null }) {
  return {
    profile: {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone,
      emailVerified: Boolean(profile.emailVerifiedAt),
      phoneVerified: Boolean(profile.phoneVerifiedAt),
      role: profile.role,
    },
  };
}

router.get("/auth/session", async (req, res): Promise<void> => {
  // The customer app uses this response to decide whether a protected page can
  // render after a browser reload. A conditional 304 has no JSON body and
  // would be interpreted as a missing session by the browser client.
  res.setHeader("Cache-Control", "no-store");
  try {
    const cookieName =
      req.query.admin === "true" ? "aa_admin_session" : "aa_session";
    if (
      (req.query.noDemo === "true" || req.query.admin === "true") &&
      !req.cookies?.[cookieName]
    ) {
      res.status(401).json({ error: "Sign in is required for this request." });
      return;
    }
    const auth = currentAuth(res);
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(and(eq(profilesTable.id, auth.profileId), eq(profilesTable.status, "active")))
    .limit(1);
    if (!profile) {
      res.status(401).json({ error: "Your session is no longer available." });
      return;
    }
    res.json(authResponse(profile));
  } catch {
    res.status(401).json({ error: "Sign in is required for this request." });
  }
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your name, a valid email, and a password of at least 10 characters." });
    return;
  }
  const body = parsed.data;
  const firstName = text(body.firstName);
  const lastName = text(body.lastName);
  const email = emailFrom(body.email);
  const accountType = body.accountType === "driver" ? "driver" : "customer";
  const phone = text(body.phone);
  const password = typeof body.password === "string" ? body.password : "";
  if (!firstName || !lastName || !validEmail(email) || (accountType === "customer" && !validPhone(phone)) || password.length < 10) {
    res.status(400).json({ error: accountType === "customer" ? "Enter your name, a valid email, a valid mobile number, and a password of at least 10 characters." : "Enter your name, a valid email, and a password of at least 10 characters." });
    return;
  }
  const [existing] = await db.select({ id: profilesTable.id }).from(profilesTable).where(eq(profilesTable.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists. Try signing in instead." });
    return;
  }
  const [profile] = await db
    .insert(profilesTable)
    .values({
      authUserId: randomUUID(),
      role: accountType,
      firstName,
      lastName,
      email,
       phone: phone || null,
      passwordHash: await passwordHash(password),
      status: "active",
    })
    .returning();
  if (accountType === "driver") {
    await db.insert(driversTable).values({
      profileId: profile.id,
      onboardingStatus: "pending",
      availabilityStatus: "offline",
      approvalStatus: "pending",
    });
  }
  const session = await createSession(profile.id, req.get("user-agent"));
  setSessionCookie(res, session.token, session.expiresAt);
  req.log.info({ profileId: profile.id, accountType }, "Account registered");
  res.status(201).json(authResponse(profile));
});

router.post("/auth/sign-in", async (req, res): Promise<void> => {
  const body = req.body as Credentials;
  const email = emailFrom(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const key = requestKey(req.ip, email);
  if (blocked(key)) {
    res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    return;
  }
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(and(eq(profilesTable.email, email), eq(profilesTable.status, "active")))
    .limit(1);
  if (!profile?.passwordHash || !(await passwordMatches(password, profile.passwordHash))) {
    markFailed(key);
    res.status(401).json({ error: "Incorrect email or password." });
    return;
  }
  if (
    body.adminSession === true &&
    !staffRoles.includes(profile.role as (typeof staffRoles)[number])
  ) {
    clearFailures(key);
    res.status(403).json({ error: "You do not have permission to access the Admin App." });
    return;
  }
  clearFailures(key);
  const session = await createSession(profile.id, req.get("user-agent"));
  setSessionCookie(res, session.token, session.expiresAt);
  if (body.adminSession === true) {
    setAdminSessionCookie(res, session.token, session.expiresAt);
  }
  req.log.info({ profileId: profile.id, role: profile.role }, "Account signed in");
  res.json(authResponse(profile));
});

router.post("/auth/signout", async (req, res): Promise<void> => {
  const tokens = new Set(
    [req.cookies?.aa_session, req.cookies?.aa_admin_session].filter(
      (token): token is string => typeof token === "string",
    ),
  );
  for (const token of tokens) {
    await db
      .update(sessionsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessionsTable.tokenHash, tokenHash(token)), isNull(sessionsTable.revokedAt), gt(sessionsTable.expiresAt, new Date())));
  }
  clearSessionCookie(res, "aa_session");
  clearSessionCookie(res, "aa_admin_session");
  res.status(204).end();
});

function clearSessionCookie(
  res: Response,
  name: "aa_session" | "aa_admin_session",
): void {
  res.clearCookie(name, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    ...(sessionCookieDomain ? { domain: sessionCookieDomain } : {}),
    path: "/",
  });
}

async function requestPasswordReset(
  req: Request,
  res: Response,
  options: { resetPath: string; appUrl: () => string; staffOnly?: boolean },
): Promise<void> {
  const email = emailFrom((req.body as { email?: unknown })?.email);
  if (!validEmail(email) || !allowPasswordResetRequest(requestKey(req.ip, email))) {
    res.status(202).json({ accepted: true });
    return;
  }

  // Respond before account-specific writes or provider delivery so the public
  // request path is not an email-enumeration timing oracle.
  res.status(202).json({ accepted: true });
  void (async () => {
    let resetTokenHash: string | null = null;
    try {
      const profileWhere = options.staffOnly
        ? and(
            eq(profilesTable.email, email),
            eq(profilesTable.status, "active"),
            inArray(profilesTable.role, staffRoles),
          )
        : and(eq(profilesTable.email, email), eq(profilesTable.status, "active"));
      const [profile] = await db
        .select({ id: profilesTable.id, email: profilesTable.email })
        .from(profilesTable)
        .where(profileWhere)
        .limit(1);
      if (!profile) return;

      const token = randomBytes(48).toString("base64url");
      resetTokenHash = tokenHash(token);
      const expiresAt = new Date(Date.now() + passwordResetLifetimeMs);
      await db
        .update(passwordResetTokensTable)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokensTable.profileId, profile.id), isNull(passwordResetTokensTable.usedAt)));
      await db.insert(passwordResetTokensTable).values({
        profileId: profile.id,
        tokenHash: resetTokenHash,
        expiresAt,
      });

      const resetUrl = new URL(options.resetPath, options.appUrl());
      resetUrl.searchParams.set("token", token);
      await sendPasswordResetEmail({
        recipient: profile.email,
        resetUrl: resetUrl.toString(),
        expiresInMinutes: passwordResetLifetimeMs / 60_000,
      });
      req.log.info({ profileId: profile.id }, "Password reset email sent");
    } catch (error) {
      if (resetTokenHash) {
        await db
          .update(passwordResetTokensTable)
          .set({ usedAt: new Date() })
          .where(eq(passwordResetTokensTable.tokenHash, resetTokenHash))
          .catch((cleanupError) => req.log.error({ err: cleanupError }, "Password reset token cleanup failed"));
      }
      req.log.error(
        {
          err: error,
          ...(error instanceof EmailProviderError
            ? {
                emailProvider: error.provider,
                providerStatus: error.status,
                providerResponse: error.responseBody,
              }
            : {}),
        },
        "Password reset email delivery failed",
      );
    }
  })();
}

router.post("/auth/password-reset", async (req, res): Promise<void> => {
  await requestPasswordReset(req, res, {
    resetPath: passwordResetPath,
    appUrl: customerAppUrl,
  });
});

router.post("/auth/admin/password-reset", async (req, res): Promise<void> => {
  await requestPasswordReset(req, res, {
    resetPath: adminPasswordResetPath,
    appUrl: adminAppUrl,
    staffOnly: true,
  });
});

async function confirmPasswordReset(
  req: Request,
  res: Response,
  options: { adminSession?: boolean } = {},
): Promise<void> {
  const body = req.body as { token?: unknown; password?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!token || token.length > 256) {
    res.status(400).json({ error: "This password reset link is invalid or malformed." });
    return;
  }
  if (password.length < 10 || password.length > 256) {
    res.status(400).json({ error: "Choose a password between 10 and 256 characters." });
    return;
  }

  const [record] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.tokenHash, tokenHash(token)))
    .limit(1);
  if (!record) {
    res.status(400).json({ error: "This password reset link is invalid or malformed." });
    return;
  }
  if (record.usedAt) {
    res.status(410).json({ error: "This password reset link has already been used. Request a new one to continue." });
    return;
  }
  if (record.expiresAt <= new Date()) {
    res.status(410).json({ error: "This password reset link has expired. Request a new one to continue." });
    return;
  }

  const [eligibleProfile] = await db
    .select({ role: profilesTable.role })
    .from(profilesTable)
    .where(
      and(
        eq(profilesTable.id, record.profileId),
        eq(profilesTable.status, "active"),
        ...(options.adminSession ? [inArray(profilesTable.role, staffRoles)] : []),
      ),
    )
    .limit(1);
  if (!eligibleProfile) {
    res.status(400).json({ error: "This password reset link is not valid for this application." });
    return;
  }
  const [security] = options.adminSession
    ? await db
        .select({ sessionTimeoutMinutes: securitySettingsTable.sessionTimeoutMinutes })
        .from(securitySettingsTable)
        .where(eq(securitySettingsTable.id, "security"))
        .limit(1)
    : [];
  const configuredMinutes = Number(security?.sessionTimeoutMinutes);
  const resetSessionLifetime = options.adminSession
    && Number.isInteger(configuredMinutes)
    && configuredMinutes >= 15
    && configuredMinutes <= 1440
      ? configuredMinutes * 60_000
      : sessionLifetimeMs;

  const session = await db.transaction(async (tx) => {
    const now = new Date();
    const [consumed] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokensTable.id, record.id),
          isNull(passwordResetTokensTable.usedAt),
          gt(passwordResetTokensTable.expiresAt, now),
        ),
      )
      .returning({ profileId: passwordResetTokensTable.profileId });
    if (!consumed) return null;

    const [profile] = await tx
      .update(profilesTable)
      .set({ passwordHash: await passwordHash(password), updatedAt: now })
      .where(and(eq(profilesTable.id, consumed.profileId), eq(profilesTable.status, "active")))
      .returning();
    if (!profile) return null;

    await tx
      .update(sessionsTable)
      .set({ revokedAt: now })
      .where(eq(sessionsTable.profileId, profile.id));

    const newToken = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + resetSessionLifetime);
    await tx.insert(sessionsTable).values({
      profileId: profile.id,
      tokenHash: tokenHash(newToken),
      expiresAt,
      userAgent: req.get("user-agent")?.slice(0, 512) ?? null,
    });
    return { profile, token: newToken, expiresAt };
  });

  if (!session) {
    const [latest] = await db
      .select({ usedAt: passwordResetTokensTable.usedAt, expiresAt: passwordResetTokensTable.expiresAt })
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.tokenHash, tokenHash(token)))
      .limit(1);
    if (latest?.usedAt) {
      res.status(410).json({ error: "This password reset link has already been used. Request a new one to continue." });
      return;
    }
    res.status(410).json({ error: "This password reset link has expired. Request a new one to continue." });
    return;
  }

  if (options.adminSession) {
    setAdminSessionCookie(res, session.token, session.expiresAt);
  } else {
    setSessionCookie(res, session.token, session.expiresAt);
  }
  req.log.info({ profileId: session.profile.id }, "Password reset completed");
  res.json(authResponse(session.profile));
}

router.post("/auth/password-reset/confirm", async (req, res): Promise<void> => {
  await confirmPasswordReset(req, res);
});

router.post("/auth/admin/password-reset/confirm", async (req, res): Promise<void> => {
  await confirmPasswordReset(req, res, { adminSession: true });
});

export default router;

const sessionCookieDomain = isProduction
  ? process.env.SESSION_COOKIE_DOMAIN?.trim() || ".anythinganywhere.com"
  : undefined;
