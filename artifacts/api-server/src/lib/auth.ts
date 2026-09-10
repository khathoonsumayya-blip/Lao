import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db, driversTable, profilesTable, sessionsTable, type Profile } from "@workspace/db";

export type AuthContext = {
  profileId: string;
  authUserId: string;
  role: Profile["role"];
  driverId: string | null;
  authMethod: "bearer" | "cookie" | "demo";
};

const developmentDemoAuthUserId = "10000000-0000-4000-8000-000000000011";

function tokenFromRequest(req: Request): { token: string; authMethod: "bearer" | "cookie" } | null {
  const bearer = req.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const token = bearer.slice("Bearer ".length).trim();
    return token ? { token, authMethod: "bearer" } : null;
  }
  const requiresAdminCookie =
    req.originalUrl.startsWith("/api/admin") ||
    (req.originalUrl.startsWith("/api/auth/session") &&
      req.query.admin === "true");
  const cookieName = requiresAdminCookie ? "aa_admin_session" : "aa_session";
  return typeof req.cookies?.[cookieName] === "string"
    ? { token: req.cookies[cookieName], authMethod: "cookie" }
    : null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function contextForProfile(
  profile: Profile,
  authMethod: AuthContext["authMethod"],
): Promise<AuthContext> {
  const [driver] = await db
    .select({ id: driversTable.id })
    .from(driversTable)
    .where(eq(driversTable.profileId, profile.id))
    .limit(1);

  return {
    profileId: profile.id,
    authUserId: profile.authUserId,
    role: profile.role,
    driverId: driver?.id ?? null,
    authMethod,
  };
}

export async function authenticateRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = tokenFromRequest(req);
    if (session) {
      const [result] = await db
        .select({ profile: profilesTable })
        .from(sessionsTable)
        .innerJoin(profilesTable, eq(sessionsTable.profileId, profilesTable.id))
        .where(
          and(
            eq(sessionsTable.tokenHash, tokenHash(session.token)),
            isNull(sessionsTable.revokedAt),
            gt(sessionsTable.expiresAt, new Date()),
            eq(profilesTable.status, "active"),
          ),
        )
        .limit(1);
      if (result) res.locals.auth = await contextForProfile(result.profile, session.authMethod);
    } else if (
      process.env.NODE_ENV !== "production" &&
      process.env.ALLOW_DEMO_SESSION !== "false"
    ) {
      // Development-only compatibility path. It does not create records and is
      // intentionally disabled in production. Seed data must be explicitly run.
      const [profile] = await db
        .select()
        .from(profilesTable)
        .where(
          and(
            eq(profilesTable.authUserId, developmentDemoAuthUserId),
            eq(profilesTable.status, "active"),
          ),
        )
        .limit(1);
      if (profile) res.locals.auth = await contextForProfile(profile, "demo");
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(...roles: Profile["role"][]): RequestHandler {
  return (req, res, next) => {
    const auth = res.locals.auth as AuthContext | undefined;
    if (!auth) {
      req.log.warn("Unauthenticated API request");
      res.status(401).json({ error: "Sign in is required for this request." });
      return;
    }
    if (!roles.includes(auth.role)) {
      req.log.warn({ profileId: auth.profileId, role: auth.role }, "Forbidden API request");
      res.status(403).json({ error: "You do not have access to this resource." });
      return;
    }
    next();
  };
}

export function requireAdminRoles(...roles: Profile["role"][]): RequestHandler {
  return (req, res, next) => {
    const auth = res.locals.auth as AuthContext | undefined;
    if (!auth || auth.authMethod === "demo") {
      req.log.warn("Unauthenticated Admin API request");
      res.status(401).json({ error: "Sign in is required for this request." });
      return;
    }
    if (!roles.includes(auth.role)) {
      req.log.warn({ profileId: auth.profileId, role: auth.role }, "Forbidden Admin API request");
      res.status(403).json({ error: "You do not have access to this resource." });
      return;
    }
    next();
  };
}

export function currentAuth(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth) throw new Error("Authenticated route missing auth context.");
  return auth;
}