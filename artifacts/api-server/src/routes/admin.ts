import { and, desc, eq, gte, ilike, inArray, isNull, lt, notInArray, or, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  adminAuditLogsTable,
  db,
  deliveriesTable,
  driverApplicationsTable,
  driverDocumentsTable,
  driverEarningsTable,
  driverIncidentsTable,
  driversTable,
  paymentsTable,
  profilesTable,
  promoCodesTable,
  promotionRedemptionsTable,
  ratingsTable,
  refundOperationsTable,
  generalSettingsTable,
  securitySettingsTable,
  paymentFeeSettingsTable,
  emailSettingsTable,
  dispatchSettingsTable,
  sessionsTable,
  supportTicketCommentsTable,
  supportConversationEntriesTable,
  notificationsTable,
  supportTicketsTable,
} from "@workspace/db";
import {
  GetAdminSettingsResponse,
  GetAdminCustomerResponse,
  ListAdminCustomersResponse,
  ListAdminPaymentsResponse,
  ListAdminSettingsUsersResponse,
  RevokeAdminSettingsUserSessionsParams,
  RevokeAdminSettingsUserSessionsResponse,
  UpdateAdminGeneralSettingsBody,
  UpdateAdminGeneralSettingsResponse,
  UpdateAdminCustomerStatusBody,
  UpdateAdminCustomerStatusParams,
  UpdateAdminCustomerStatusResponse,
  UpdateAdminSettingsUserBody,
  UpdateAdminSettingsUserParams,
  UpdateAdminSettingsUserResponse,
  ListAdminSupportTicketsResponse,
  UpdateAdminSupportTicketBody,
  UpdateAdminSupportTicketResponse,
  GetAdminSecuritySettingsResponse,
  UpdateAdminSecuritySettingsBody,
  UpdateAdminSecuritySettingsResponse,
  RevokeOtherAdminSessionsResponse,
  GetAdminPaymentFeeSettingsResponse,
  UpdateAdminPaymentFeeSettingsBody,
  UpdateAdminPaymentFeeSettingsResponse,
  GetAdminEmailSettingsResponse,
  UpdateAdminEmailSettingsBody,
  UpdateAdminEmailSettingsResponse,
  CreateAdminPromotionBody,
  CreateAdminPromotionResponse,
  UpdateAdminPromotionParams,
  UpdateAdminPromotionBody,
  UpdateAdminPromotionResponse,
  UpdateAdminPromotionStatusParams,
  UpdateAdminPromotionStatusBody,
  UpdateAdminPromotionStatusResponse,
  GetAdminIntegrationHealthResponse,
  GetAdminSystemStatusResponse,
  GetAdminDispatchSettingsResponse,
  UpdateAdminDispatchSettingsBody,
  UpdateAdminDispatchSettingsResponse,
} from "@workspace/api-zod";
import { currentAuth, requireAdminRoles } from "../lib/auth";
import { reviewDriverProfileUpdate } from "../lib/driver-service";
import { createDriverDocumentDownloadUrl } from "../lib/private-document-storage";
import { getStripeCredentials, getUncachableStripeClient } from "../lib/stripe-client";
import { publishAdminUpdate } from "../lib/delivery-events";
import { sendAdminTestEmail } from "../lib/resend";

const router: IRouter = Router();
const driverDecisions = new Set(["approved", "rejected", "suspended"]);
const documentDecisions = new Set(["approved", "rejected"]);
const verificationStatuses = new Set(["not_started", "pending", "clear", "review"]);
const ticketStatuses = new Set(["open", "in_progress", "resolved"]);
const ticketPriorities = new Set(["low", "normal", "high", "urgent"]);
const resolvedByProfiles = alias(profilesTable, "support_ticket_resolver");
const assignedToProfiles = alias(profilesTable, "support_ticket_assignee");

// Deployments apply the migration that converts this former UI-only value.
// Keep list reads safe during a rolling migration (and for restored backups).
function canonicalTicketStatus(status: string): "open" | "in_progress" | "resolved" {
  return status === "escalated" ? "in_progress" : status === "resolved" ? "resolved" : status === "in_progress" ? "in_progress" : "open";
}
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const pendingComplianceKeys = new Set([
  "vehicleType", "vehicleYear", "vehicleMake", "vehicleModel", "vehicleColor", "licensePlate",
  "licenseState", "licenseLastFour", "insuranceProvider", "insuranceExpiresAt",
]);

function rawValue(body: unknown, key: string): string {
  return body && typeof body === "object" && typeof (body as Record<string, unknown>)[key] === "string"
    ? (body as Record<string, string>)[key]
    : "";
}

function value(body: unknown, key: string): string {
  return rawValue(body, key).trim();
}

function number(valueToConvert: unknown): number {
  const result = Number(valueToConvert);
  return Number.isFinite(result) ? result : 0;
}

function routeId(valueToConvert: string | string[] | undefined): string {
  return Array.isArray(valueToConvert) ? valueToConvert[0] ?? "" : valueToConvert ?? "";
}

function pendingComplianceProjection(application: typeof driverApplicationsTable.$inferSelect | null | undefined) {
  const pendingProfileChanges = application?.pendingProfileChanges
    ? Object.fromEntries(Object.entries(application.pendingProfileChanges)
      .filter(([key, value]) => pendingComplianceKeys.has(key) && (typeof value === "string" || (key === "vehicleYear" && typeof value === "number"))))
    : null;
  return {
    complianceReviewStatus: (application?.pendingProfileReviewStatus === "pending" ||
      application?.pendingProfileReviewStatus === "approved" ||
      application?.pendingProfileReviewStatus === "rejected"
      ? application.pendingProfileReviewStatus
      : "none") as "none" | "pending" | "approved" | "rejected",
    pendingProfileChanges: pendingProfileChanges && Object.keys(pendingProfileChanges).length ? pendingProfileChanges : null,
    pendingProfileSubmittedAt: application?.pendingProfileSubmittedAt?.toISOString() ?? null,
    complianceReviewReason: application?.pendingProfileReviewReason ?? null,
  };
}

type VerificationRequirement = { code: string; message: string };

function approvalRequirements(
  driver: typeof driversTable.$inferSelect,
  profile: Pick<typeof profilesTable.$inferSelect, "status"> | undefined,
  application: typeof driverApplicationsTable.$inferSelect | undefined,
  documents: Array<typeof driverDocumentsTable.$inferSelect>,
): VerificationRequirement[] {
  const requirements: VerificationRequirement[] = [];
  if (!application) requirements.push({ code: "APPLICATION_MISSING", message: "A driver application is required before approval." });
  if (driver.onboardingStatus !== "submitted") requirements.push({ code: "ONBOARDING_NOT_SUBMITTED", message: "Driver onboarding must be submitted before approval." });
  const fields = [profile?.status, application?.licenseState, application?.licenseLastFour, application?.insuranceProvider, application?.insuranceExpiresAt, driver.vehicleType, driver.vehicleMake, driver.vehicleModel, driver.vehicleColor, driver.licensePlate];
  if (!fields.every((field) => field != null && String(field).trim() !== "")) requirements.push({ code: "ONBOARDING_FIELDS_INCOMPLETE", message: "All required onboarding fields must be complete." });
  const latest = new Map<string, typeof documents[number]>();
  for (const document of documents) if (!latest.has(document.documentType)) latest.set(document.documentType, document);
  const now = new Date();
  for (const [type, code] of [["license", "LICENSE"], ["insurance", "INSURANCE"], ["vehicle_registration", "VEHICLE_REGISTRATION"]] as const) {
    const document = latest.get(type);
    if (!document) requirements.push({ code: `${code}_DOCUMENT_MISSING`, message: `${type.replace("_", " ")} document is required.` });
    else {
      if (document.verificationStatus !== "approved") requirements.push({ code: `${code}_DOCUMENT_NOT_APPROVED`, message: `${type.replace("_", " ")} document must be approved.` });
      if (document.expiryDate && new Date(`${document.expiryDate}T00:00:00.000Z`) <= now) requirements.push({ code: `${code}_DOCUMENT_EXPIRED`, message: `${type.replace("_", " ")} document must not be expired.` });
    }
  }
  if (!application?.insuranceExpiresAt || application.insuranceExpiresAt <= now) requirements.push({ code: "INSURANCE_EXPIRED", message: "Insurance expiration must be in the future." });
  if (application?.backgroundCheckStatus !== "clear") requirements.push({ code: "BACKGROUND_CHECK_NOT_CLEAR", message: "Background check must be clear before approval." });
  if (application?.mvrCheckStatus !== "clear") requirements.push({ code: "MVR_NOT_CLEAR", message: "MVR must be clear before approval." });
  if (profile?.status !== "active" || driver.approvalStatus === "suspended") requirements.push({ code: "ACCOUNT_NOT_ELIGIBLE", message: "Driver account must be active and not suspended." });
  return requirements;
}

type AnalyticsPeriod = {
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
};

function analyticsPeriod(query: Record<string, unknown>): { period?: AnalyticsPeriod; error?: string } {
  const today = new Date();
  const defaultEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const defaultStart = new Date(defaultEnd);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 30);
  const startDate = typeof query.startDate === "string" && query.startDate ? query.startDate : defaultStart.toISOString().slice(0, 10);
  const endDate = typeof query.endDate === "string" && query.endDate ? query.endDate : defaultEnd.toISOString().slice(0, 10);

  if (!dateOnlyPattern.test(startDate) || !dateOnlyPattern.test(endDate)) {
    return { error: "Reporting dates must use YYYY-MM-DD format." };
  }

  const parseDateOnly = (dateString: string): Date | null => {
    const [year, month, day] = dateString.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? parsed : null;
  };
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) {
    return { error: "Reporting dates must be valid calendar dates." };
  }
  if (start > end) {
    return { error: "The report start date must be on or before the end date." };
  }
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  if (endExclusive.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1_000) {
    return { error: "Reports can cover at most 366 days." };
  }
  return { period: { startDate, endDate, start, endExclusive } };
}

function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

router.get("/admin/dashboard", requireAdminRoles("admin", "dispatcher", "support"), async (_req, res): Promise<void> => {
  const canViewRevenue = currentAuth(res).role === "admin";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const trendStart = new Date(today);
  trendStart.setDate(trendStart.getDate() - 29);
  const [recentDeliveries, activeDeliveries, searchingDrivers, todayCompletions, todayCancellations, onlineDrivers] = await Promise.all([
    db.select().from(deliveriesTable).where(gte(deliveriesTable.createdAt, trendStart)),
    db.select({ id: deliveriesTable.id }).from(deliveriesTable).where(notInArray(deliveriesTable.deliveryStatus, ["delivered", "cancelled", "failed", "refunded"])),
    db.select({ id: deliveriesTable.id }).from(deliveriesTable).where(eq(deliveriesTable.deliveryStatus, "searching_driver")),
    db.select().from(deliveriesTable).where(and(eq(deliveriesTable.deliveryStatus, "delivered"), gte(deliveriesTable.deliveredAt, today))),
    db.select({ id: deliveriesTable.id }).from(deliveriesTable).where(and(eq(deliveriesTable.deliveryStatus, "cancelled"), gte(deliveriesTable.cancelledAt, today))),
    db.select({ id: driversTable.id }).from(driversTable).where(eq(driversTable.availabilityStatus, "available")),
  ]);
  const recentPaidPayments = canViewRevenue
    ? await db.select({ amount: paymentsTable.amount, createdAt: paymentsTable.createdAt }).from(paymentsTable)
      .where(and(eq(paymentsTable.status, "paid"), gte(paymentsTable.createdAt, trendStart)))
    : [];
  const paidToday = canViewRevenue
    ? recentPaidPayments.filter((payment) => payment.createdAt >= today)
    : [];
  const deliveriesToday = recentDeliveries.filter((delivery) => delivery.createdAt >= today);
  const durations = todayCompletions
    .filter((delivery) => delivery.deliveredAt && delivery.pickedUpAt)
    .map((delivery) => (delivery.deliveredAt!.getTime() - delivery.pickedUpAt!.getTime()) / 60_000);
  const revenue = paidToday.reduce((sum, payment) => sum + number(payment.amount), 0);
  const trend = new Map<string, { deliveries: number; revenue?: number }>();
  for (const delivery of recentDeliveries) {
    const day = delivery.createdAt.toISOString().slice(0, 10);
    const current = trend.get(day) ?? { deliveries: 0, ...(canViewRevenue ? { revenue: 0 } : {}) };
    current.deliveries += 1;
    trend.set(day, current);
  }
  if (canViewRevenue) for (const payment of recentPaidPayments) {
    const day = payment.createdAt.toISOString().slice(0, 10);
    const current = trend.get(day) ?? { deliveries: 0, revenue: 0 };
    current.revenue = (current.revenue ?? 0) + number(payment.amount);
    trend.set(day, current);
  }

  res.json({
    deliveriesToday: deliveriesToday.length,
    activeDeliveries: activeDeliveries.length,
    searchingForDriver: searchingDrivers.length,
    driversOnline: onlineDrivers.length,
    completedToday: todayCompletions.length,
    cancelledToday: todayCancellations.length,
    ...(canViewRevenue ? { revenue: Math.round(revenue * 100) / 100 } : {}),
    averageDeliveryMinutes: durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : null,
    trend: Array.from(trend.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, values]) => ({ date, deliveries: values.deliveries, ...(canViewRevenue ? { revenue: values.revenue ?? 0 } : {}) })),
  });
});

router.get("/admin/driver-review", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const isAdmin = currentAuth(res).role === "admin";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const rawSearch = typeof req.query.search === "string" ? req.query.search : "";
  if (rawSearch.length > 120) {
    res.status(400).json({ error: "Search must be at most 120 characters." });
    return;
  }
  const search = rawSearch.trim();
  const conditions = [];
  if (status && ["pending", "approved", "rejected", "suspended"].includes(status)) {
    conditions.push(eq(driversTable.approvalStatus, status));
  }
  if (search) {
    const match = `%${search.slice(0, 120)}%`;
    conditions.push(or(ilike(profilesTable.firstName, match), ilike(profilesTable.lastName, match), ilike(profilesTable.email, match)));
  }
  const rows = await db
    .select({
      id: driversTable.id,
      profileId: profilesTable.id,
      firstName: profilesTable.firstName,
      lastName: profilesTable.lastName,
      email: profilesTable.email,
      phone: profilesTable.phone,
      avatarUrl: profilesTable.avatarUrl,
      accountStatus: profilesTable.status,
      approvalStatus: driversTable.approvalStatus,
      onboardingStatus: driversTable.onboardingStatus,
      availabilityStatus: driversTable.availabilityStatus,
      rating: driversTable.rating,
      totalDeliveries: driversTable.totalDeliveries,
      vehicleType: driversTable.vehicleType,
      vehicleYear: driversTable.vehicleYear,
      vehicleMake: driversTable.vehicleMake,
      vehicleModel: driversTable.vehicleModel,
      vehicleColor: driversTable.vehicleColor,
      licensePlate: driversTable.licensePlate,
      updatedAt: driversTable.updatedAt,
      application: driverApplicationsTable,
    })
    .from(driversTable)
    .innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
    .leftJoin(driverApplicationsTable, eq(driverApplicationsTable.driverId, driversTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(driversTable.updatedAt))
    .limit(200);
  const response = await Promise.all(rows.map(async (driver) => {
    const [[activeDelivery], earnings] = await Promise.all([
      db.select({ id: deliveriesTable.publicDeliveryId, orderNumber: deliveriesTable.orderNumber, status: deliveriesTable.deliveryStatus })
        .from(deliveriesTable)
        .where(and(eq(deliveriesTable.driverId, driver.id), notInArray(deliveriesTable.deliveryStatus, ["delivered", "cancelled", "failed", "refunded"])))
        .orderBy(desc(deliveriesTable.updatedAt)).limit(1),
      db.select({ netAmount: driverEarningsTable.netAmount, status: driverEarningsTable.status })
        .from(driverEarningsTable).where(eq(driverEarningsTable.driverId, driver.id)),
    ]);
    const earningsTotal = earnings.reduce((sum, earning) => sum + number(earning.netAmount), 0);
    const operationalRecord = {
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      // Driver photos are private documents and are never served as profile URLs.
      avatarUrl: null,
      approvalStatus: driver.approvalStatus,
      availabilityStatus: driver.availabilityStatus,
      totalDeliveries: number(driver.totalDeliveries),
      vehicleType: driver.vehicleType,
      vehicleYear: driver.vehicleYear ? Number(driver.vehicleYear) : null,
      vehicleMake: driver.vehicleMake,
      vehicleModel: driver.vehicleModel,
      vehicleColor: driver.vehicleColor,
      vehicle: [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(" ") || null,
      updatedAt: driver.updatedAt.toISOString(),
      onboardingStatus: driver.application?.submittedAt ? driver.onboardingStatus : "pending",
      activeDelivery: activeDelivery ?? null,
      earningsTotal: Math.round(earningsTotal * 100) / 100,
      earningsCount: earnings.length,
    };
    return isAdmin
      ? {
          ...operationalRecord,
          profileId: driver.profileId,
          email: driver.email,
          phone: driver.phone,
          accountStatus: driver.accountStatus,
          licensePlate: driver.licensePlate,
          rating: number(driver.rating),
          ...pendingComplianceProjection(driver.application),
        }
      : operationalRecord;
   }));
  res.json(response);
});

router.get("/admin/drivers/:id/review", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const isAdmin = currentAuth(res).role === "admin";
  const [driver] = await db
    .select({
      id: driversTable.id,
      profileId: profilesTable.id,
      firstName: profilesTable.firstName,
      lastName: profilesTable.lastName,
      email: profilesTable.email,
      phone: profilesTable.phone,
      avatarUrl: profilesTable.avatarUrl,
      accountStatus: profilesTable.status,
      approvalStatus: driversTable.approvalStatus,
      availabilityStatus: driversTable.availabilityStatus,
      rating: driversTable.rating,
      totalDeliveries: driversTable.totalDeliveries,
      vehicleType: driversTable.vehicleType,
      vehicleYear: driversTable.vehicleYear,
      vehicleMake: driversTable.vehicleMake,
      vehicleModel: driversTable.vehicleModel,
      vehicleColor: driversTable.vehicleColor,
      licensePlate: driversTable.licensePlate,
    })
    .from(driversTable)
    .innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
    .where(eq(driversTable.id, routeId(req.params.id)))
    .limit(1);
  if (!driver) {
    res.status(404).json({ error: "Driver not found." });
    return;
  }
  const operationalDriver = {
    id: driver.id,
    firstName: driver.firstName,
    lastName: driver.lastName,
    avatarUrl: null,
    approvalStatus: driver.approvalStatus,
    availabilityStatus: driver.availabilityStatus,
    totalDeliveries: number(driver.totalDeliveries),
    vehicleType: driver.vehicleType,
      vehicleYear: driver.vehicleYear ? Number(driver.vehicleYear) : null,
    vehicleMake: driver.vehicleMake,
    vehicleModel: driver.vehicleModel,
    vehicleColor: driver.vehicleColor,
  };
  const deliveries = await db
    .select({ id: deliveriesTable.publicDeliveryId, orderNumber: deliveriesTable.orderNumber, status: deliveriesTable.deliveryStatus, createdAt: deliveriesTable.createdAt })
    .from(deliveriesTable).where(eq(deliveriesTable.driverId, driver.id)).orderBy(desc(deliveriesTable.createdAt)).limit(50);
  if (!isAdmin) {
    res.json({
      driver: operationalDriver,
      deliveries: deliveries.map((delivery) => ({ ...delivery, createdAt: delivery.createdAt.toISOString() })),
    });
    return;
  }
  const [application] = await db.select().from(driverApplicationsTable).where(eq(driverApplicationsTable.driverId, driver.id)).limit(1);
  const [documents, incidents, ratings, earnings] = await Promise.all([
    db.select().from(driverDocumentsTable).where(eq(driverDocumentsTable.driverId, driver.id)).orderBy(desc(driverDocumentsTable.updatedAt)),
    db.select().from(driverIncidentsTable).where(eq(driverIncidentsTable.driverId, driver.id)).orderBy(desc(driverIncidentsTable.createdAt)).limit(50),
    db.select().from(ratingsTable).where(eq(ratingsTable.driverId, driver.id)).orderBy(desc(ratingsTable.createdAt)).limit(50),
    db.select().from(driverEarningsTable).where(eq(driverEarningsTable.driverId, driver.id)).orderBy(desc(driverEarningsTable.createdAt)).limit(50),
  ]);
  res.json({
    driver: { ...driver, avatarUrl: null, rating: number(driver.rating), totalDeliveries: number(driver.totalDeliveries) },
    application: application ? {
      licenseState: application.licenseState,
      licenseLastFour: application.licenseLastFour,
      insuranceProvider: application.insuranceProvider,
      insuranceExpiresAt: application.insuranceExpiresAt?.toISOString() ?? null,
      backgroundCheckStatus: application.backgroundCheckStatus,
      backgroundCheckedAt: application.backgroundCheckedAt?.toISOString() ?? null,
      backgroundCheckReason: application.backgroundCheckReason,
      backgroundCheckReference: application.backgroundCheckReference,
      mvrCheckStatus: application.mvrCheckStatus,
      mvrCheckedAt: application.mvrCheckedAt?.toISOString() ?? null,
      mvrCheckReason: application.mvrCheckReason,
      mvrCheckReference: application.mvrCheckReference,
      submittedAt: application.submittedAt?.toISOString() ?? null,
    } : null,
    ...pendingComplianceProjection(application),
    documents: documents.map((document) => ({
      id: document.id,
      documentType: document.documentType,
      verificationStatus: document.verificationStatus,
      expiryDate: document.expiryDate,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    })),
    incidents: incidents.map((incident) => ({ ...incident, createdAt: incident.createdAt.toISOString(), updatedAt: incident.updatedAt.toISOString() })),
    ratings: ratings.map((rating) => ({ ...rating, createdAt: rating.createdAt.toISOString() })),
    earnings: earnings.map((earning) => ({ ...earning, grossAmount: number(earning.grossAmount), adjustmentAmount: number(earning.adjustmentAmount), netAmount: number(earning.netAmount), createdAt: earning.createdAt.toISOString() })),
    deliveries: deliveries.map((delivery) => ({ ...delivery, createdAt: delivery.createdAt.toISOString() })),
  });
});

router.post("/admin/drivers/:id/decision", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const decision = value(req.body, "decision");
  const reason = value(req.body, "reason");
  if (!driverDecisions.has(decision) || rawValue(req.body, "reason").length > 500 || (reason.length > 0 && reason.length < 3) || ((decision === "rejected" || decision === "suspended") && reason.length < 3)) {
    res.status(400).json({ error: "Choose an approval decision and include a reason when rejecting or suspending a driver." });
    return;
  }
  const accountStatus = decision === "suspended" ? "suspended" : "active";
  const result = await db.transaction(async (tx) => {
    const [driver] = await tx
      .select()
      .from(driversTable)
      .where(eq(driversTable.id, routeId(req.params.id)))
      .for("update")
      .limit(1);
    if (!driver) return null;
    const [profile] = await tx.select({ status: profilesTable.status }).from(profilesTable).where(eq(profilesTable.id, driver.profileId)).for("update").limit(1);
    const [application] = await tx.select().from(driverApplicationsTable).where(eq(driverApplicationsTable.driverId, driver.id)).for("update").limit(1);
    const documents = await tx.select().from(driverDocumentsTable).where(eq(driverDocumentsTable.driverId, driver.id)).orderBy(desc(driverDocumentsTable.createdAt)).for("update");
    if (decision === "approved") {
      const requirements = approvalRequirements(driver, profile, application, documents);
      if (requirements.length) return { driver: null, requirements };
    }
    await tx.update(driversTable).set({
      approvalStatus: decision,
      onboardingStatus: decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : driver.onboardingStatus,
      availabilityStatus: "offline",
    }).where(eq(driversTable.id, driver.id));
    await tx.update(profilesTable).set({ status: accountStatus }).where(eq(profilesTable.id, driver.profileId));
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId: currentAuth(res).profileId,
      action: `driver.${decision}`,
      entityType: "driver",
      entityId: driver.id,
      metadata: {
        reason: reason || null,
        previousApprovalStatus: driver.approvalStatus,
        previousAccountStatus: profile?.status ?? null,
        approvalStatus: decision,
        accountStatus,
      },
    });
    return { driver, requirements: [] };
  });
  if (!result) {
    res.status(404).json({ error: "Driver not found." });
    return;
  }
  if (!result.driver) {
    res.status(409).json({ error: "Driver verification incomplete", requirements: result.requirements });
    return;
  }
  res.json({ id: result.driver.id, approvalStatus: decision, accountStatus });
  publishAdminUpdate();
});

router.post("/admin/drivers/:id/profile-review", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const decision = value(req.body, "decision");
  const reason = value(req.body, "reason");
  if (!documentDecisions.has(decision) || rawValue(req.body, "reason").length > 500 || (decision === "rejected" && reason.length < 3)) {
    res.status(400).json({ error: "Choose approve or reject and provide a reason for rejection." });
    return;
  }
  const result = await reviewDriverProfileUpdate(
    routeId(req.params.id),
    currentAuth(res).profileId,
    decision as "approved" | "rejected",
    reason,
  );
  if (result === null) {
    res.status(404).json({ error: "Driver not found." });
    return;
  }
  if (result === "not_pending") {
    res.status(409).json({ error: "There is no pending profile update to review." });
    return;
  }
  res.json(result);
  publishAdminUpdate();
});

router.post("/admin/driver-documents/:id/review", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const decision = value(req.body, "decision");
  const reason = value(req.body, "reason");
  if (!documentDecisions.has(decision) || rawValue(req.body, "reason").length > 500 || (reason.length > 0 && reason.length < 3) || (decision === "rejected" && reason.length < 3)) {
    res.status(400).json({ error: "Choose approve or reject and provide a reason for rejection." });
    return;
  }
  const actorProfileId = currentAuth(res).profileId;
  const document = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(driverDocumentsTable)
      .where(eq(driverDocumentsTable.id, routeId(req.params.id)))
      .for("update")
      .limit(1);
    if (!current) return null;
    const [updated] = await tx
      .update(driverDocumentsTable)
      .set({ verificationStatus: decision, rejectionReason: decision === "rejected" ? reason : null })
      .where(eq(driverDocumentsTable.id, current.id))
      .returning();
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId,
      action: `driver_document.${decision}`,
      entityType: "driver_document",
      entityId: updated.id,
      metadata: {
        driverId: updated.driverId,
        documentType: updated.documentType,
        reason: reason || null,
        previousVerificationStatus: current.verificationStatus,
        verificationStatus: updated.verificationStatus,
      },
    });
    return updated;
  });
  if (!document) {
    res.status(404).json({ error: "Driver document not found." });
    return;
  }
  res.json({ id: document.id, verificationStatus: document.verificationStatus });
  publishAdminUpdate();
});

router.post("/admin/driver-documents/:id/download-url", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const [document] = await db.select().from(driverDocumentsTable).where(eq(driverDocumentsTable.id, routeId(req.params.id))).limit(1);
  if (!document) {
    res.status(404).json({ error: "Driver document not found." });
    return;
  }
  try {
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const url = await createDriverDocumentDownloadUrl(document.driverId, document.storagePath);
    await db.insert(adminAuditLogsTable).values({
      actorProfileId: currentAuth(res).profileId,
      action: "driver_document.download_url_created",
      entityType: "driver_document",
      entityId: document.id,
      metadata: { driverId: document.driverId },
    });
    res.json({ url, expiresAt });
  } catch {
    res.status(404).json({ error: "Private document is unavailable." });
  }
});

async function adjudicateDriverCheck(
  req: Request,
  res: Response,
  check: "background" | "mvr",
): Promise<void> {
  const status = value(req.body, "status");
  const reason = value(req.body, "reason");
  const reference = value(req.body, "reference");
  if (!verificationStatuses.has(status) || rawValue(req.body, "reason").length > 500 || rawValue(req.body, "reference").length > 500 || ((status === "review") && reason.length < 3)) {
    res.status(400).json({ error: "Choose a valid verification status and provide a reason when review is required." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [driver] = await tx.select().from(driversTable).where(eq(driversTable.id, routeId(req.params.id))).for("update").limit(1);
    if (!driver) return "driver_missing" as const;
    const [application] = await tx.select().from(driverApplicationsTable).where(eq(driverApplicationsTable.driverId, driver.id)).for("update").limit(1);
    if (!application) return "application_missing" as const;
    const completedAt = status === "clear" || status === "review" ? new Date() : null;
    const update = check === "background"
      ? { backgroundCheckStatus: status, backgroundCheckedAt: completedAt, backgroundCheckReason: reason || null, backgroundCheckReference: reference || null }
      : { mvrCheckStatus: status, mvrCheckedAt: completedAt, mvrCheckReason: reason || null, mvrCheckReference: reference || null };
    await tx.update(driverApplicationsTable).set(update).where(eq(driverApplicationsTable.id, application.id));
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId: currentAuth(res).profileId,
      action: `driver.${check}_check.adjudicated`,
      entityType: "driver",
      entityId: driver.id,
      metadata: { status, reason: reason || null, reference: reference || null },
    });
    return { status, checkedAt: completedAt?.toISOString() ?? null };
  });
  if (result === "driver_missing") { res.status(404).json({ error: "Driver not found." }); return; }
  if (result === "application_missing") { res.status(409).json({ error: "Driver application must exist before adjudication." }); return; }
  res.json(result);
  publishAdminUpdate();
}

router.post("/admin/drivers/:id/background-check", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  await adjudicateDriverCheck(req, res, "background");
});

router.post("/admin/drivers/:id/mvr", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  await adjudicateDriverCheck(req, res, "mvr");
});

router.get("/admin/customers", requireAdminRoles("admin", "support"), async (req, res): Promise<void> => {
  const rawSearch = typeof req.query.search === "string" ? req.query.search : "";
  if (rawSearch.length > 120) {
    res.status(400).json({ error: "Search must be at most 120 characters." });
    return;
  }
  const search = rawSearch.trim();
  const match = `%${search}%`;
  const customers = await db
    .select()
    .from(profilesTable)
    .where(search
      ? and(eq(profilesTable.role, "customer"), or(ilike(profilesTable.firstName, match), ilike(profilesTable.lastName, match), ilike(profilesTable.email, match)))
      : eq(profilesTable.role, "customer"))
    .orderBy(desc(profilesTable.createdAt))
    .limit(200);
  const result = await Promise.all(customers.map(async (customer) => {
    const deliveries = await db.select({ status: deliveriesTable.deliveryStatus }).from(deliveriesTable).where(eq(deliveriesTable.customerId, customer.id));
    const deliveryStatusCounts = deliveries.reduce<Record<string, number>>((counts, delivery) => {
      counts[delivery.status] = (counts[delivery.status] ?? 0) + 1;
      return counts;
    }, {});
    return {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      status: customer.status === "suspended" ? "suspended" as const : "active" as const,
      createdAt: customer.createdAt.toISOString(),
      deliveryCount: deliveries.length,
      deliveryStatusCounts,
    };
  }));
  res.json(ListAdminCustomersResponse.parse(result));
});

router.get("/admin/customers/:id", requireAdminRoles("admin", "support"), async (req, res): Promise<void> => {
  const [customer] = await db.select().from(profilesTable).where(and(eq(profilesTable.id, routeId(req.params.id)), eq(profilesTable.role, "customer"))).limit(1);
  if (!customer) {
    res.status(404).json({ error: "Customer not found." });
    return;
  }
  const [deliveries, tickets] = await Promise.all([
    db.select({ id: deliveriesTable.publicDeliveryId, orderNumber: deliveriesTable.orderNumber, status: deliveriesTable.deliveryStatus, total: deliveriesTable.totalPrice, createdAt: deliveriesTable.createdAt })
      .from(deliveriesTable).where(eq(deliveriesTable.customerId, customer.id)).orderBy(desc(deliveriesTable.createdAt)).limit(100),
    db.select().from(supportTicketsTable).where(eq(supportTicketsTable.customerId, customer.id)).orderBy(desc(supportTicketsTable.updatedAt)).limit(100),
  ]);
  const deliveryStatusCounts = deliveries.reduce<Record<string, number>>((counts, delivery) => {
    counts[delivery.status] = (counts[delivery.status] ?? 0) + 1;
    return counts;
  }, {});
  res.json(GetAdminCustomerResponse.parse({
    customer: {
      id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone,
      status: customer.status === "suspended" ? "suspended" : "active", createdAt: customer.createdAt.toISOString(),
      deliveryCount: deliveries.length, deliveryStatusCounts,
    },
    deliveries: deliveries.map((delivery) => ({ ...delivery, total: number(delivery.total), createdAt: delivery.createdAt.toISOString() })),
    deliveryStatusCounts,
    supportTickets: tickets.map((ticket) => ({ id: ticket.id, category: ticket.category, message: ticket.message, status: canonicalTicketStatus(ticket.status), createdAt: ticket.createdAt.toISOString() })),
  }));
});

router.put("/admin/customers/:id/status", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const params = UpdateAdminCustomerStatusParams.safeParse(req.params);
  const body = UpdateAdminCustomerStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Provide a valid customer status update." });
    return;
  }
  const { status, reason } = body.data;
  const actorProfileId = currentAuth(res).profileId;
  const result = await db.transaction(async (tx) => {
    const [customer] = await tx.select().from(profilesTable)
      .where(and(eq(profilesTable.id, params.data.id), eq(profilesTable.role, "customer"))).for("update").limit(1);
    if (!customer) return null;
    const changed = customer.status !== status;
    const revoked = status === "suspended"
      ? await tx.update(sessionsTable).set({ revokedAt: new Date() })
        .where(and(eq(sessionsTable.profileId, customer.id), isNull(sessionsTable.revokedAt))).returning({ id: sessionsTable.id })
      : [];
    if (changed) await tx.update(profilesTable).set({ status }).where(eq(profilesTable.id, customer.id));
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId,
      action: status === "suspended" ? "customer.suspended" : "customer.reactivated",
      entityType: "profile",
      entityId: customer.id,
      metadata: { previousStatus: customer.status, status, reason: reason ?? null, revokedSessionCount: revoked.length, idempotent: !changed },
    });
    return { id: customer.id, status, revokedSessionCount: revoked.length };
  });
  if (!result) {
    res.status(404).json({ error: "Customer not found." });
    return;
  }
  res.json(UpdateAdminCustomerStatusResponse.parse(result));
  publishAdminUpdate();
});

router.get("/admin/payments", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const payments = await db
    .select({
      id: paymentsTable.id,
      status: paymentsTable.status,
      amount: paymentsTable.amount,
      currency: paymentsTable.currency,
      provider: paymentsTable.provider,
      createdAt: paymentsTable.createdAt,
      orderNumber: deliveriesTable.orderNumber,
      deliveryId: deliveriesTable.publicDeliveryId,
      customerName: profilesTable.firstName,
      customerLastName: profilesTable.lastName,
      refundStatus: refundOperationsTable.status,
      refundCreatedAt: refundOperationsTable.createdAt,
      refundUpdatedAt: refundOperationsTable.updatedAt,
    })
    .from(paymentsTable)
    .innerJoin(deliveriesTable, eq(paymentsTable.deliveryId, deliveriesTable.id))
    .innerJoin(profilesTable, eq(paymentsTable.customerId, profilesTable.id))
    .leftJoin(refundOperationsTable, eq(refundOperationsTable.paymentId, paymentsTable.id))
    .where(status ? eq(paymentsTable.status, status) : undefined)
    .orderBy(desc(paymentsTable.createdAt))
    .limit(200);
  res.json(ListAdminPaymentsResponse.parse(payments.map((payment) => ({
    id: payment.id,
    status: payment.status,
    amount: number(payment.amount),
    currency: payment.currency,
    provider: payment.provider,
    createdAt: payment.createdAt.toISOString(),
    orderNumber: payment.orderNumber,
    deliveryId: payment.deliveryId,
    customerName: `${payment.customerName} ${payment.customerLastName}`.trim(),
    refund: payment.refundStatus && payment.refundCreatedAt && payment.refundUpdatedAt
      ? { status: payment.refundStatus, createdAt: payment.refundCreatedAt.toISOString(), updatedAt: payment.refundUpdatedAt.toISOString() }
      : null,
  }))));
});

router.get("/admin/payments/summary", requireAdminRoles("admin"), async (_req, res): Promise<void> => {
  const [payments, refunds] = await Promise.all([
    db.select({ id: paymentsTable.id, amount: paymentsTable.amount, status: paymentsTable.status }).from(paymentsTable),
    db.select({ paymentId: refundOperationsTable.paymentId, status: refundOperationsTable.status }).from(refundOperationsTable),
  ]);
  const refundedIds = new Set(refunds.filter((refund) => refund.status === "confirmed").map((refund) => refund.paymentId));
  const paid = payments.filter((payment) => payment.status === "paid");
  const grossPaidRevenue = paid.reduce((sum, payment) => sum + number(payment.amount), 0);
  const refunded = payments.filter((payment) => refundedIds.has(payment.id));
  const refundedAmount = refunded.reduce((sum, payment) => sum + number(payment.amount), 0);
  res.json({ grossPaidRevenue, paidCount: paid.length, refundedAmount, refundedCount: refunded.length, platformRevenue: grossPaidRevenue - refundedAmount });
});

router.post("/admin/payments/:id/refund", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const reason = value(req.body, "reason");
  if (reason.length < 3 || rawValue(req.body, "reason").length > 500) {
    res.status(400).json({ error: "A refund reason is required." });
    return;
  }
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, routeId(req.params.id))).limit(1);
  if (!payment || !payment.providerPaymentId) {
    res.status(404).json({ error: "Refundable payment not found." });
    return;
  }
  if (payment.provider !== "stripe") {
    res.status(409).json({ error: "Only paid Stripe payments can be refunded." });
    return;
  }
  const actorProfileId = currentAuth(res).profileId;
  const operationResult = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(refundOperationsTable)
      .where(eq(refundOperationsTable.paymentId, payment.id))
      .limit(1);
    if (existing) return { operation: existing, isNew: false };
    if (payment.status !== "paid") throw new Error("Only paid Stripe payments can be refunded.");
    const [created] = await tx
      .insert(refundOperationsTable)
      .values({ paymentId: payment.id, actorProfileId, reason, status: "requested" })
      .returning();
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId,
      action: "payment.refund_requested",
      entityType: "payment",
      entityId: payment.id,
      metadata: { refundOperationId: created.id, reason, paymentIntentId: payment.providerPaymentId },
    });
    return { operation: created, isNew: true };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "Only paid Stripe payments can be refunded.") return null;
    throw error;
  });
  if (!operationResult) {
    res.status(409).json({ error: "Only paid Stripe payments can be refunded." });
    return;
  }
  const { operation, isNew } = operationResult;
  if (operation.status === "provider_accepted" || operation.status === "confirmed") {
    res.status(202).json({ id: payment.id, status: operation.status === "confirmed" ? "refunded" : "pending_provider_confirmation", refundReference: operation.providerRefundId, idempotent: true });
    return;
  }
  if (!isNew && operation.status === "failed") {
    await db.transaction(async (tx) => {
      await tx.update(refundOperationsTable).set({ status: "requested", providerError: null }).where(eq(refundOperationsTable.id, operation.id));
      await tx.insert(adminAuditLogsTable).values({
        actorProfileId,
        action: "payment.refund_retried",
        entityType: "payment",
        entityId: payment.id,
        metadata: { refundOperationId: operation.id },
      });
    });
  }
  try {
    const refund = await (await getUncachableStripeClient()).refunds.create(
      { payment_intent: payment.providerPaymentId, reason: "requested_by_customer" },
      { idempotencyKey: operation.id },
    );
    await db.transaction(async (tx) => {
      await tx
        .update(refundOperationsTable)
        .set({ status: "provider_accepted", providerRefundId: refund.id, providerError: null })
        .where(eq(refundOperationsTable.id, operation.id));
      await tx.insert(adminAuditLogsTable).values({
        actorProfileId,
        action: "payment.refund_provider_accepted",
        entityType: "payment",
        entityId: payment.id,
        metadata: { refundOperationId: operation.id, stripeRefundId: refund.id },
      });
    });
    res.status(202).json({ id: payment.id, status: "pending_provider_confirmation", refundReference: refund.id });
    publishAdminUpdate();
  } catch (error) {
    req.log.error({ err: error, paymentId: payment.id }, "Admin refund request failed");
    await db.transaction(async (tx) => {
      await tx
        .update(refundOperationsTable)
        .set({ status: "failed", providerError: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown provider error" })
        .where(eq(refundOperationsTable.id, operation.id));
      await tx.insert(adminAuditLogsTable).values({
        actorProfileId,
        action: "payment.refund_provider_error",
        entityType: "payment",
        entityId: payment.id,
        metadata: { refundOperationId: operation.id },
      });
    }).catch((auditError: unknown) => req.log.error({ err: auditError, paymentId: payment.id }, "Could not record refund provider error"));
    res.status(502).json({ error: "Refund processing could not be confirmed. Check payment activity before retrying." });
  }
});

router.get("/admin/support/tickets", requireAdminRoles("admin", "support"), async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const priority = typeof req.query.priority === "string" ? req.query.priority : "";
  const conditions = [];
  if (ticketStatuses.has(status)) {
    conditions.push(status === "in_progress"
      ? or(eq(supportTicketsTable.status, "in_progress"), eq(supportTicketsTable.status, "escalated"))
      : eq(supportTicketsTable.status, status));
  }
  if (ticketPriorities.has(priority)) conditions.push(eq(supportTicketsTable.priority, priority));
  const tickets = await db
    .select({
      id: supportTicketsTable.id,
      customerId: supportTicketsTable.customerId,
      deliveryId: deliveriesTable.publicDeliveryId,
      orderNumber: deliveriesTable.orderNumber,
      category: supportTicketsTable.category,
      message: supportTicketsTable.message,
      priority: supportTicketsTable.priority,
      status: supportTicketsTable.status,
      assignedProfileId: supportTicketsTable.assignedProfileId,
      assigneeId: assignedToProfiles.id,
      assigneeFirstName: assignedToProfiles.firstName,
      assigneeLastName: assignedToProfiles.lastName,
      resolution: supportTicketsTable.resolution,
      resolvedAt: supportTicketsTable.resolvedAt,
      createdAt: supportTicketsTable.createdAt,
      updatedAt: supportTicketsTable.updatedAt,
      customerFirstName: profilesTable.firstName,
      customerLastName: profilesTable.lastName,
      customerRole: profilesTable.role,
      customerEmail: profilesTable.email,
      customerPhone: profilesTable.phone,
      resolverId: resolvedByProfiles.id,
      resolverFirstName: resolvedByProfiles.firstName,
      resolverLastName: resolvedByProfiles.lastName,
    })
    .from(supportTicketsTable)
    .innerJoin(profilesTable, eq(supportTicketsTable.customerId, profilesTable.id))
    .leftJoin(deliveriesTable, eq(supportTicketsTable.deliveryId, deliveriesTable.id))
    .leftJoin(resolvedByProfiles, eq(supportTicketsTable.resolvedByProfileId, resolvedByProfiles.id))
    .leftJoin(assignedToProfiles, eq(supportTicketsTable.assignedProfileId, assignedToProfiles.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(200);
  const customerRows = tickets.map((ticket) => ({
    id: ticket.id,
    reference: ticket.id,
    source: "customer_ticket" as const,
    category: ticket.category,
    message: ticket.message,
    priority: ticket.priority,
    assignedProfileId: ticket.assignedProfileId,
    assignee: ticket.assigneeId ? { id: ticket.assigneeId, name: `${ticket.assigneeFirstName} ${ticket.assigneeLastName}`.trim() } : null,
    status: canonicalTicketStatus(ticket.status),
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    requester: {
      role: ticket.customerRole === "driver" ? "driver" : "customer",
      name: `${ticket.customerFirstName} ${ticket.customerLastName}`.trim(),
      email: ticket.customerEmail,
      phone: ticket.customerPhone,
    },
    deliveryId: ticket.deliveryId,
    orderNumber: ticket.orderNumber,
    resolution: ticket.resolution,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    resolvedBy: ticket.resolverId
      ? { id: ticket.resolverId, name: `${ticket.resolverFirstName} ${ticket.resolverLastName}`.trim() }
      : null,
  }));
  const incidentConditions = [];
  if (ticketStatuses.has(status)) incidentConditions.push(eq(driverIncidentsTable.status, status));
  const incidents = await db
    .select({
      id: driverIncidentsTable.id,
      deliveryId: deliveriesTable.publicDeliveryId,
      orderNumber: deliveriesTable.orderNumber,
      category: driverIncidentsTable.category,
      message: driverIncidentsTable.message,
      priority: driverIncidentsTable.priority,
      status: driverIncidentsTable.status,
      resolution: driverIncidentsTable.resolution,
      assignedProfileId: driverIncidentsTable.assignedProfileId,
      resolvedAt: driverIncidentsTable.resolvedAt,
      createdAt: driverIncidentsTable.createdAt,
      updatedAt: driverIncidentsTable.updatedAt,
      firstName: profilesTable.firstName,
      lastName: profilesTable.lastName,
      email: profilesTable.email,
      phone: profilesTable.phone,
      resolverId: resolvedByProfiles.id,
      resolverFirstName: resolvedByProfiles.firstName,
      resolverLastName: resolvedByProfiles.lastName,
      assigneeId: assignedToProfiles.id,
      assigneeFirstName: assignedToProfiles.firstName,
      assigneeLastName: assignedToProfiles.lastName,
    })
    .from(driverIncidentsTable)
    .innerJoin(driversTable, eq(driverIncidentsTable.driverId, driversTable.id))
    .innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
    .leftJoin(deliveriesTable, eq(driverIncidentsTable.deliveryId, deliveriesTable.id))
    .leftJoin(resolvedByProfiles, eq(driverIncidentsTable.resolvedByProfileId, resolvedByProfiles.id))
    .leftJoin(assignedToProfiles, eq(driverIncidentsTable.assignedProfileId, assignedToProfiles.id))
    .where([
      ...incidentConditions,
      ...(ticketPriorities.has(priority) ? [eq(driverIncidentsTable.priority, priority)] : []),
    ].length ? and(
      ...incidentConditions,
      ...(ticketPriorities.has(priority) ? [eq(driverIncidentsTable.priority, priority)] : []),
    ) : undefined)
    .orderBy(desc(driverIncidentsTable.updatedAt))
    .limit(200);
  const driverRows = incidents.map((incident) => ({
    id: incident.id,
    reference: `driver_issue:${incident.id}`,
    source: "driver_issue" as const,
    category: incident.category,
    message: incident.message,
    priority: ticketPriorities.has(incident.priority) ? incident.priority as "low" | "normal" | "high" | "urgent" : "normal" as const,
    assignedProfileId: incident.assignedProfileId,
    assignee: incident.assigneeId ? { id: incident.assigneeId, name: `${incident.assigneeFirstName} ${incident.assigneeLastName}`.trim() } : null,
    status: canonicalTicketStatus(incident.status),
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    requester: { role: "driver" as const, name: `${incident.firstName} ${incident.lastName}`.trim(), email: incident.email, phone: incident.phone },
    deliveryId: incident.deliveryId,
    orderNumber: incident.orderNumber,
    resolution: incident.resolution,
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    resolvedBy: incident.resolverId ? { id: incident.resolverId, name: `${incident.resolverFirstName} ${incident.resolverLastName}`.trim() } : null,
  }));
  res.json(ListAdminSupportTicketsResponse.parse([...customerRows, ...driverRows]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 200)));
});

router.get("/admin/support/agents", requireAdminRoles("admin", "support"), async (_req, res): Promise<void> => {
  const agents = await db
    .select({
      id: profilesTable.id,
      firstName: profilesTable.firstName,
      lastName: profilesTable.lastName,
      role: profilesTable.role,
    })
    .from(profilesTable)
    .where(and(inArray(profilesTable.role, ["admin", "support"]), eq(profilesTable.status, "active")))
    .orderBy(profilesTable.firstName, profilesTable.lastName)
    .limit(100);
  res.json(agents.map((agent) => ({ ...agent, name: `${agent.firstName} ${agent.lastName}`.trim() })));
});

router.patch("/admin/support/tickets/:id", requireAdminRoles("admin", "support"), async (req, res): Promise<void> => {
  const parsed = UpdateAdminSupportTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a valid ticket update." });
    return;
  }
  const status = parsed.data.status ?? "";
  const source = parsed.data.source ?? "customer_ticket";
  const priority = parsed.data.priority ?? "";
  const assignmentSupplied = Object.prototype.hasOwnProperty.call(parsed.data, "assignedProfileId");
  const assignedProfileId = typeof parsed.data.assignedProfileId === "string" ? parsed.data.assignedProfileId.trim() : "";
  const resolutionSupplied = typeof parsed.data.resolution === "string";
  const resolution = resolutionSupplied ? (parsed.data.resolution ?? "").trim().replace(/\s+/g, " ") : "";
  if (assignedProfileId) {
    const [agent] = await db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(and(
        eq(profilesTable.id, assignedProfileId),
        inArray(profilesTable.role, ["admin", "support"]),
        eq(profilesTable.status, "active"),
      ))
      .limit(1);
    if (!agent) {
      res.status(400).json({ error: "Assigned agent must be an active support or admin profile." });
      return;
    }
  }
  if (!status && !priority && !assignmentSupplied && !resolutionSupplied) {
    res.status(400).json({ error: "Provide at least one ticket update." });
    return;
  }
  const actorProfileId = currentAuth(res).profileId;
  if (source === "driver_issue") {
    if ((status === "open" || status === "in_progress") && resolutionSupplied) {
      res.status(400).json({ error: "Omit the resolution note when reopening a ticket." });
      return;
    }
    const incident = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(driverIncidentsTable).where(eq(driverIncidentsTable.id, routeId(req.params.id))).for("update").limit(1);
      if (!current) return null;
      if (status === "resolved" && !resolution) return "resolution_required" as const;
      if (status === "resolved" && current.status === "resolved") {
        return current.resolution === resolution ? current : "reopen_required" as const;
      }
      const reopening = status === "open" || status === "in_progress";
      const [updated] = await tx.update(driverIncidentsTable).set({
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(assignmentSupplied ? { assignedProfileId: assignedProfileId || null } : {}),
        ...(status === "resolved" ? { resolution, resolvedAt: new Date(), resolvedByProfileId: actorProfileId } : {}),
        ...(reopening ? { resolution: null, resolvedAt: null, resolvedByProfileId: null } : {}),
      }).where(eq(driverIncidentsTable.id, current.id)).returning();
      await tx.insert(adminAuditLogsTable).values({
        actorProfileId, action: "driver_issue.updated", entityType: "driver_issue", entityId: updated.id,
        metadata: { before: { status: current.status, priority: current.priority, assignedProfileId: current.assignedProfileId, resolution: current.resolution, resolvedAt: current.resolvedAt?.toISOString() ?? null }, after: { status: updated.status, priority: updated.priority, assignedProfileId: updated.assignedProfileId, resolution: updated.resolution, resolvedAt: updated.resolvedAt?.toISOString() ?? null } },
      });
      return updated;
    });
    if (incident === "resolution_required") { res.status(400).json({ error: "A non-empty resolution note is required to resolve a support ticket." }); return; }
    if (incident === "reopen_required") { res.status(409).json({ error: "Reopen the issue before changing its resolution note." }); return; }
    if (!incident) { res.status(404).json({ error: "Driver issue not found." }); return; }
    const [[requester], [delivery], [resolver], [assignee]] = await Promise.all([
      db.select({ firstName: profilesTable.firstName, lastName: profilesTable.lastName, email: profilesTable.email, phone: profilesTable.phone }).from(driversTable).innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id)).where(eq(driversTable.id, incident.driverId)).limit(1),
      incident.deliveryId ? db.select({ id: deliveriesTable.publicDeliveryId, orderNumber: deliveriesTable.orderNumber }).from(deliveriesTable).where(eq(deliveriesTable.id, incident.deliveryId)).limit(1) : Promise.resolve([]),
      incident.resolvedByProfileId ? db.select({ id: profilesTable.id, firstName: profilesTable.firstName, lastName: profilesTable.lastName }).from(profilesTable).where(eq(profilesTable.id, incident.resolvedByProfileId)).limit(1) : Promise.resolve([]),
      incident.assignedProfileId ? db.select({ id: profilesTable.id, firstName: profilesTable.firstName, lastName: profilesTable.lastName }).from(profilesTable).where(eq(profilesTable.id, incident.assignedProfileId)).limit(1) : Promise.resolve([]),
    ]);
    if (!requester) { res.status(409).json({ error: "Driver issue requester is unavailable." }); return; }
    res.json(UpdateAdminSupportTicketResponse.parse({
      id: incident.id, reference: `driver_issue:${incident.id}`, source: "driver_issue", category: incident.category, message: incident.message, priority: ticketPriorities.has(incident.priority) ? incident.priority : "normal", assignedProfileId: incident.assignedProfileId, assignee: assignee ? { id: assignee.id, name: `${assignee.firstName} ${assignee.lastName}`.trim() } : null,
      status: canonicalTicketStatus(incident.status), createdAt: incident.createdAt.toISOString(), updatedAt: incident.updatedAt.toISOString(),
      requester: { role: "driver", name: `${requester.firstName} ${requester.lastName}`.trim(), email: requester.email, phone: requester.phone },
      deliveryId: delivery?.id ?? null, orderNumber: delivery?.orderNumber ?? null, resolution: incident.resolution, resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      resolvedBy: resolver ? { id: resolver.id, name: `${resolver.firstName} ${resolver.lastName}`.trim() } : null,
    }));
    publishAdminUpdate();
    return;
  }
  if ((status === "open" || status === "in_progress") && resolutionSupplied) {
    res.status(400).json({ error: "Omit the resolution note when reopening a ticket." });
    return;
  }
  const ticket = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, routeId(req.params.id)))
      .for("update")
      .limit(1);
    if (!current) return null;
    if (status === "resolved" && !resolution) {
      return "resolution_required" as const;
    }
    if (status === "resolved" && current.status === "resolved") {
      return current.resolution === resolution ? current : "reopen_required" as const;
    }
    if (resolutionSupplied && !status && current.status !== "resolved") {
      return "resolution_not_allowed" as const;
    }
    const isReopening = status === "open" || status === "in_progress";
    const updates: Record<string, unknown> = {
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(assignmentSupplied ? { assignedProfileId: assignedProfileId || null } : {}),
      ...(resolutionSupplied && !isReopening ? { resolution } : {}),
      ...(status === "resolved" ? { resolvedAt: new Date(), resolvedByProfileId: actorProfileId } : {}),
      ...(isReopening ? { resolution: null, resolvedAt: null, resolvedByProfileId: null } : {}),
    };
    const [updated] = await tx.update(supportTicketsTable).set(updates).where(eq(supportTicketsTable.id, current.id)).returning();
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId,
      action: "support_ticket.updated",
      entityType: "support_ticket",
      entityId: updated.id,
      metadata: {
        before: { status: current.status, priority: current.priority, assignedProfileId: current.assignedProfileId, resolution: current.resolution, resolvedAt: current.resolvedAt?.toISOString() ?? null, resolvedByProfileId: current.resolvedByProfileId },
        after: { status: updated.status, priority: updated.priority, assignedProfileId: updated.assignedProfileId, resolution: updated.resolution, resolvedAt: updated.resolvedAt?.toISOString() ?? null, resolvedByProfileId: updated.resolvedByProfileId },
      },
    });
    return updated;
  });
  if (ticket === "resolution_required") {
    res.status(400).json({ error: "A non-empty resolution note is required to resolve a support ticket." });
    return;
  }
  if (ticket === "resolution_not_allowed") {
    res.status(400).json({ error: "A resolution note can only be added while resolving a ticket." });
    return;
  }
  if (ticket === "reopen_required") {
    res.status(409).json({ error: "Reopen the ticket before changing its resolution note." });
    return;
  }
  if (!ticket) {
    res.status(404).json({ error: "Support ticket not found." });
    return;
  }
  const [[requester], [delivery], [resolver], [assignee]] = await Promise.all([
    db.select({
      role: profilesTable.role,
      firstName: profilesTable.firstName,
      lastName: profilesTable.lastName,
      email: profilesTable.email,
      phone: profilesTable.phone,
    }).from(profilesTable).where(eq(profilesTable.id, ticket.customerId)).limit(1),
    ticket.deliveryId
      ? db.select({ id: deliveriesTable.publicDeliveryId, orderNumber: deliveriesTable.orderNumber }).from(deliveriesTable).where(eq(deliveriesTable.id, ticket.deliveryId)).limit(1)
      : Promise.resolve([]),
    ticket.resolvedByProfileId
      ? db.select({ id: profilesTable.id, firstName: profilesTable.firstName, lastName: profilesTable.lastName }).from(profilesTable).where(eq(profilesTable.id, ticket.resolvedByProfileId)).limit(1)
      : Promise.resolve([]),
    ticket.assignedProfileId
      ? db.select({ id: profilesTable.id, firstName: profilesTable.firstName, lastName: profilesTable.lastName }).from(profilesTable).where(eq(profilesTable.id, ticket.assignedProfileId)).limit(1)
      : Promise.resolve([]),
  ]);
  if (!requester) {
    res.status(409).json({ error: "Support ticket requester is unavailable." });
    return;
  }
  res.json(UpdateAdminSupportTicketResponse.parse({
    id: ticket.id,
    reference: ticket.id,
    source: "customer_ticket",
    category: ticket.category,
    message: ticket.message,
    priority: ticket.priority,
    assignedProfileId: ticket.assignedProfileId,
    assignee: assignee ? { id: assignee.id, name: `${assignee.firstName} ${assignee.lastName}`.trim() } : null,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    requester: {
      role: requester.role === "driver" ? "driver" : "customer",
      name: `${requester.firstName} ${requester.lastName}`.trim(),
      email: requester.email,
      phone: requester.phone,
    },
    deliveryId: delivery?.id ?? null,
    orderNumber: delivery?.orderNumber ?? null,
    resolution: ticket.resolution,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    resolvedBy: resolver ? { id: resolver.id, name: `${resolver.firstName} ${resolver.lastName}`.trim() } : null,
  }));
  publishAdminUpdate();
});

router.get("/admin/support/tickets/:id/comments/:source", requireAdminRoles("admin", "support"), async (req, res): Promise<void> => {
  const ticketId = routeId(req.params.id);
  const source = !req.params.source || req.params.source === "customer_ticket" ? "customer_ticket" : req.params.source === "driver_issue" ? "driver_issue" : null;
  if (!source) { res.status(400).json({ error: "A valid conversation source is required." }); return; }
  const [origin] = source === "customer_ticket"
    ? await db.select({ id: supportTicketsTable.id, requesterId: supportTicketsTable.customerId, body: supportTicketsTable.message, createdAt: supportTicketsTable.createdAt }).from(supportTicketsTable).where(eq(supportTicketsTable.id, ticketId)).limit(1)
    : await db.select({ id: driverIncidentsTable.id, requesterId: driversTable.profileId, body: driverIncidentsTable.message, createdAt: driverIncidentsTable.createdAt }).from(driverIncidentsTable).innerJoin(driversTable, eq(driverIncidentsTable.driverId, driversTable.id)).where(eq(driverIncidentsTable.id, ticketId)).limit(1);
  if (!origin) {
    res.status(404).json({ error: "Support conversation source not found." });
    return;
  }
  const comments = await db
    .select({
      id: supportConversationEntriesTable.id,
      body: supportConversationEntriesTable.body,
      createdAt: supportConversationEntriesTable.createdAt,
      authorFirstName: profilesTable.firstName,
      authorLastName: profilesTable.lastName,
      authorRole: profilesTable.role,
    })
    .from(supportConversationEntriesTable)
    .innerJoin(profilesTable, eq(supportConversationEntriesTable.authorProfileId, profilesTable.id))
    .where(source === "customer_ticket" ? eq(supportConversationEntriesTable.supportTicketId, ticketId) : eq(supportConversationEntriesTable.driverIncidentId, ticketId))
    .orderBy(supportConversationEntriesTable.createdAt);
  res.json([
    { id: `origin:${origin.id}`, source, body: origin.body, createdAt: origin.createdAt.toISOString(), author: { role: "requester", name: "Requester" }, origin: true },
    ...comments.map((comment) => ({ id: comment.id, source, body: comment.body, createdAt: comment.createdAt.toISOString(), author: { role: comment.authorRole, name: `${comment.authorFirstName} ${comment.authorLastName}`.trim() }, origin: false })),
  ]);
});

router.post("/admin/support/tickets/:id/comments/:source", requireAdminRoles("admin", "support"), async (req, res): Promise<void> => {
  const body = value(req.body, "body");
  const source = value(req.body, "source") || (req.params.source ? "" : "customer_ticket");
  const clientRequestId = value(req.body, "clientRequestId");
  if ((req.params.source && source !== routeId(req.params.source)) || !["customer_ticket", "driver_issue"].includes(source) || body.length < 2 || rawValue(req.body, "body").length > 2_000 || (clientRequestId && clientRequestId.length > 120)) {
    res.status(400).json({ error: "Comment must be between 2 and 2,000 characters." });
    return;
  }
  const actorProfileId = currentAuth(res).profileId;
  const comment = await db.transaction(async (tx) => {
    const id = routeId(req.params.id);
    const [origin] = source === "customer_ticket"
      ? await tx.select({ id: supportTicketsTable.id, requesterId: supportTicketsTable.customerId }).from(supportTicketsTable).where(eq(supportTicketsTable.id, id)).for("update").limit(1)
      : await tx.select({ id: driverIncidentsTable.id, requesterId: driversTable.profileId }).from(driverIncidentsTable).innerJoin(driversTable, eq(driverIncidentsTable.driverId, driversTable.id)).where(eq(driverIncidentsTable.id, id)).for("update").limit(1);
    if (!origin) return null;
    const [existing] = clientRequestId ? await tx.select().from(supportConversationEntriesTable).where(and(eq(supportConversationEntriesTable.authorProfileId, actorProfileId), eq(supportConversationEntriesTable.clientRequestId, clientRequestId))).limit(1) : [];
    if (existing) return { entry: existing, requesterId: origin.requesterId, idempotent: true };
    const [created] = await tx.insert(supportConversationEntriesTable).values({
      ...(source === "customer_ticket" ? { supportTicketId: origin.id } : { driverIncidentId: origin.id }),
      authorProfileId: actorProfileId, body, visibility: "requester", clientRequestId: clientRequestId || null,
    }).returning();
    await tx.insert(notificationsTable).values({
      profileId: origin.requesterId,
      ...(source === "customer_ticket" ? { supportTicketId: origin.id } : { driverIncidentId: origin.id }),
      type: "support_reply",
      title: "Support replied",
      body: "You have a new reply to your support request.",
    });
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId,
      action: "support.conversation_replied",
      entityType: source,
      entityId: origin.id,
      metadata: { conversationEntryId: created.id },
    });
    return { entry: created, requesterId: origin.requesterId, idempotent: false };
  });
  if (!comment) {
    res.status(404).json({ error: "Support ticket not found." });
    return;
  }
  res.status(comment.idempotent ? 200 : 201).json({ id: comment.entry.id, source, body: comment.entry.body, createdAt: comment.entry.createdAt.toISOString(), idempotent: comment.idempotent });
  publishAdminUpdate();
});

router.get("/admin/promotions", requireAdminRoles("admin"), async (_req, res): Promise<void> => {
  const promotions = await db.select().from(promoCodesTable).orderBy(desc(promoCodesTable.updatedAt)).limit(200);
  res.json(promotions.map(promotionPayload));
});

router.get("/admin/analytics", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const parsedPeriod = analyticsPeriod(req.query);
  if (!parsedPeriod.period) {
    res.status(400).json({ error: parsedPeriod.error });
    return;
  }
  const canViewRevenue = currentAuth(res).role === "admin";
  const { start, endExclusive } = parsedPeriod.period;
  const deliveries = await db.select().from(deliveriesTable).where(and(gte(deliveriesTable.createdAt, start), lt(deliveriesTable.createdAt, endExclusive)));
  const byArea = new Map<string, number>();
  const byDay = new Map<string, { deliveries: number; revenue?: number; cancelled: number; durationMinutes: number[] }>();
  for (const delivery of deliveries) {
    const day = delivery.createdAt.toISOString().slice(0, 10);
    const dayValues = byDay.get(day) ?? { deliveries: 0, ...(canViewRevenue ? { revenue: 0 } : {}), cancelled: 0, durationMinutes: [] };
    dayValues.deliveries += 1;
    if (canViewRevenue) dayValues.revenue = (dayValues.revenue ?? 0) + (delivery.paymentStatus === "paid" ? number(delivery.totalPrice) : 0);
    dayValues.cancelled += delivery.deliveryStatus === "cancelled" ? 1 : 0;
    if (delivery.pickedUpAt && delivery.deliveredAt) dayValues.durationMinutes.push((delivery.deliveredAt.getTime() - delivery.pickedUpAt.getTime()) / 60_000);
    byDay.set(day, dayValues);
    const area = delivery.dropoffAddress.split(",").slice(-2).join(",").trim() || "Unknown";
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
  }
  const repeatCustomers = new Set<string>();
  const seenCustomers = new Set<string>();
  for (const delivery of deliveries) {
    if (seenCustomers.has(delivery.customerId)) repeatCustomers.add(delivery.customerId);
    seenCustomers.add(delivery.customerId);
  }
  res.json({
    daily: Array.from(byDay.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([date, values]) => ({
      date,
      deliveries: values.deliveries,
      ...(canViewRevenue ? { revenue: Math.round((values.revenue ?? 0) * 100) / 100 } : {}),
      averageDeliveryMinutes: values.durationMinutes.length ? Math.round(values.durationMinutes.reduce((sum, value) => sum + value, 0) / values.durationMinutes.length) : null,
      cancellationRate: values.deliveries ? values.cancelled / values.deliveries : 0,
    })),
    repeatCustomerRate: seenCustomers.size ? repeatCustomers.size / seenCustomers.size : 0,
    topServiceAreas: Array.from(byArea.entries()).sort(([, left], [, right]) => right - left).slice(0, 10).map(([area, deliveries]) => ({ area, deliveries })),
    providerNote: "Driver acceptance rate remains unavailable until completed-delivery earnings and offer-response records are finalized.",
  });
});

router.get("/admin/analytics/export", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const parsedPeriod = analyticsPeriod(req.query);
  if (!parsedPeriod.period) {
    res.status(400).json({ error: parsedPeriod.error });
    return;
  }
  const { start, endExclusive } = parsedPeriod.period;
  const [deliveries, payments, promotionRedemptions] = await Promise.all([
    db.select().from(deliveriesTable).where(and(gte(deliveriesTable.createdAt, start), lt(deliveriesTable.createdAt, endExclusive))).orderBy(deliveriesTable.createdAt),
    db.select().from(paymentsTable).where(and(gte(paymentsTable.createdAt, start), lt(paymentsTable.createdAt, endExclusive))).orderBy(paymentsTable.createdAt),
    db.select().from(promotionRedemptionsTable)
      .where(and(gte(promotionRedemptionsTable.redeemedAt, start), lt(promotionRedemptionsTable.redeemedAt, endExclusive)))
      .orderBy(promotionRedemptionsTable.redeemedAt, promotionRedemptionsTable.promotionCode),
  ]);

  const rows: string[] = [
    csvRow(["report_type", "date", "metric", "status", "identifier", "count", "amount", "currency", "discount_type", "discount_value", "redemptions"]),
  ];
  const deliveriesByDay = new Map<string, { count: number; revenue: number; discounts: number }>();
  for (const delivery of deliveries) {
    const day = delivery.createdAt.toISOString().slice(0, 10);
    const values = deliveriesByDay.get(day) ?? { count: 0, revenue: 0, discounts: 0 };
    values.count += 1;
    if (delivery.paymentStatus === "paid") values.revenue += number(delivery.totalPrice);
    values.discounts += number(delivery.discount);
    deliveriesByDay.set(day, values);
  }
  for (const [date, values] of deliveriesByDay) {
    rows.push(csvRow(["delivery", date, "deliveries", "all", "", values.count, "", "", "", "", ""]));
    rows.push(csvRow(["delivery", date, "revenue", "paid", "", "", values.revenue.toFixed(2), "usd", "", "", ""]));
    rows.push(csvRow(["delivery", date, "discounts", "all", "", "", values.discounts.toFixed(2), "usd", "", "", ""]));
  }

  const paymentsByDay = new Map<string, { count: number; amount: number; currency: string; status: string }>();
  for (const payment of payments) {
    const date = payment.createdAt.toISOString().slice(0, 10);
    const key = `${date}:${payment.status}:${payment.currency}`;
    const values = paymentsByDay.get(key) ?? { count: 0, amount: 0, currency: payment.currency, status: payment.status };
    values.count += 1;
    values.amount += number(payment.amount);
    paymentsByDay.set(key, values);
  }
  for (const [key, values] of paymentsByDay) {
    const [date] = key.split(":");
    rows.push(csvRow(["payment", date, "payments", values.status, "", values.count, values.amount.toFixed(2), values.currency, "", "", ""]));
  }

  const redemptionsByDayAndCode = new Map<string, { date: string; code: string; count: number; savings: number }>();
  for (const redemption of promotionRedemptions) {
    const date = redemption.redeemedAt.toISOString().slice(0, 10);
    const key = JSON.stringify([date, redemption.promotionCode]);
    const values = redemptionsByDayAndCode.get(key) ?? {
      date,
      code: redemption.promotionCode,
      count: 0,
      savings: 0,
    };
    values.count += 1;
    values.savings += number(redemption.savingsAmount);
    redemptionsByDayAndCode.set(key, values);
  }
  for (const values of redemptionsByDayAndCode.values()) {
    rows.push(csvRow([
      "promotion",
      values.date,
      "redemptions_period",
      "",
      values.code,
      "",
      values.savings.toFixed(2),
      "usd",
      "",
      "",
      values.count,
    ]));
  }

  res
    .status(200)
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="analytics-${parsedPeriod.period.startDate}-to-${parsedPeriod.period.endDate}.csv"`,
      "Cache-Control": "no-store",
    })
    .send(`${rows.join("\r\n")}\r\n`);
});

const generalSettingsDefaults = {
  id: "general",
  businessName: "Anything Anywhere",
  appName: "Anything Anywhere",
  tagline: "",
  businessEmail: "support@anythinganywhere.com",
  supportEmail: "support@anythinganywhere.com",
  supportPhone: "",
  businessAddress: "",
  website: "https://anythinganywhere.com",
  defaultCurrency: "USD",
  country: "US",
  timeZone: "America/New_York",
  dateFormat: "MM/dd/yyyy" as const,
  distanceUnit: "mi" as const,
};

function serializeGeneralSettings(settings: typeof generalSettingsTable.$inferSelect) {
  return {
    businessName: settings.businessName,
    appName: settings.appName,
    tagline: settings.tagline,
    businessEmail: settings.businessEmail,
    supportEmail: settings.supportEmail,
    supportPhone: settings.supportPhone,
    businessAddress: settings.businessAddress,
    website: settings.website,
    defaultCurrency: settings.defaultCurrency,
    country: settings.country,
    timeZone: settings.timeZone,
    dateFormat: settings.dateFormat,
    distanceUnit: settings.distanceUnit,
    updatedByProfileId: settings.updatedByProfileId,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

async function getGeneralSettings() {
  const [settings] = await db
    .insert(generalSettingsTable)
    .values(generalSettingsDefaults)
    .onConflictDoNothing()
    .returning();
  if (settings) return settings;
  const [persisted] = await db.select().from(generalSettingsTable).where(eq(generalSettingsTable.id, "general")).limit(1);
  if (!persisted) throw new Error("General settings could not be initialized.");
  return persisted;
}

async function staffUser(profileId: string) {
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.id, profileId)).limit(1);
  if (!profile || !["admin", "dispatcher", "support"].includes(profile.role)) return null;
  const sessions = await db.select({ createdAt: sessionsTable.createdAt, expiresAt: sessionsTable.expiresAt, revokedAt: sessionsTable.revokedAt })
    .from(sessionsTable).where(eq(sessionsTable.profileId, profile.id));
  const lastLogin = sessions.reduce<Date | null>((latest, session) => !latest || session.createdAt > latest ? session.createdAt : latest, null);
  return {
    id: profile.id,
    name: `${profile.firstName} ${profile.lastName}`.trim(),
    email: profile.email,
    role: profile.role,
    status: profile.status === "active" ? "active" : "disabled",
    lastLogin: lastLogin?.toISOString() ?? null,
    activeSessionCount: sessions.filter((session) => !session.revokedAt && session.expiresAt > new Date()).length,
    capabilities: { superAdmin: "notConfigured" as const },
  };
}

router.get("/admin/settings", requireAdminRoles("admin"), async (_req, res): Promise<void> => {
  const settings = await getGeneralSettings();
  const stripeConfigured = process.env.PAYMENTS_TEST_MODE === "true" || Boolean(process.env.REPLIT_CONNECTORS_HOSTNAME && (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL));
  const emailConfigured = Boolean(process.env.REPLIT_CONNECTORS_HOSTNAME && process.env.REPL_IDENTITY && process.env.PASSWORD_RESET_FROM_EMAIL);
  const payload = {
    general: serializeGeneralSettings(settings),
    dispatch: dispatchPayload(await singleton(dispatchSettingsTable, dispatchDefaults)),
    connections: {
      stripe: { status: stripeConfigured ? "configured" as const : "notConfigured" as const },
      maps: { status: process.env.GOOGLE_MAPS_SERVER_API_KEY ? "configured" as const : "notConfigured" as const },
      email: { status: emailConfigured ? "configured" as const : "notConfigured" as const },
      documentStorage: { status: process.env.PRIVATE_OBJECT_DIR ? "configured" as const : "notConfigured" as const },
    },
    system: {
      api: { status: "connected" as const },
      database: { status: "connected" as const },
      server: { status: "connected" as const },
    },
    capabilities: { superAdmin: "notConfigured" as const },
  };
  res.json(GetAdminSettingsResponse.parse(payload));
});

router.put("/admin/settings/general", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const parsed = UpdateAdminGeneralSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid general settings." });
    return;
  }
  const actorProfileId = currentAuth(res).profileId;
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(generalSettingsTable).where(eq(generalSettingsTable.id, "general")).for("update").limit(1);
    const before = existing ?? (await tx.insert(generalSettingsTable).values(generalSettingsDefaults).onConflictDoNothing().returning())[0]
      ?? (await tx.select().from(generalSettingsTable).where(eq(generalSettingsTable.id, "general")).for("update").limit(1))[0];
    if (!before) throw new Error("General settings could not be initialized.");
    const changedFields = ([
      "businessName", "appName", "tagline", "businessEmail", "supportEmail", "supportPhone",
      "businessAddress", "website", "defaultCurrency", "country", "timeZone", "dateFormat", "distanceUnit",
    ] as const).filter((key) => before[key] !== parsed.data[key]);
    const [persisted] = await tx.insert(generalSettingsTable).values({ ...generalSettingsDefaults, ...parsed.data, updatedByProfileId: actorProfileId })
      .onConflictDoUpdate({ target: generalSettingsTable.id, set: { ...parsed.data, updatedByProfileId: actorProfileId, updatedAt: new Date() } }).returning();
    await tx.insert(adminAuditLogsTable).values({ actorProfileId, action: "settings.general.updated", entityType: "general_settings", metadata: { changedFields } });
    return persisted;
  });
  res.json(UpdateAdminGeneralSettingsResponse.parse(serializeGeneralSettings(updated)));
  publishAdminUpdate();
});

router.get("/admin/settings/admin-users", requireAdminRoles("admin"), async (_req, res): Promise<void> => {
  const profiles = await db.select({ id: profilesTable.id }).from(profilesTable)
    .where(inArray(profilesTable.role, ["admin", "dispatcher", "support"])).orderBy(profilesTable.firstName, profilesTable.lastName);
  const users = (await Promise.all(profiles.map((profile) => staffUser(profile.id)))).filter((user): user is NonNullable<typeof user> => user !== null);
  res.json(ListAdminSettingsUsersResponse.parse(users));
});

router.patch("/admin/settings/admin-users/:id", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const params = UpdateAdminSettingsUserParams.safeParse(req.params);
  const body = UpdateAdminSettingsUserBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid staff update." });
    return;
  }
  const actor = currentAuth(res);
  const result = await db.transaction(async (tx) => {
    const [target] = await tx.select().from(profilesTable).where(eq(profilesTable.id, params.data.id)).for("update").limit(1);
    if (!target || !["admin", "dispatcher", "support"].includes(target.role)) return { error: "notFound" as const };
    const targetStatus = body.data.status === undefined ? target.status : body.data.status;
    const targetRole = body.data.role ?? target.role;
    if (target.id === actor.profileId && targetStatus !== "active") return { error: "selfDisable" as const };
    if (target.role === "admin" && target.status === "active" && (targetRole !== "admin" || targetStatus !== "active")) {
      const activeAdmins = await tx.select({ id: profilesTable.id }).from(profilesTable).where(and(eq(profilesTable.role, "admin"), eq(profilesTable.status, "active"))).for("update");
      if (activeAdmins.length <= 1) return { error: "finalAdmin" as const };
    }
    const changedFields = (["role", "status"] as const).filter((field) => body.data[field] !== undefined && body.data[field] !== target[field]);
    await tx.update(profilesTable).set({ role: targetRole, status: targetStatus }).where(eq(profilesTable.id, target.id));
    await tx.insert(adminAuditLogsTable).values({ actorProfileId: actor.profileId, action: "settings.admin_user.updated", entityType: "profile", entityId: target.id, metadata: { changedFields } });
    return { id: target.id };
  });
  if ("error" in result) {
    if (result.error === "notFound") res.status(404).json({ error: "Staff account not found." });
    else res.status(400).json({ error: result.error === "selfDisable" ? "You cannot disable your own account." : "At least one active administrator is required." });
    return;
  }
  const user = await staffUser(result.id);
  if (!user) { res.status(404).json({ error: "Staff account not found." }); return; }
  res.json(UpdateAdminSettingsUserResponse.parse(user));
  publishAdminUpdate();
});

router.post("/admin/settings/admin-users/:id/revoke-sessions", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const params = RevokeAdminSettingsUserSessionsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid staff account." }); return; }
  const actorProfileId = currentAuth(res).profileId;
  const result = await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: profilesTable.id }).from(profilesTable).where(and(eq(profilesTable.id, params.data.id), inArray(profilesTable.role, ["admin", "dispatcher", "support"]))).limit(1);
    if (!target) return null;
    const revoked = await tx.update(sessionsTable).set({ revokedAt: new Date() }).where(and(eq(sessionsTable.profileId, target.id), isNull(sessionsTable.revokedAt))).returning({ id: sessionsTable.id });
    await tx.insert(adminAuditLogsTable).values({ actorProfileId, action: "settings.admin_user.sessions_revoked", entityType: "profile", entityId: target.id, metadata: { revokedSessionCount: revoked.length } });
    return revoked.length;
  });
  if (result === null) { res.status(404).json({ error: "Staff account not found." }); return; }
  res.json(RevokeAdminSettingsUserSessionsResponse.parse({ revokedSessionCount: result }));
  publishAdminUpdate();
});

const securityDefaults = { id: "security", sessionTimeoutMinutes: "60", suspiciousLoginAlerts: "true" };
const paymentDefaults = { id: "payments", currency: "USD", customerServiceFeeCents: "0", deliveryFeeCents: "0", smallOrderThresholdCents: "0", smallOrderFeeCents: "0", taxRateBasisPoints: "0", refundWindowDays: "30" };
const emailDefaults = { id: "email", senderDisplayName: "Anything Anywhere", replyToEmail: null, supportEmail: null, welcomeEnabled: "true", passwordResetEnabled: "true", orderConfirmationEnabled: "true", orderDeliveredEnabled: "true" };
const dispatchDefaults = {
  id: "dispatch",
  initialRadiusMiles: 3,
  maximumRadiusMiles: 12,
  initialDurationSeconds: 30,
  expansionStages: [{ radiusMiles: 5, durationSeconds: 30 }, { radiusMiles: 8, durationSeconds: 60 }, { radiusMiles: 12, durationSeconds: 480 }],
  maximumPickupEtaMinutes: 15,
  totalExpirationSeconds: 600,
};
const boolText = (value: boolean) => value ? "true" : "false";

function securityPayload(row: typeof securitySettingsTable.$inferSelect) {
  return { sessionTimeoutMinutes: Number(row.sessionTimeoutMinutes), suspiciousLoginAlerts: row.suspiciousLoginAlerts === "true", updatedAt: row.updatedAt.toISOString() };
}
function paymentPayload(row: typeof paymentFeeSettingsTable.$inferSelect) {
  return { currency: row.currency, customerServiceFeeCents: Number(row.customerServiceFeeCents), deliveryFeeCents: Number(row.deliveryFeeCents), smallOrderThresholdCents: Number(row.smallOrderThresholdCents), smallOrderFeeCents: Number(row.smallOrderFeeCents), taxRateBasisPoints: Number(row.taxRateBasisPoints), refundWindowDays: Number(row.refundWindowDays), appliedToCheckout: true, updatedAt: row.updatedAt.toISOString() };
}
function emailPayload(row: typeof emailSettingsTable.$inferSelect) {
  return { senderDisplayName: row.senderDisplayName, replyToEmail: row.replyToEmail, supportEmail: row.supportEmail, welcomeEnabled: row.welcomeEnabled === "true", passwordResetEnabled: row.passwordResetEnabled === "true", orderConfirmationEnabled: row.orderConfirmationEnabled === "true", orderDeliveredEnabled: row.orderDeliveredEnabled === "true", updatedAt: row.updatedAt.toISOString() };
}
function dispatchPayload(row: typeof dispatchSettingsTable.$inferSelect) {
  return {
    initialRadiusMiles: row.initialRadiusMiles,
    maximumRadiusMiles: row.maximumRadiusMiles,
    initialDurationSeconds: row.initialDurationSeconds,
    expansionStages: row.expansionStages,
    maximumPickupEtaMinutes: row.maximumPickupEtaMinutes,
    totalExpirationSeconds: row.totalExpirationSeconds,
    updatedAt: row.updatedAt.toISOString(),
  };
}
function validDispatchSettings(input: {
  initialRadiusMiles: number; maximumRadiusMiles: number; initialDurationSeconds: number;
  expansionStages: Array<{ radiusMiles: number; durationSeconds: number }>;
  maximumPickupEtaMinutes: number; totalExpirationSeconds: number;
}) {
  const radii = [input.initialRadiusMiles, ...input.expansionStages.map((stage) => stage.radiusMiles)];
  const stageSeconds = input.initialDurationSeconds + input.expansionStages.reduce((total, stage) => total + stage.durationSeconds, 0);
  return [...radii, input.maximumRadiusMiles, input.initialDurationSeconds, input.maximumPickupEtaMinutes, input.totalExpirationSeconds,
    ...input.expansionStages.map((stage) => stage.durationSeconds)].every(Number.isInteger) &&
    input.initialRadiusMiles <= input.maximumRadiusMiles &&
    radii.every((radius, index) => (index === 0 || radius > radii[index - 1]!) && radius <= input.maximumRadiusMiles) &&
    input.expansionStages.every((stage) => stage.durationSeconds > 0) &&
    stageSeconds <= input.totalExpirationSeconds;
}
async function singleton<T extends { id: string }>(table: any, defaults: T): Promise<any> {
  const createdRows = await db.insert(table).values(defaults).onConflictDoNothing().returning() as any[];
  const created = createdRows[0];
  if (created) return created;
  const [row] = await db.select().from(table).where(eq(table.id, defaults.id)).limit(1);
  if (!row) throw new Error("Settings could not be initialized.");
  return row;
}

router.get("/admin/settings/security", requireAdminRoles("admin"), async (_req, res): Promise<void> => {
  res.json(GetAdminSecuritySettingsResponse.parse(securityPayload(await singleton(securitySettingsTable, securityDefaults))));
});
router.put("/admin/settings/security", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const parsed = UpdateAdminSecuritySettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid security settings." }); return; }
  const actorProfileId = currentAuth(res).profileId;
  const [row] = await db.insert(securitySettingsTable).values({ ...securityDefaults, sessionTimeoutMinutes: String(parsed.data.sessionTimeoutMinutes), suspiciousLoginAlerts: boolText(parsed.data.suspiciousLoginAlerts), updatedByProfileId: actorProfileId })
    .onConflictDoUpdate({ target: securitySettingsTable.id, set: { sessionTimeoutMinutes: String(parsed.data.sessionTimeoutMinutes), suspiciousLoginAlerts: boolText(parsed.data.suspiciousLoginAlerts), updatedByProfileId: actorProfileId, updatedAt: new Date() } }).returning();
  await db.insert(adminAuditLogsTable).values({ actorProfileId, action: "settings.security.updated", entityType: "security_settings", metadata: {} });
  res.json(UpdateAdminSecuritySettingsResponse.parse(securityPayload(row))); publishAdminUpdate();
});
router.post("/admin/settings/security/revoke-other-sessions", requireAdminRoles("admin"), async (_req, res): Promise<void> => {
  const actorProfileId = currentAuth(res).profileId;
  const staff = await db.select({ id: profilesTable.id }).from(profilesTable).where(inArray(profilesTable.role, ["admin", "dispatcher", "support"]));
  const revoked = await db.update(sessionsTable).set({ revokedAt: new Date() }).where(and(inArray(sessionsTable.profileId, staff.map((profile) => profile.id).filter((id) => id !== actorProfileId)), isNull(sessionsTable.revokedAt))).returning({ id: sessionsTable.id });
  await db.insert(adminAuditLogsTable).values({ actorProfileId, action: "settings.security.other_sessions_revoked", entityType: "session", metadata: { revokedSessionCount: revoked.length } });
  res.json(RevokeOtherAdminSessionsResponse.parse({ revokedSessionCount: revoked.length })); publishAdminUpdate();
});

router.get("/admin/settings/payments-fees", requireAdminRoles("admin"), async (_req, res) => res.json(GetAdminPaymentFeeSettingsResponse.parse(paymentPayload(await singleton(paymentFeeSettingsTable, paymentDefaults)))));
router.put("/admin/settings/payments-fees", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const parsed = UpdateAdminPaymentFeeSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid payment policy." }); return; }
  const actorProfileId = currentAuth(res).profileId;
  const data = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, typeof value === "number" ? String(value) : value]));
  const [row] = await db.insert(paymentFeeSettingsTable).values({ ...paymentDefaults, ...data, updatedByProfileId: actorProfileId }).onConflictDoUpdate({ target: paymentFeeSettingsTable.id, set: { ...data, updatedByProfileId: actorProfileId, updatedAt: new Date() } }).returning();
  await db.insert(adminAuditLogsTable).values({ actorProfileId, action: "settings.payments_fees.updated", entityType: "payment_fee_settings", metadata: { appliedToCheckout: true } });
  res.json(UpdateAdminPaymentFeeSettingsResponse.parse(paymentPayload(row))); publishAdminUpdate();
});
router.get("/admin/settings/email", requireAdminRoles("admin"), async (_req, res) => res.json(GetAdminEmailSettingsResponse.parse(emailPayload(await singleton(emailSettingsTable, emailDefaults)))));
router.get("/admin/settings/dispatch", requireAdminRoles("admin"), async (_req, res): Promise<void> => {
  res.json(GetAdminDispatchSettingsResponse.parse(dispatchPayload(await singleton(dispatchSettingsTable, dispatchDefaults))));
});
router.patch("/admin/settings/dispatch", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const parsed = UpdateAdminDispatchSettingsBody.safeParse(req.body);
  if (!parsed.success || !validDispatchSettings(parsed.data)) {
    res.status(400).json({ error: "Dispatch radii must strictly increase and staged timing must fit within total expiration." });
    return;
  }
  const actorProfileId = currentAuth(res).profileId;
  const [row] = await db.insert(dispatchSettingsTable).values({ ...dispatchDefaults, ...parsed.data, updatedByProfileId: actorProfileId })
    .onConflictDoUpdate({ target: dispatchSettingsTable.id, set: { ...parsed.data, updatedByProfileId: actorProfileId, updatedAt: new Date() } }).returning();
  await db.insert(adminAuditLogsTable).values({ actorProfileId, action: "settings.dispatch.updated", entityType: "dispatch_settings", metadata: {} });
  res.json(UpdateAdminDispatchSettingsResponse.parse(dispatchPayload(row))); publishAdminUpdate();
});
router.put("/admin/settings/email", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const parsed = UpdateAdminEmailSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid email preferences." }); return; }
  const actorProfileId = currentAuth(res).profileId;
  const data = { ...parsed.data, welcomeEnabled: boolText(parsed.data.welcomeEnabled), passwordResetEnabled: boolText(parsed.data.passwordResetEnabled), orderConfirmationEnabled: boolText(parsed.data.orderConfirmationEnabled), orderDeliveredEnabled: boolText(parsed.data.orderDeliveredEnabled) };
  const [row] = await db.insert(emailSettingsTable).values({ ...emailDefaults, ...data, updatedByProfileId: actorProfileId }).onConflictDoUpdate({ target: emailSettingsTable.id, set: { ...data, updatedByProfileId: actorProfileId, updatedAt: new Date() } }).returning();
  await db.insert(adminAuditLogsTable).values({ actorProfileId, action: "settings.email.updated", entityType: "email_settings", metadata: {} });
  res.json(UpdateAdminEmailSettingsResponse.parse(emailPayload(row))); publishAdminUpdate();
});
router.post("/admin/settings/email/test", requireAdminRoles("admin"), async (_req, res): Promise<void> => {
  const actor = currentAuth(res); const [profile] = await db.select({ email: profilesTable.email }).from(profilesTable).where(eq(profilesTable.id, actor.profileId)).limit(1);
  const settings = await singleton(emailSettingsTable, emailDefaults);
  try { await sendAdminTestEmail(profile!.email, settings.senderDisplayName, settings.replyToEmail); await db.insert(adminAuditLogsTable).values({ actorProfileId: actor.profileId, action: "settings.email.test_sent", entityType: "email_settings", metadata: {} }); res.status(202).json({ accepted: true }); publishAdminUpdate(); }
  catch { await db.insert(adminAuditLogsTable).values({ actorProfileId: actor.profileId, action: "settings.email.test_failed", entityType: "email_settings", metadata: {} }); res.status(503).json({ error: "Email service is unavailable." }); }
});

function promotionPayload(row: typeof promoCodesTable.$inferSelect) {
  return { id: row.id, code: row.code, description: row.description, discountType: row.discountType, discountValue: Number(row.discountValue), startsAt: row.startsAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null, maxRedemptions: row.maxRedemptions === null ? null : Number(row.maxRedemptions), redemptionCount: Number(row.redemptionCount), active: row.active === "true", createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function validPromotionDates(data: { startsAt: string | Date | null; expiresAt: string | Date | null }) {
  return !data.startsAt || !data.expiresAt || new Date(data.startsAt) < new Date(data.expiresAt);
}
router.post("/admin/promotions", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const parsed = CreateAdminPromotionBody.safeParse(req.body);
  if (!parsed.success || parsed.data.discountType === "percent" && parsed.data.discountValue > 100 || !validPromotionDates(parsed.data)) { res.status(400).json({ error: "Invalid promotion." }); return; }
  const actorProfileId = currentAuth(res).profileId; const data = parsed.data;
  try {
    const [row] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(promoCodesTable).values({ code: data.code.trim().toUpperCase(), description: data.description, discountType: data.discountType, discountValue: String(data.discountValue), startsAt: data.startsAt ? new Date(data.startsAt) : null, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null, maxRedemptions: data.maxRedemptions === null ? null : String(data.maxRedemptions) }).returning();
      await tx.insert(adminAuditLogsTable).values({ actorProfileId, action: "promotion.created", entityType: "promo_code", entityId: created.id, metadata: {} }); return [created];
    });
    res.status(201).json(CreateAdminPromotionResponse.parse(promotionPayload(row))); publishAdminUpdate();
  } catch { res.status(409).json({ error: "A promotion already uses that code." }); }
});
router.put("/admin/promotions/:id", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const params = UpdateAdminPromotionParams.safeParse(req.params); const parsed = UpdateAdminPromotionBody.safeParse(req.body);
  if (!params.success || !parsed.success || parsed.data.discountType === "percent" && parsed.data.discountValue > 100 || !validPromotionDates(parsed.success ? parsed.data : { startsAt: null, expiresAt: null })) { res.status(400).json({ error: "Invalid promotion." }); return; }
  const actorProfileId = currentAuth(res).profileId; const d = parsed.data;
  try {
    const row = await db.transaction(async (tx) => { const [existing] = await tx.select().from(promoCodesTable).where(eq(promoCodesTable.id, params.data.id)).for("update").limit(1); if (!existing) return null;
      // A promotion can be safely described or scheduled after redemption, but
      // its economic terms and identifier are the historical redemption record.
      // Never rewrite those terms, and do not lower a redemption cap below use.
      if (
        Number(existing.redemptionCount) > 0 &&
        (
          existing.code !== d.code.trim().toUpperCase() ||
          existing.discountType !== d.discountType ||
          Number(existing.discountValue) !== d.discountValue ||
          (d.maxRedemptions !== null && d.maxRedemptions < Number(existing.redemptionCount))
        )
      ) return "redemptionConflict" as const;
      const [updated] = await tx.update(promoCodesTable).set({ code: d.code.trim().toUpperCase(), description: d.description, discountType: d.discountType, discountValue: String(d.discountValue), startsAt: d.startsAt ? new Date(d.startsAt) : null, expiresAt: d.expiresAt ? new Date(d.expiresAt) : null, maxRedemptions: d.maxRedemptions === null ? null : String(d.maxRedemptions) }).where(eq(promoCodesTable.id, existing.id)).returning();
      await tx.insert(adminAuditLogsTable).values({ actorProfileId, action: "promotion.updated", entityType: "promo_code", entityId: updated.id, metadata: {} }); return updated; });
    if (row === "redemptionConflict") { res.status(409).json({ error: "Redeemed promotion terms cannot be changed." }); return; }
    if (!row) { res.status(404).json({ error: "Promotion not found." }); return; } res.json(UpdateAdminPromotionResponse.parse(promotionPayload(row))); publishAdminUpdate();
  } catch { res.status(409).json({ error: "A promotion already uses that code." }); }
});
router.post("/admin/promotions/:id/status", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const params = UpdateAdminPromotionStatusParams.safeParse(req.params); const body = UpdateAdminPromotionStatusBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid promotion status." }); return; }
  const [row] = await db.update(promoCodesTable).set({ active: boolText(body.data.active) }).where(eq(promoCodesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Promotion not found." }); return; }
  await db.insert(adminAuditLogsTable).values({ actorProfileId: currentAuth(res).profileId, action: `promotion.${body.data.active ? "activated" : "deactivated"}`, entityType: "promo_code", entityId: row.id, metadata: {} });
  res.json(UpdateAdminPromotionStatusResponse.parse(promotionPayload(row))); publishAdminUpdate();
});
router.get("/admin/settings/integrations", requireAdminRoles("admin"), async (_req, res) => {
  const checked = new Date().toISOString(); let databaseHealthy = true;
  try { await db.select({ id: profilesTable.id }).from(profilesTable).limit(1); } catch { databaseHealthy = false; }
  const configuredConnector = Boolean(process.env.REPLIT_CONNECTORS_HOSTNAME && (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL));
  const storageConfigured = Boolean(process.env.PRIVATE_OBJECT_DIR);
  const mapsConfigured = Boolean(process.env.GOOGLE_MAPS_SERVER_API_KEY);
  const stripeConfigured = configuredConnector || process.env.PAYMENTS_TEST_MODE === "true";
  let stripeHealthy = false;
  if (stripeConfigured) {
    try { await getStripeCredentials(); stripeHealthy = true; } catch { stripeHealthy = false; }
  }
  const resendConfigured = configuredConnector && Boolean(process.env.PASSWORD_RESET_FROM_EMAIL);
  res.json(GetAdminIntegrationHealthResponse.parse({ api: { configured: true, healthy: true, lastCheckedAt: checked }, database: { configured: true, healthy: databaseHealthy, lastCheckedAt: checked }, storage: { configured: storageConfigured, healthy: storageConfigured, lastCheckedAt: checked }, googleMaps: { configured: mapsConfigured, healthy: mapsConfigured, lastCheckedAt: checked }, stripe: { configured: stripeConfigured, healthy: stripeHealthy, lastCheckedAt: checked }, resend: { configured: resendConfigured, healthy: resendConfigured, lastCheckedAt: checked } }));
});
router.get("/admin/settings/system-status", requireAdminRoles("admin"), async (_req, res) => {
  let database = "healthy"; try { await db.select({ id: profilesTable.id }).from(profilesTable).limit(1); } catch { database = "unavailable"; }
  res.json(GetAdminSystemStatusResponse.parse({ api: "healthy", database, uptimeSeconds: Math.floor(process.uptime()), checkedAt: new Date().toISOString() }));
});

export default router;