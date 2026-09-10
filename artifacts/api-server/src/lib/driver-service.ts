import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import {
  db,
  adminAuditLogsTable,
  deliveriesTable,
  deliveryStatusHistoryTable,
  deliveryVerificationsTable,
  driverApplicationsTable,
  driverDocumentsTable,
  driverEarningsTable,
  driverDeliveryOfferAttemptsTable,
  driverIncidentsTable,
  driverPreferencesTable,
  dispatchSettingsTable,
  generalSettingsTable,
  driversTable,
  profilesTable,
} from "@workspace/db";
import { mapDelivery, type DeliveryStatus } from "./delivery-service";
import { publishDeliveryEvent, recordDeliveryEvent } from "./delivery-events";
import { hasCurrentDriverCompliance } from "./driver-compliance";

type OnboardingInput = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  licenseState?: string;
  licenseLastFour?: string;
  vehicleType?: string;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  licensePlate?: string;
  insuranceProvider?: string;
  insuranceExpiresAt?: Date;
  acknowledgeSafety?: boolean;
};

type ProfileUpdateInput = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  vehicleType?: "sedan" | "suv" | "van" | "truck";
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  licensePlate?: string;
  licenseState?: string;
  licenseLastFour?: string;
  insuranceProvider?: string;
  insuranceExpiresAt?: Date;
};

const requiredOnboardingDocumentTypes = ["license", "insurance", "vehicle_registration"] as const;
const vehicleTypes = new Set(["sedan", "suv", "van", "truck"]);
const locationFreshnessMs = 5 * 60_000;
const meterPerMile = 1609.344;
const dispatchRouteCache = new Map<string, { value: PickupRoute; expiresAt: number }>();
type PickupRoute = { distanceMiles: number; minutes: number; source: "road" | "fallback" };
let pickupRouteProviderOverride: ((origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) => Promise<PickupRoute>) | undefined;

/** Test seam: integration tests can exercise eligibility without network access. */
export function setPickupRouteProviderForTests(provider?: typeof pickupRouteProviderOverride): void {
  pickupRouteProviderOverride = provider;
  dispatchRouteCache.clear();
}
const complianceFields = new Set<keyof ProfileUpdateInput>([
  "vehicleType", "vehicleYear", "vehicleMake", "vehicleModel", "vehicleColor", "licensePlate",
  "licenseState", "licenseLastFour", "insuranceProvider", "insuranceExpiresAt",
]);

function hasRequiredValue(value: string | Date | null | undefined): boolean {
  return value instanceof Date || (typeof value === "string" && value.trim().length > 0);
}

function numberValue(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

function haversineMiles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function pickupRoute(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }): Promise<PickupRoute> {
  if (pickupRouteProviderOverride) return pickupRouteProviderOverride(origin, destination);
  const cacheKey = `${origin.latitude.toFixed(4)},${origin.longitude.toFixed(4)}:${destination.latitude.toFixed(4)},${destination.longitude.toFixed(4)}`;
  const cached = dispatchRouteCache.get(cacheKey);
  if (cached?.expiresAt && cached.expiresAt > Date.now()) return cached.value;
  const fallback = (): PickupRoute => {
    const distanceMiles = haversineMiles(origin, destination);
    // Conservative city-driving estimate (20 mph) when Maps is unavailable.
    return { distanceMiles, minutes: Math.ceil(distanceMiles * 3), source: "fallback" };
  };
  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) return fallback();
  try {
    const response = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration",
      },
      body: JSON.stringify({
        origins: [{ waypoint: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } } }],
        destinations: [{ waypoint: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } } }],
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error("Route matrix unavailable");
    const rows = await response.json() as Array<{ distanceMeters?: number; duration?: string }>;
    const row = rows[0];
    const seconds = row?.duration ? Number.parseFloat(row.duration) : NaN;
    if (!row || !Number.isFinite(row.distanceMeters) || !Number.isFinite(seconds)) throw new Error("Invalid route matrix result");
    const value = { distanceMiles: row.distanceMeters! / meterPerMile, minutes: Math.ceil(seconds / 60), source: "road" as const };
    dispatchRouteCache.set(cacheKey, { value, expiresAt: Date.now() + 30_000 });
    return value;
  } catch {
    return fallback();
  }
}

function areaFromAddress(address: string): string {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? `${parts.at(-2) ?? "Raleigh"} area` : "Raleigh area";
}

function isWithinWorkingHours(hours: Record<string, Array<{ start: string; end: string }>>, timeZone: string, now = new Date()): boolean {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const day = value("weekday").toLowerCase();
  const current = `${value("hour")}:${value("minute")}`;
  return (hours[day] ?? []).some((range) => range.start <= current && current < range.end);
}

function profileResponse(
  profile: typeof profilesTable.$inferSelect,
  driver: typeof driversTable.$inferSelect,
  application?: typeof driverApplicationsTable.$inferSelect,
) {
  const vehicle = [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(" ") || null;
  return {
    id: driver.id,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    address: profile.address,
    emergencyContactName: profile.emergencyContactName,
    emergencyContactPhone: profile.emergencyContactPhone,
    approvalStatus: driver.approvalStatus as "pending" | "approved" | "rejected",
    availabilityStatus: driver.availabilityStatus === "online" ? "online" as const : "offline" as const,
    rating: driver.rating,
    completedDeliveries: Number(driver.totalDeliveries),
    vehicle,
    licensePlate: driver.licensePlate,
    complianceReviewStatus: (application?.pendingProfileReviewStatus === "pending" ||
      application?.pendingProfileReviewStatus === "approved" ||
      application?.pendingProfileReviewStatus === "rejected"
      ? application.pendingProfileReviewStatus
      : "none") as "none" | "pending" | "approved" | "rejected",
    complianceReviewReason: application?.pendingProfileReviewReason ?? null,
  };
}

export async function driverContext(profileId: string) {
  const [row] = await db
    .select({ profile: profilesTable, driver: driversTable })
    .from(profilesTable)
    .innerJoin(driversTable, eq(driversTable.profileId, profilesTable.id))
    .where(eq(profilesTable.id, profileId))
    .limit(1);
  if (!row) throw new Error("Driver profile is not available.");
  return row;
}

export async function getDriverProfile(profileId: string) {
  const { profile, driver } = await driverContext(profileId);
  const [application] = await db.select().from(driverApplicationsTable)
    .where(eq(driverApplicationsTable.driverId, driver.id)).limit(1);
  return profileResponse(profile, driver, application);
}

function profileUpdateResult(
  profile: typeof profilesTable.$inferSelect,
  driver: typeof driversTable.$inferSelect,
  application: typeof driverApplicationsTable.$inferSelect | undefined,
) {
  const complianceReviewStatus = (application?.pendingProfileReviewStatus === "pending" ||
    application?.pendingProfileReviewStatus === "approved" ||
    application?.pendingProfileReviewStatus === "rejected"
    ? application.pendingProfileReviewStatus
    : "none") as "none" | "pending" | "approved" | "rejected";
  return {
    profile: profileResponse(profile, driver, application),
    complianceReviewStatus,
    complianceReviewReason: application?.pendingProfileReviewReason ?? null,
  };
}

export async function updateDriverProfile(profileId: string, input: ProfileUpdateInput) {
  return db.transaction(async (tx) => {
    const [context] = await tx.select({ profile: profilesTable, driver: driversTable })
      .from(profilesTable).innerJoin(driversTable, eq(driversTable.profileId, profilesTable.id))
      .where(eq(profilesTable.id, profileId)).for("update").limit(1);
    if (!context) throw new Error("Driver profile is not available.");
    const [application] = await tx.select().from(driverApplicationsTable)
      .where(eq(driverApplicationsTable.driverId, context.driver.id)).for("update").limit(1);
    const safeKeys = ["firstName", "lastName", "phone", "address", "emergencyContactName", "emergencyContactPhone"] as const;
    const safeUpdate = Object.fromEntries(safeKeys
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]!.trim()]));
    if (Object.keys(safeUpdate).length) {
      await tx.update(profilesTable).set(safeUpdate).where(eq(profilesTable.id, profileId));
    }
    const pendingChanges = Object.fromEntries(Object.entries(input)
      .filter(([key, value]) => complianceFields.has(key as keyof ProfileUpdateInput) && value !== undefined)
      .map(([key, value]) => [key, value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "number" ? value : value.trim()])) as Record<string, string | number>;
    if (Object.keys(pendingChanges).length) {
      const oldValues = {
        vehicleType: context.driver.vehicleType, vehicleYear: context.driver.vehicleYear, vehicleMake: context.driver.vehicleMake,
        vehicleModel: context.driver.vehicleModel, vehicleColor: context.driver.vehicleColor,
        licensePlate: context.driver.licensePlate, licenseState: application?.licenseState ?? null,
        licenseLastFour: application?.licenseLastFour ?? null,
        insuranceProvider: application?.insuranceProvider ?? null,
        insuranceExpiresAt: application?.insuranceExpiresAt?.toISOString().slice(0, 10) ?? null,
      };
      const values = {
        driverId: context.driver.id,
        pendingProfileChanges: pendingChanges,
        pendingProfileReviewStatus: "pending",
        pendingProfileReviewReason: null,
        pendingProfileSubmittedAt: new Date(),
        pendingProfileReviewedAt: null,
        pendingProfileReviewedBy: null,
      };
      await tx.insert(driverApplicationsTable).values(values).onConflictDoUpdate({
        target: driverApplicationsTable.driverId, set: values,
      });
      await tx.insert(adminAuditLogsTable).values({
        actorProfileId: profileId, action: "driver.profile_change_submitted",
        entityType: "driver", entityId: context.driver.id,
        metadata: { oldValues, newValues: pendingChanges },
      });
    }
    if (Object.keys(safeUpdate).length) {
      await tx.insert(adminAuditLogsTable).values({
        actorProfileId: profileId, action: "driver.profile_safe_fields_updated",
        entityType: "driver", entityId: context.driver.id,
        metadata: {
          oldValues: Object.fromEntries(Object.keys(safeUpdate).map((key) => [key, context.profile[key as keyof typeof context.profile] ?? null])),
          newValues: safeUpdate,
        },
      });
    }
    const [profile] = await tx.select().from(profilesTable).where(eq(profilesTable.id, profileId)).limit(1);
    const [driver] = await tx.select().from(driversTable).where(eq(driversTable.id, context.driver.id)).limit(1);
    const [updatedApplication] = await tx.select().from(driverApplicationsTable).where(eq(driverApplicationsTable.driverId, context.driver.id)).limit(1);
    return profileUpdateResult(profile!, driver!, updatedApplication);
  });
}

export async function reviewDriverProfileUpdate(driverId: string, actorProfileId: string, decision: "approved" | "rejected", reason: string) {
  return db.transaction(async (tx) => {
    const [driver] = await tx.select().from(driversTable).where(eq(driversTable.id, driverId)).for("update").limit(1);
    if (!driver) return null;
    const [application] = await tx.select().from(driverApplicationsTable)
      .where(eq(driverApplicationsTable.driverId, driver.id)).for("update").limit(1);
    if (!application || application.pendingProfileReviewStatus !== "pending" || !application.pendingProfileChanges) {
      return "not_pending" as const;
    }
    const changes = application.pendingProfileChanges;
    const oldValues = {
      vehicleType: driver.vehicleType, vehicleYear: driver.vehicleYear, vehicleMake: driver.vehicleMake,
      vehicleModel: driver.vehicleModel, vehicleColor: driver.vehicleColor, licensePlate: driver.licensePlate,
      licenseState: application.licenseState, licenseLastFour: application.licenseLastFour,
      insuranceProvider: application.insuranceProvider, insuranceExpiresAt: application.insuranceExpiresAt?.toISOString().slice(0, 10) ?? null,
    };
    if (decision === "approved") {
      const driverUpdate = Object.fromEntries(["vehicleType", "vehicleYear", "vehicleMake", "vehicleModel", "vehicleColor", "licensePlate"]
        .filter((key) => changes[key] !== undefined).map((key) => [key, key === "vehicleYear" ? String(changes[key]) : changes[key]]));
      const applicationUpdate: {
        licenseState?: string;
        licenseLastFour?: string;
        insuranceProvider?: string;
        insuranceExpiresAt?: Date;
      } = {
        ...(changes.licenseState !== undefined ? { licenseState: String(changes.licenseState) } : {}),
        ...(changes.licenseLastFour !== undefined ? { licenseLastFour: String(changes.licenseLastFour) } : {}),
        ...(changes.insuranceProvider !== undefined ? { insuranceProvider: String(changes.insuranceProvider) } : {}),
        ...(changes.insuranceExpiresAt ? { insuranceExpiresAt: new Date(`${String(changes.insuranceExpiresAt)}T00:00:00.000Z`) } : {}),
      };
      if (Object.keys(driverUpdate).length) await tx.update(driversTable).set(driverUpdate).where(eq(driversTable.id, driver.id));
      if (Object.keys(applicationUpdate).length) await tx.update(driverApplicationsTable).set(applicationUpdate).where(eq(driverApplicationsTable.id, application.id));
    }
    await tx.update(driverApplicationsTable).set({
      pendingProfileReviewStatus: decision,
      pendingProfileReviewReason: decision === "rejected" ? reason : null,
      pendingProfileReviewedAt: new Date(),
      pendingProfileReviewedBy: actorProfileId,
      ...(decision === "approved" ? { pendingProfileChanges: null } : {}),
    }).where(eq(driverApplicationsTable.id, application.id));
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId, action: `driver.profile_change_${decision}`, entityType: "driver", entityId: driver.id,
      metadata: { oldValues, newValues: changes, reason: reason || null, decision },
    });
    const [profile] = await tx.select().from(profilesTable).where(eq(profilesTable.id, driver.profileId)).limit(1);
    const [updatedDriver] = await tx.select().from(driversTable).where(eq(driversTable.id, driver.id)).limit(1);
    const [updatedApplication] = await tx.select().from(driverApplicationsTable).where(eq(driverApplicationsTable.id, application.id)).limit(1);
    return profileUpdateResult(profile!, updatedDriver!, updatedApplication);
  });
}

export async function getDriverOnboarding(profileId: string) {
  const { profile, driver } = await driverContext(profileId);
  const [application] = await db
    .select()
    .from(driverApplicationsTable)
    .where(eq(driverApplicationsTable.driverId, driver.id))
    .limit(1);
  const documents = await db
    .select()
    .from(driverDocumentsTable)
    .where(eq(driverDocumentsTable.driverId, driver.id))
    .orderBy(desc(driverDocumentsTable.createdAt));
  return {
    profile: profileResponse(profile, driver, application),
    onboardingStatus: (driver.onboardingStatus === "approved" || driver.onboardingStatus === "rejected" || driver.onboardingStatus === "submitted"
      ? driver.onboardingStatus
      : "pending") as "pending" | "submitted" | "approved" | "rejected",
    backgroundCheckStatus: (application?.backgroundCheckStatus === "pending" || application?.backgroundCheckStatus === "clear" || application?.backgroundCheckStatus === "review"
      ? application.backgroundCheckStatus
      : "not_started") as "not_started" | "pending" | "clear" | "review",
    mvrCheckStatus: (application?.mvrCheckStatus === "pending" || application?.mvrCheckStatus === "clear" || application?.mvrCheckStatus === "review"
      ? application.mvrCheckStatus
      : "not_started") as "not_started" | "pending" | "clear" | "review",
    licenseState: application?.licenseState ?? null,
    licenseLastFour: application?.licenseLastFour ?? null,
    insuranceProvider: application?.insuranceProvider ?? null,
    insuranceExpiresAt: application?.insuranceExpiresAt?.toISOString().slice(0, 10) ?? null,
    vehicleType: driver.vehicleType as "sedan" | "suv" | "van" | "truck" | null,
    vehicleYear: driver.vehicleYear ? Number(driver.vehicleYear) : null,
    vehicleMake: driver.vehicleMake,
    vehicleModel: driver.vehicleModel,
    vehicleColor: driver.vehicleColor,
    licensePlate: driver.licensePlate,
    documents: documents.map((document) => ({
      id: document.id,
      documentType: document.documentType as "driver_photo" | "license" | "insurance" | "vehicle_registration",
      verificationStatus: document.verificationStatus as "pending" | "approved" | "rejected",
      expiryDate: document.expiryDate,
      rejectionReason: document.rejectionReason,
      createdAt: document.createdAt.toISOString(),
    })),
  };
}

export async function updateDriverOnboarding(profileId: string, input: OnboardingInput) {
  await db.transaction(async (tx) => {
    const [context] = await tx
      .select({ profile: profilesTable, driver: driversTable })
      .from(profilesTable)
      .innerJoin(driversTable, eq(driversTable.profileId, profilesTable.id))
      .where(eq(profilesTable.id, profileId))
      .for("update")
      .limit(1);
    if (!context) throw new Error("Driver profile is not available.");
    const { profile, driver } = context;
    const [application] = await tx
      .select()
      .from(driverApplicationsTable)
      .where(eq(driverApplicationsTable.driverId, driver.id))
      .for("update")
      .limit(1);
    const documents = await tx
      .select()
      .from(driverDocumentsTable)
      .where(eq(driverDocumentsTable.driverId, driver.id))
      .orderBy(desc(driverDocumentsTable.createdAt));
    const latestDocuments = new Map<string, typeof documents[number]>();
    for (const document of documents) {
      if (!latestDocuments.has(document.documentType)) latestDocuments.set(document.documentType, document);
    }
    const submit = input.acknowledgeSafety === true;
    if (submit) {
      const requiredFields = [
        input.firstName ?? profile.firstName,
        input.lastName ?? profile.lastName,
        input.phone ?? profile.phone,
        input.licenseState ?? application?.licenseState,
        input.licenseLastFour ?? application?.licenseLastFour,
        input.vehicleType ?? driver.vehicleType,
        input.vehicleMake ?? driver.vehicleMake,
        input.vehicleModel ?? driver.vehicleModel,
        input.vehicleColor ?? driver.vehicleColor,
        input.licensePlate ?? driver.licensePlate,
        input.insuranceProvider ?? application?.insuranceProvider,
        input.insuranceExpiresAt ?? application?.insuranceExpiresAt,
      ];
      if (!requiredFields.every(hasRequiredValue) || !vehicleTypes.has(input.vehicleType ?? driver.vehicleType ?? "")) {
        throw new Error("Complete every required onboarding field before submitting.");
      }
      if (!requiredOnboardingDocumentTypes.every((type) => {
        const document = latestDocuments.get(type);
        return document && document.verificationStatus !== "rejected";
      })) {
        throw new Error("Upload current, non-rejected copies of all required documents before submitting.");
      }
    }
    const profileUpdate = {
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    };
    if (Object.keys(profileUpdate).length) {
      await tx.update(profilesTable).set(profileUpdate).where(eq(profilesTable.id, profileId));
    }
    const driverUpdate = {
      ...(input.vehicleType ? { vehicleType: input.vehicleType } : {}),
      ...(input.vehicleYear ? { vehicleYear: String(input.vehicleYear) } : {}),
      ...(input.vehicleMake ? { vehicleMake: input.vehicleMake } : {}),
      ...(input.vehicleModel ? { vehicleModel: input.vehicleModel } : {}),
      ...(input.vehicleColor ? { vehicleColor: input.vehicleColor } : {}),
      ...(input.licensePlate ? { licensePlate: input.licensePlate } : {}),
      ...(submit ? { onboardingStatus: "submitted" } : {}),
    };
    if (Object.keys(driverUpdate).length) {
      await tx.update(driversTable).set(driverUpdate).where(eq(driversTable.id, driver.id));
    }
    const applicationValues = {
      driverId: driver.id,
      ...(input.licenseState ? { licenseState: input.licenseState } : {}),
      ...(input.licenseLastFour ? { licenseLastFour: input.licenseLastFour } : {}),
      ...(input.insuranceProvider ? { insuranceProvider: input.insuranceProvider } : {}),
      ...(input.insuranceExpiresAt ? { insuranceExpiresAt: input.insuranceExpiresAt } : {}),
      ...(input.acknowledgeSafety ? { safetyAcknowledgedAt: new Date() } : {}),
      ...(submit
        ? { backgroundCheckStatus: "pending", mvrCheckStatus: "pending", submittedAt: new Date() }
        : {}),
    };
    await tx
      .insert(driverApplicationsTable)
      .values(applicationValues)
      .onConflictDoUpdate({
        target: driverApplicationsTable.driverId,
        set: applicationValues,
      });
  });
  return getDriverOnboarding(profileId);
}

export async function updateDriverAvailability(profileId: string, availabilityStatus: "online" | "offline") {
  const { profile, driver } = await driverContext(profileId);
  if (availabilityStatus === "online" && driver.approvalStatus !== "approved") {
    throw new Error("Your driver application must be approved before you can go online.");
  }
  if (availabilityStatus === "online") {
    if (!(await hasCurrentDriverCompliance(driver.id))) {
      throw new Error("Current approved license, insurance, and vehicle registration documents are required before going online.");
    }
  }
  const [updated] = await db
    .update(driversTable)
    .set({ availabilityStatus })
    .where(eq(driversTable.id, driver.id))
    .returning();
  return profileResponse(profile, updated);
}

type DriverSettingsInput = {
  notificationSound?: boolean;
  vibration?: boolean;
  workingHoursEnabled?: boolean;
  navigationApp?: "google_maps" | "apple_maps" | "waze" | "system";
  preferredMaxRangeMiles?: 3 | 5 | 8 | 12;
  workingHours?: Record<string, Array<{ start: string; end: string }>>;
};

function validWorkingHours(hours: Record<string, Array<{ start: string; end: string }>>): boolean {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  return Object.keys(hours).length <= 7 && Object.entries(hours).every(([day, ranges]) =>
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(day) &&
    ranges.length <= 4 &&
    ranges.every(({ start, end }) => time.test(start) && time.test(end) && start < end) &&
    [...ranges].sort((left, right) => left.start.localeCompare(right.start))
      .every((range, index, sorted) => index === 0 || sorted[index - 1]!.end <= range.start),
  );
}

function driverSettingsResponse(
  driver: typeof driversTable.$inferSelect,
  preferences?: typeof driverPreferencesTable.$inferSelect,
  timeZone = "UTC",
) {
  const lastUpdatedAt = driver.lastLocationUpdate?.toISOString() ?? null;
  const fresh = driver.lastLocationUpdate && Date.now() - driver.lastLocationUpdate.getTime() <= 5 * 60_000;
  return {
    notificationSound: preferences?.notificationSound ?? true,
    vibration: preferences?.vibration ?? true,
    workingHoursEnabled: preferences?.workingHoursEnabled ?? false,
    navigationApp: (preferences?.navigationApp ?? "system") as "google_maps" | "apple_maps" | "waze" | "system",
    preferredMaxRangeMiles: (preferences?.preferredMaxRangeMiles ?? 12) as 3 | 5 | 8 | 12,
    workingHours: preferences?.workingHours ?? {},
    timeZone,
    // This describes server-observed freshness only; OS location permission stays device-managed.
    location: { status: !lastUpdatedAt ? "unavailable" as const : fresh ? "fresh" as const : "stale" as const, lastUpdatedAt },
  };
}

export async function getDriverSettings(profileId: string) {
  const { driver } = await driverContext(profileId);
  const [preferences] = await db.select().from(driverPreferencesTable)
    .where(eq(driverPreferencesTable.driverId, driver.id)).limit(1);
  const [general] = await db.select({ timeZone: generalSettingsTable.timeZone }).from(generalSettingsTable).where(eq(generalSettingsTable.id, "general")).limit(1);
  return driverSettingsResponse(driver, preferences, general?.timeZone ?? "UTC");
}

export async function updateDriverSettings(profileId: string, input: DriverSettingsInput) {
  if (input.workingHours && !validWorkingHours(input.workingHours)) {
    throw new Error("Working hours must use weekday keys and non-overlapping same-day HH:MM ranges.");
  }
  const { driver } = await driverContext(profileId);
  const values = {
    driverId: driver.id,
    ...(input.notificationSound === undefined ? {} : { notificationSound: input.notificationSound }),
    ...(input.vibration === undefined ? {} : { vibration: input.vibration }),
    ...(input.workingHoursEnabled === undefined ? {} : { workingHoursEnabled: input.workingHoursEnabled }),
    ...(input.navigationApp === undefined ? {} : { navigationApp: input.navigationApp }),
    ...(input.preferredMaxRangeMiles === undefined ? {} : { preferredMaxRangeMiles: input.preferredMaxRangeMiles }),
    ...(input.workingHours === undefined ? {} : { workingHours: input.workingHours }),
  };
  const [preferences] = await db.insert(driverPreferencesTable).values(values).onConflictDoUpdate({
    target: driverPreferencesTable.driverId,
    set: { ...values, updatedAt: new Date() },
  }).returning();
  const [general] = await db.select({ timeZone: generalSettingsTable.timeZone }).from(generalSettingsTable).where(eq(generalSettingsTable.id, "general")).limit(1);
  return driverSettingsResponse(driver, preferences, general?.timeZone ?? "UTC");
}

async function refreshExpiredOffers(): Promise<void> {
  const now = new Date();
  const [policy] = await db.insert(dispatchSettingsTable).values({
    id: "dispatch", initialRadiusMiles: 3, initialDurationSeconds: 30,
    expansionStages: [{ radiusMiles: 5, durationSeconds: 30 }, { radiusMiles: 8, durationSeconds: 60 }, { radiusMiles: 12, durationSeconds: 480 }],
    maximumPickupEtaMinutes: 15, totalExpirationSeconds: 600,
  }).onConflictDoNothing().returning();
  const settings = policy ?? (await db.select().from(dispatchSettingsTable).where(eq(dispatchSettingsTable.id, "dispatch")).limit(1))[0];
  if (!settings) throw new Error("Dispatch settings could not be initialized.");
  const totalExpiry = new Date(now.getTime() - settings.totalExpirationSeconds * 1000);
  await db.transaction(async (tx) => {
    const expiredDeliveries = await tx
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(and(
        eq(deliveriesTable.deliveryStatus, "searching_driver"),
        isNull(deliveriesTable.driverId),
        lt(sql`coalesce(${deliveriesTable.dispatchStartedAt}, ${deliveriesTable.createdAt})`, totalExpiry),
      ))
      .for("update");
    if (!expiredDeliveries.length) return;
    const deliveryIds = expiredDeliveries.map(({ id }) => id);
    await tx
      .update(driverDeliveryOfferAttemptsTable)
      .set({ response: "expired", respondedAt: now })
      .where(and(
        inArray(driverDeliveryOfferAttemptsTable.deliveryId, deliveryIds),
        eq(driverDeliveryOfferAttemptsTable.response, "offered"),
      ));
  });
}

export async function listDriverOffers(profileId: string) {
  const { driver, profile } = await driverContext(profileId);
  if (profile.status !== "active" || driver.approvalStatus !== "approved" || !["online", "available"].includes(driver.availabilityStatus)) {
    throw new Error("Only approved online drivers can receive delivery offers.");
  }
  if (!(await hasCurrentDriverCompliance(driver.id))) {
    throw new Error("Current approved compliance documents are required before receiving new work.");
  }
  // Paid scheduled deliveries remain out of matching until the lead time.
  // Listing offers is an existing worker/read path, so activate due work
  // atomically before evaluating offers; ASAP behavior remains unchanged.
  const dispatchDue = new Date(Date.now() + 30 * 60 * 1000);
  const dueScheduled = await db
    .select({ id: deliveriesTable.id, status: deliveriesTable.deliveryStatus })
    .from(deliveriesTable)
    .where(and(
      eq(deliveriesTable.deliveryStatus, "paid"),
      lte(deliveriesTable.scheduledPickupStartAt, dispatchDue),
      isNull(deliveriesTable.driverId),
    ));
  if (dueScheduled.length) {
    await db.transaction(async (tx) => {
      const ids = dueScheduled.map((delivery) => delivery.id);
      const activated = await tx.update(deliveriesTable).set({
        deliveryStatus: "searching_driver",
        dispatchStartedAt: new Date(),
        offerExpiresAt: new Date(Date.now() + 2 * 60_000),
      }).where(and(inArray(deliveriesTable.id, ids), eq(deliveriesTable.deliveryStatus, "paid"))).returning({ id: deliveriesTable.id });
      if (!activated.length) return;
      await tx.insert(deliveryStatusHistoryTable).values(activated.map(({ id }) => ({
        deliveryId: id,
        fromStatus: "paid" as const,
        toStatus: "searching_driver" as const,
        reason: "Scheduled pickup reached dispatch lead time.",
        metadata: { dispatchLeadTimeMinutes: 30 },
      })));
    });
  }
  if (!driver.lastLocationUpdate || Date.now() - driver.lastLocationUpdate.getTime() > locationFreshnessMs ||
    driver.currentLatitude == null || driver.currentLongitude == null) {
    return [];
  }
  const [active] = await db.select({ activeCount: sql<number>`count(*)::int` }).from(deliveriesTable).where(and(
    eq(deliveriesTable.driverId, driver.id), notInArray(deliveriesTable.deliveryStatus, ["delivered", "cancelled", "failed", "refunded"]),
  ));
  if ((active?.activeCount ?? 0) > 0) return [];
  await refreshExpiredOffers();
  const [settings] = await db.select().from(dispatchSettingsTable).where(eq(dispatchSettingsTable.id, "dispatch")).limit(1);
  if (!settings) throw new Error("Dispatch settings could not be initialized.");
  const [preferences] = await db.select().from(driverPreferencesTable).where(eq(driverPreferencesTable.driverId, driver.id)).limit(1);
  const driverCap = preferences?.preferredMaxRangeMiles ?? 12;
  if (preferences?.workingHoursEnabled) {
    const [general] = await db.select({ timeZone: generalSettingsTable.timeZone }).from(generalSettingsTable)
      .where(eq(generalSettingsTable.id, "general")).limit(1);
    if (!isWithinWorkingHours(preferences.workingHours, general?.timeZone ?? "UTC")) return [];
  }
  const records = await db
    .select()
    .from(deliveriesTable)
    .where(
      and(
        eq(deliveriesTable.deliveryStatus, "searching_driver"),
        isNull(deliveriesTable.driverId),
        sql`NOT EXISTS (
          SELECT 1
          FROM ${driverDeliveryOfferAttemptsTable} AS prior_offer
          WHERE prior_offer.delivery_id = ${deliveriesTable.id}
            AND prior_offer.driver_id = ${driver.id}
            AND prior_offer.response IN ('declined', 'expired')
        )`,
      ),
    )
    .orderBy(desc(deliveriesTable.createdAt))
    .limit(5);
  const now = Date.now();
  const candidates = records.filter((record) => {
    const elapsed = now - (record.dispatchStartedAt ?? record.createdAt).getTime();
    return elapsed >= 0 && elapsed < settings.totalExpirationSeconds * 1000 &&
      record.pickupLatitude != null && record.pickupLongitude != null;
  });
  const evaluated = await Promise.all(candidates.map(async (record) => {
    const elapsed = now - (record.dispatchStartedAt ?? record.createdAt).getTime();
    const stages = [{ radiusMiles: settings.initialRadiusMiles, durationSeconds: settings.initialDurationSeconds }, ...settings.expansionStages];
    let remaining = elapsed / 1000;
    let radius = stages.at(-1)!.radiusMiles;
    for (const stage of stages) { if (remaining < stage.durationSeconds) { radius = stage.radiusMiles; break; } remaining -= stage.durationSeconds; }
    const route = await pickupRoute(
      { latitude: driver.currentLatitude!, longitude: driver.currentLongitude! },
      { latitude: record.pickupLatitude!, longitude: record.pickupLongitude! },
    );
    return route.distanceMiles <= Math.min(radius, settings.maximumRadiusMiles, driverCap) && route.minutes <= settings.maximumPickupEtaMinutes ? { record, route } : null;
  }));
  const available = evaluated.filter((value): value is NonNullable<typeof value> => value !== null);
  await Promise.all(available.map(({ record }) => {
    const offerExpiresAt = new Date((record.dispatchStartedAt ?? record.createdAt).getTime() + settings.totalExpirationSeconds * 1000);
    return db.insert(driverDeliveryOfferAttemptsTable).values({
      deliveryId: record.id, driverId: driver.id, offeredAt: new Date(), offerExpiresAt,
      response: "offered",
    }).onConflictDoNothing();
  }));
  return available
    .map(({ record, route }) => ({
      id: record.publicDeliveryId,
      orderNumber: record.orderNumber,
      pickupArea: areaFromAddress(record.pickupAddress),
      dropoffArea: areaFromAddress(record.dropoffAddress),
       pickupDistanceMiles: Math.round(route.distanceMiles * 100) / 100,
       estimatedPickupMinutes: route.minutes,
       distanceSource: route.source,
      deliveryDistanceMiles: record.distanceMiles,
      expectedMinutes: Number(record.estimatedDurationMinutes ?? 0),
      scheduledPickupStartAt: record.scheduledPickupStartAt?.toISOString() ?? null,
      scheduledPickupEndAt: record.scheduledPickupEndAt?.toISOString() ?? null,
      category: record.packageCategory,
      size: record.sizeCategory,
      care: record.careLevel,
      earnings: Math.round(numberValue(record.totalPrice) * 70) / 100,
       expiresAt: new Date((record.dispatchStartedAt ?? record.createdAt).getTime() + settings.totalExpirationSeconds * 1000).toISOString(),
    }));
}

export class DriverOfferConflictError extends Error {}

export function isRetryableDriverOfferError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "40001" || code === "40P01";
}

export async function acceptDriverDelivery(profileId: string, publicDeliveryId: string) {
  const result = await db.transaction(async (tx) => {
    const [driver] = await tx
      .select()
      .from(driversTable)
      .where(eq(driversTable.profileId, profileId))
      .for("update")
      .limit(1);
    if (!driver || driver.approvalStatus !== "approved" || !["online", "available"].includes(driver.availabilityStatus)) {
      throw new Error("Only approved online drivers can accept deliveries.");
    }
    const [profile] = await tx.select({ status: profilesTable.status }).from(profilesTable)
      .where(eq(profilesTable.id, profileId)).limit(1);
    if (!profile || profile.status !== "active") throw new Error("Suspended drivers cannot accept deliveries.");
    if (!(await hasCurrentDriverCompliance(driver.id))) {
      throw new Error("Current approved compliance documents are required before accepting new work.");
    }
    const [current] = await tx
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.publicDeliveryId, publicDeliveryId))
      .for("update")
      .limit(1);
    if (!current) return { delivery: null, event: null };
    const [attempt] = await tx
      .select()
      .from(driverDeliveryOfferAttemptsTable)
      .where(and(
        eq(driverDeliveryOfferAttemptsTable.deliveryId, current.id),
        eq(driverDeliveryOfferAttemptsTable.driverId, driver.id),
      ))
      .for("update")
      .limit(1);
    if (!attempt) throw new DriverOfferConflictError("This delivery was not offered to you.");
    if (attempt.response !== "offered" || attempt.respondedAt) {
      throw new DriverOfferConflictError("This offer can no longer be accepted.");
    }
    const now = new Date();
    const [dispatch] = await tx.select().from(dispatchSettingsTable).where(eq(dispatchSettingsTable.id, "dispatch")).limit(1);
    if (!dispatch || (current.dispatchStartedAt ?? current.createdAt).getTime() + dispatch.totalExpirationSeconds * 1000 <= now.getTime()) {
      await tx.update(driverDeliveryOfferAttemptsTable).set({ response: "expired", respondedAt: now }).where(and(
        eq(driverDeliveryOfferAttemptsTable.deliveryId, current.id),
        eq(driverDeliveryOfferAttemptsTable.response, "offered"),
      ));
      throw new DriverOfferConflictError("This delivery offer has expired.");
    }
    if (attempt.offerExpiresAt <= now) {
      const [expiredAttempt] = await tx
        .update(driverDeliveryOfferAttemptsTable)
        .set({ response: "expired", respondedAt: now })
        .where(and(
          eq(driverDeliveryOfferAttemptsTable.id, attempt.id),
          eq(driverDeliveryOfferAttemptsTable.response, "offered"),
          isNull(driverDeliveryOfferAttemptsTable.respondedAt),
          lte(driverDeliveryOfferAttemptsTable.offerExpiresAt, now),
        ))
        .returning({ id: driverDeliveryOfferAttemptsTable.id });
      if (!expiredAttempt) throw new DriverOfferConflictError("This offer can no longer be accepted.");
      return { delivery: null, event: null, conflict: "This delivery offer has expired." };
    }
    if (
      current.deliveryStatus !== "searching_driver" ||
      current.driverId
    ) {
      throw new DriverOfferConflictError("This delivery is no longer available.");
    }
    const [capacity] = await tx
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(deliveriesTable)
      .where(and(
        eq(deliveriesTable.driverId, driver.id),
        notInArray(deliveriesTable.deliveryStatus, ["delivered", "cancelled", "failed", "refunded"]),
      ));
    if ((capacity?.activeCount ?? 0) > 0) {
      throw new DriverOfferConflictError("Finish your active delivery before accepting another offer.");
    }
    const acceptedAt = now;
    const [acceptedAttempt] = await tx
      .update(driverDeliveryOfferAttemptsTable)
      .set({ response: "accepted", respondedAt: acceptedAt })
      .where(and(
        eq(driverDeliveryOfferAttemptsTable.id, attempt.id),
        eq(driverDeliveryOfferAttemptsTable.response, "offered"),
        isNull(driverDeliveryOfferAttemptsTable.respondedAt),
        gt(driverDeliveryOfferAttemptsTable.offerExpiresAt, acceptedAt),
      ))
      .returning({ id: driverDeliveryOfferAttemptsTable.id });
    if (!acceptedAttempt) throw new DriverOfferConflictError("This offer can no longer be accepted.");
    const [assigned] = await tx
      .update(deliveriesTable)
      .set({
        driverId: driver.id,
        assignedAt: acceptedAt,
        deliveryStatus: "driver_assigned",
        driverVehicleSnapshot: {
          vehicleType: driver.vehicleType,
          vehicleYear: driver.vehicleYear,
          vehicleMake: driver.vehicleMake,
          vehicleModel: driver.vehicleModel,
          vehicleColor: driver.vehicleColor,
          licensePlate: driver.licensePlate,
        },
      })
      .where(
        and(
          eq(deliveriesTable.id, current.id),
          eq(deliveriesTable.deliveryStatus, "searching_driver"),
          isNull(deliveriesTable.driverId),
        ),
      )
      .returning();
    if (!assigned) throw new DriverOfferConflictError("This delivery was accepted by another driver. Please keep looking.");
    // Assignment is authoritative: every other simultaneous offer becomes terminal in the same transaction.
    await tx.update(driverDeliveryOfferAttemptsTable).set({ response: "expired", respondedAt: acceptedAt }).where(and(
      eq(driverDeliveryOfferAttemptsTable.deliveryId, assigned.id),
      eq(driverDeliveryOfferAttemptsTable.response, "offered"),
      isNull(driverDeliveryOfferAttemptsTable.respondedAt),
    ));
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId: profileId,
      action: "delivery.driver_accepted",
      entityType: "delivery",
      entityId: assigned.id,
      metadata: { driverId: driver.id, acceptance: "driver_offer" },
    });
    await tx.insert(deliveryStatusHistoryTable).values({
      deliveryId: assigned.id,
      fromStatus: "searching_driver",
      toStatus: "driver_assigned",
      changedByProfileId: profileId,
      reason: "Driver accepted the available delivery offer.",
      metadata: { driverId: driver.id, acceptance: "driver_offer" },
    });
    const event = await recordDeliveryEvent(tx, {
      type: "delivery.updated",
      deliveryId: assigned.id,
      customerId: assigned.customerId,
      driverId: assigned.driverId,
      payload: { status: assigned.deliveryStatus, assignment: "driver_offer" },
    });
    return { delivery: assigned, event };
  });
  if ("conflict" in result) throw new DriverOfferConflictError(result.conflict);
  if (!result.delivery) return null;
  if (result.event) publishDeliveryEvent({ ...result.event, deliveryId: result.delivery.publicDeliveryId });
  return mapDelivery(result.delivery);
}

/** Records an offered driver's explicit decline without changing delivery ownership/state. */
export async function declineDriverDelivery(profileId: string, publicDeliveryId: string) {
  const result = await db.transaction(async (tx) => {
    const [driver] = await tx.select().from(driversTable).where(eq(driversTable.profileId, profileId)).for("update").limit(1);
    if (!driver) throw new Error("Driver profile is not available.");
    const [delivery] = await tx.select({ id: deliveriesTable.id, driverId: deliveriesTable.driverId, deliveryStatus: deliveriesTable.deliveryStatus }).from(deliveriesTable)
      .where(eq(deliveriesTable.publicDeliveryId, publicDeliveryId)).for("update").limit(1);
    if (!delivery) return null;
    const [attempt] = await tx.select().from(driverDeliveryOfferAttemptsTable).where(and(
      eq(driverDeliveryOfferAttemptsTable.deliveryId, delivery.id), eq(driverDeliveryOfferAttemptsTable.driverId, driver.id),
    )).for("update").limit(1);
    if (!attempt) throw new Error("This delivery was not offered to you.");
    if (attempt.response === "declined") return { id: attempt.id, response: "declined" as const };
    if (attempt.response !== "offered" || attempt.respondedAt) throw new Error("This offer can no longer be declined.");
    const now = new Date();
    if (attempt.offerExpiresAt <= now) {
      const [expiredAttempt] = await tx.update(driverDeliveryOfferAttemptsTable)
        .set({ response: "expired", respondedAt: now })
        .where(and(
          eq(driverDeliveryOfferAttemptsTable.id, attempt.id),
          eq(driverDeliveryOfferAttemptsTable.response, "offered"),
          isNull(driverDeliveryOfferAttemptsTable.respondedAt),
          lte(driverDeliveryOfferAttemptsTable.offerExpiresAt, now),
        ))
        .returning({ id: driverDeliveryOfferAttemptsTable.id });
      if (!expiredAttempt) throw new DriverOfferConflictError("This offer can no longer be declined.");
      return { conflict: "This delivery offer has expired." };
    }
    if (delivery.driverId || delivery.deliveryStatus !== "searching_driver") throw new Error("This offer is no longer available.");
    const [updated] = await tx.update(driverDeliveryOfferAttemptsTable).set({ response: "declined", respondedAt: now })
      .where(and(
        eq(driverDeliveryOfferAttemptsTable.id, attempt.id),
        eq(driverDeliveryOfferAttemptsTable.response, "offered"),
        isNull(driverDeliveryOfferAttemptsTable.respondedAt),
        gt(driverDeliveryOfferAttemptsTable.offerExpiresAt, now),
      )).returning();
    if (!updated) throw new DriverOfferConflictError("This offer can no longer be declined.");
    return { id: updated.id, response: "declined" as const };
  });
  if (result && "conflict" in result) throw new DriverOfferConflictError(result.conflict);
  return result;
}

export async function verifyDriverRecipient(profileId: string, publicDeliveryId: string, otp: string) {
  const result = await db.transaction(async (tx) => {
    const [driver] = await tx
      .select()
      .from(driversTable)
      .where(eq(driversTable.profileId, profileId))
      .for("update")
      .limit(1);
    if (!driver) throw new Error("Driver profile is not available.");
    const [delivery] = await tx
      .select()
      .from(deliveriesTable)
      .where(and(eq(deliveriesTable.publicDeliveryId, publicDeliveryId), eq(deliveriesTable.driverId, driver.id)))
      .for("update")
      .limit(1);
    if (!delivery) throw new Error("That assigned delivery was not found.");
    const [verification] = await tx
      .select()
      .from(deliveryVerificationsTable)
      .where(eq(deliveryVerificationsTable.deliveryId, delivery.id))
      .for("update")
      .limit(1);
    if (delivery.deliveryStatus === "delivered" && verification?.verifiedAt) {
      return { delivery, event: null };
    }
    if (delivery.deliveryStatus !== "delivery_verification_pending") {
      throw new Error("Arrival must be confirmed before recipient verification.");
    }
    if (!verification || verification.expiresAt <= new Date() || verification.lockedAt) {
      throw new Error("A valid recipient code is not available. Contact support for a safe handoff.");
    }
    const candidate = createHash("sha256").update(`${delivery.id}:${otp}`).digest();
    const expected = Buffer.from(verification.otpHash, "hex");
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      const attempts = Number(verification.attempts) + 1;
      await tx.update(deliveryVerificationsTable)
        .set({ attempts: String(attempts), ...(attempts >= 5 ? { lockedAt: new Date() } : {}) })
        .where(eq(deliveryVerificationsTable.id, verification.id));
      return {
        delivery: null,
        event: null,
        error: attempts >= 5
          ? "Too many incorrect delivery-code attempts. Contact support for a safe handoff."
          : "That code did not match. Ask the recipient to check it and try again.",
      };
    }
    const now = new Date();
    await tx.update(deliveryVerificationsTable)
      .set({ verifiedAt: now })
      .where(and(eq(deliveryVerificationsTable.id, verification.id), isNull(deliveryVerificationsTable.verifiedAt)));
    const [completed] = await tx.update(deliveriesTable)
      .set({ deliveryStatus: "delivered", deliveredAt: now })
      .where(and(eq(deliveriesTable.id, delivery.id), eq(deliveriesTable.deliveryStatus, "delivery_verification_pending")))
      .returning();
    if (!completed) throw new Error("Delivery changed while recipient verification was being completed.");
    await tx.insert(deliveryStatusHistoryTable).values({
      deliveryId: delivery.id,
      fromStatus: "delivery_verification_pending",
      toStatus: "delivered",
      changedByProfileId: profileId,
      reason: "Recipient verification code confirmed.",
      metadata: { verificationId: verification.id },
    });
    await tx.insert(driverEarningsTable).values({
      driverId: driver.id,
      deliveryId: delivery.id,
      grossAmount: String(Number(delivery.totalPrice) * 0.7),
      netAmount: String(Number(delivery.totalPrice) * 0.7),
      status: "pending",
    }).onConflictDoNothing();
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId: profileId,
      action: "delivery.completed_after_recipient_verification",
      entityType: "delivery",
      entityId: delivery.id,
      metadata: { verificationId: verification.id, driverId: driver.id },
    });
    const event = await recordDeliveryEvent(tx, {
      type: "delivery.updated",
      deliveryId: completed.id,
      customerId: completed.customerId,
      driverId: completed.driverId,
      payload: { status: completed.deliveryStatus, verification: "confirmed" },
    });
    return { delivery: completed, event };
  });
  if ("error" in result) throw new Error(result.error);
  if (!result.delivery) throw new Error("Recipient verification could not complete.");
  if (result.event) publishDeliveryEvent({ ...result.event, deliveryId: result.delivery.publicDeliveryId });
  return mapDelivery(result.delivery);
}

export async function getDriverEarnings(profileId: string) {
  const { driver } = await driverContext(profileId);
  const rows = await db
    .select({ earning: driverEarningsTable, delivery: deliveriesTable })
    .from(driverEarningsTable)
    .innerJoin(deliveriesTable, eq(driverEarningsTable.deliveryId, deliveriesTable.id))
    .where(eq(driverEarningsTable.driverId, driver.id))
    .orderBy(desc(driverEarningsTable.createdAt))
    .limit(100);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const amount = (entry: typeof rows[number]) => numberValue(entry.earning.netAmount);
  const totalAfter = (start: number) => rows.filter((entry) => entry.earning.createdAt.getTime() >= start).reduce((sum, entry) => sum + amount(entry), 0);
  const bonuses = rows.reduce((sum, entry) => sum + Math.max(0, numberValue(entry.earning.adjustmentAmount)), 0);
  const adjustments = rows.reduce((sum, entry) => sum + numberValue(entry.earning.adjustmentAmount), 0);
  const statuses = new Set(rows.map((entry) => entry.earning.status));
  return {
    today: totalAfter(todayStart),
    week: totalAfter(weekStart),
    month: totalAfter(monthStart),
    bonuses,
    adjustments,
    payoutStatus: statuses.has("processing") ? "processing" : statuses.has("paid") ? "paid" : statuses.has("pending") ? "pending" : "unavailable",
    recent: rows.slice(0, 10).map((entry) => ({
      id: entry.earning.id,
      orderNumber: entry.delivery.orderNumber,
      amount: amount(entry),
      adjustment: numberValue(entry.earning.adjustmentAmount),
      status: entry.earning.status,
      createdAt: entry.earning.createdAt.toISOString(),
    })),
  };
}

export async function createDriverIssue(profileId: string, input: { deliveryId?: string; category: string; message: string }) {
  const { driver } = await driverContext(profileId);
  let deliveryId: string | null = null;
  if (input.deliveryId) {
    const [delivery] = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(and(eq(deliveriesTable.publicDeliveryId, input.deliveryId), eq(deliveriesTable.driverId, driver.id)))
      .limit(1);
    if (!delivery) throw new Error("That delivery is not assigned to you.");
    deliveryId = delivery.id;
  }
  const [incident] = await db
    .insert(driverIncidentsTable)
    .values({ driverId: driver.id, deliveryId, category: input.category, message: input.message })
    .returning();
  return { id: incident.id, category: incident.category, status: incident.status, createdAt: incident.createdAt.toISOString() };
}