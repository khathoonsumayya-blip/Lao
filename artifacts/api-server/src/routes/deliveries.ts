import { and, count, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AcceptDriverDeliveryParams,
  DeclineDriverDeliveryParams,
  DeclineDriverDeliveryResponse,
  AcceptDriverDeliveryResponse,
  AssignDeliveryDriverBody,
  AssignDeliveryDriverParams,
  AssignDeliveryDriverResponse,
  AttachDeliveryPhotoBody,
  AttachDeliveryPhotoParams,
  AttachDeliveryPhotoResponse,
  CreateDeliveryBody,
  CreateDriverDocumentResponse,
  CreateDeliveryPhotoUploadUrlBody,
  CreateDeliveryPhotoUploadUrlParams,
  CreateDeliveryPhotoUploadUrlResponse,
  CreateDeliveryQuoteBody,
  CreateDeliveryQuoteResponse,
  CreateDeliveryResponse,
  CreateCustomerAddressBody,
  CreateCustomerAddressResponse,
  CreateCustomerSupportTicketConversationReplyBody,
  CreateCustomerSupportTicketConversationReplyParams,
  CreateCustomerSupportTicketConversationReplyResponse,
  ListCustomerAddressesResponse,
  ListCustomerSupportTicketsResponse,
  ListCustomerSupportTicketConversationParams,
  ListCustomerSupportTicketConversationResponse,
  UpdateCustomerAddressBody,
  UpdateCustomerAddressParams,
  UpdateCustomerAddressResponse,
  DeleteCustomerAddressParams,
  CreateDriverIssueBody,
  CreateDriverIssueConversationReplyBody,
  CreateDriverIssueConversationReplyParams,
  CreateDriverIssueConversationReplyResponse,
  CreateDriverIssueResponse,
  CreateSupportTicketBody,
  CreateSupportTicketResponse,
  GetDeliveryParams,
  GetDeliveryResponse,
  GetRecipientVerificationParams,
  GetRecipientVerificationResponse,
  GetDeliveryRouteParams,
  GetDeliveryRouteResponse,
  GetDeliverySummaryResponse,
  GetDriverEarningsResponse,
  GetDriverOnboardingResponse,
  GetDriverProfileResponse,
  GetDriverSettingsResponse,
  ListAddressSuggestionsQueryParams,
  ListAddressSuggestionsResponse,
  ListAdminAuditLogsResponse,
  ListAdminDeliveriesQueryParams,
  ListAdminDeliveriesResponse,
  ListDispatchAlertsResponse,
  ListApprovedDriversResponse,
  ListDeliveriesResponse,
  ListDeliveryPhotosParams,
  ListDeliveryPhotosResponse,
  ListDriverDeliveriesResponse,
  ListDriverIssuesResponse,
  ListNotificationsResponse,
  ListDriverIssueConversationParams,
  ListDriverIssueConversationResponse,
  ListDriverOffersResponse,
  UpdateAdminDeliveryStatusBody,
  UpdateAdminDeliveryStatusParams,
  UpdateAdminDeliveryStatusResponse,
  UpdateDriverAvailabilityBody,
  UpdateDriverAvailabilityResponse,
  UpdateDriverDeliveryStatusBody,
  UpdateDriverDeliveryStatusParams,
  UpdateDriverDeliveryStatusResponse,
  UpdateDriverLocationBody,
  UpdateDriverLocationParams,
  UpdateDriverLocationResponse,
  UpdateDriverAvailabilityLocationBody,
  UpdateDriverAvailabilityLocationResponse,
  UpdateDriverOnboardingBody,
  UpdateDriverOnboardingResponse,
  UpdateDriverProfileBody,
  UpdateDriverProfileResponse,
  UpdateDriverSettingsBody,
  UpdateDriverSettingsResponse,
  VerifyDriverRecipientBody,
  VerifyDriverRecipientParams,
  VerifyDriverRecipientResponse,
  AcknowledgeDispatchAlertParams,
  AcknowledgeDispatchAlertResponse,
  PROHIBITED_ITEMS_CONFIRMATION_ERROR,
} from "@workspace/api-zod";
import {
  adminAuditLogsTable,
  customerAddressesTable,
  db,
  deliveriesTable,
  deliveryPhotosTable,
  deliveryPhotoUploadsTable,
  driverDocumentsTable,
  driverIncidentsTable,
  driverLocationsTable,
  driversTable,
  profilesTable,
  notificationsTable,
  paymentFeeSettingsTable,
  supportConversationEntriesTable,
  supportTicketsTable,
} from "@workspace/db";
import { currentAuth, requireAdminRoles, requireRoles, type AuthContext } from "../lib/auth";
import {
  assignDelivery,
  acknowledgeDispatchAlert,
  customerDelivery,
  customerRecipientVerification,
  customerSummary,
  createCustomerDelivery,
  DeliveryConflictError,
  DeliveryValidationError,
  driverAssignedDelivery,
  driverDeliveries,
  isTerminalDeliveryStatus,
  listApprovedDrivers,
  listCustomerDeliveries,
  listDispatchAlerts,
  listStaffDeliveries,
  persistQuote,
  transitionDelivery,
  type DeliveryStatus,
  validatePickupWindow,
} from "../lib/delivery-service";
import { listDeliveryEventsAfter, publishDeliveryEvent, recordDeliveryEvent, subscribeToAdminUpdates, subscribeToDeliveryEvents } from "../lib/delivery-events";
import {
  acceptDriverDelivery,
  declineDriverDelivery,
  createDriverIssue,
  DriverOfferConflictError,
  getDriverEarnings,
  getDriverOnboarding,
  getDriverProfile,
  listDriverOffers,
  isRetryableDriverOfferError,
  updateDriverAvailability,
  updateDriverOnboarding,
  updateDriverProfile,
  getDriverSettings,
  updateDriverSettings,
  driverContext,
  verifyDriverRecipient,
} from "../lib/driver-service";
import {
  createDeliveryPhotoDownloadUrl,
  createDeliveryPhotoUpload,
  createDeliveryPhotoObjectPath,
  createDriverDocumentUpload,
  deleteDeliveryPhotoObject,
  documentObjectExists,
  verifyDeliveryPhotoObject,
} from "../lib/private-document-storage";

const router: IRouter = Router();
const staffRoles = new Set<AuthContext["role"]>(["admin", "dispatcher", "support"]);
const customerPaymentMethodKeys = ["paymentMethod", "payment_method"] as const;
const supportedCustomerPaymentMethods = new Set(["stripe", "card"]);
const CUSTOMER_PAYMENT_METHOD_ERROR = "Cash and other offline payment methods are not available. Please use Stripe card checkout.";
const driverControlledStatuses = new Set<DeliveryStatus>([
  "driver_en_route_pickup",
  "driver_arrived_pickup",
  "pickup_verified",
  "picked_up",
  "in_transit",
  "driver_arrived_delivery",
  "delivery_verification_pending",
  "failed",
]);
const providerControlledStatuses = new Set<DeliveryStatus>(["payment_pending", "paid", "refunded"]);
const imageContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const driverDocumentTypes = new Set(["driver_photo", "license", "insurance", "vehicle_registration"]);
const driverDocumentContentTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);
const pendingPhotoUploadLimit = 3;

type Coordinates = { latitude: number; longitude: number };
type ProviderRoute = { distanceMeters: number | null; durationSeconds: number | null; encodedPolyline: string | null };
const routeCache = new Map<string, { route: ProviderRoute; expiresAt: number }>();
const routeCacheTtlMs = 30_000;

class AddressVerificationError extends Error {
  constructor(
    readonly statusCode: 422 | 503,
    message: string,
  ) {
    super(message);
  }
}

async function geocodeAddress(address: string): Promise<Coordinates | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", key);
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("Geocoding provider did not respond.");
  const payload = (await response.json()) as { status?: string; results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> };
  if (payload.status === "ZERO_RESULTS") return null;
  if (payload.status !== "OK") throw new Error("Geocoding provider could not validate this address.");
  const location = payload.results?.[0]?.geometry?.location;
  return typeof location?.lat === "number" && typeof location.lng === "number"
    ? { latitude: location.lat, longitude: location.lng }
    : null;
}

async function resolveDeliveryCoordinates(input: {
  pickupAddress: string;
  dropoffAddress: string;
}) {
  if (!process.env.GOOGLE_MAPS_SERVER_API_KEY) {
    throw new AddressVerificationError(
      503,
      "Live address verification is not configured yet. Select a saved verified address or try again when maps are available.",
    );
  }
  let pickup: Coordinates | null;
  let dropoff: Coordinates | null;
  try {
    [pickup, dropoff] = await Promise.all([
      geocodeAddress(input.pickupAddress),
      geocodeAddress(input.dropoffAddress),
    ]);
  } catch {
    throw new AddressVerificationError(
      503,
      "Live address verification is temporarily unavailable. Please try again before requesting a quote.",
    );
  }
  if (!pickup || !dropoff) {
    throw new AddressVerificationError(
      422,
      "We couldn't verify both addresses. Choose a suggested address or check the full address and try again.",
    );
  }
  return {
    pickupLatitude: pickup.latitude,
    pickupLongitude: pickup.longitude,
    dropoffLatitude: dropoff.latitude,
    dropoffLongitude: dropoff.longitude,
    mapMode: "verified" as const,
  };
}

async function cleanupExpiredPhotoUploads(): Promise<void> {
  const expired = await db
    .select()
    .from(deliveryPhotoUploadsTable)
    .where(lt(deliveryPhotoUploadsTable.expiresAt, new Date()))
    .limit(100);
  await Promise.all(expired.map(async (upload) => {
    try {
      await deleteDeliveryPhotoObject(upload.deliveryId, upload.storagePath);
      await db.delete(deliveryPhotoUploadsTable).where(eq(deliveryPhotoUploadsTable.id, upload.id));
    } catch {
      // Keep the record for the next scheduled cleanup attempt.
    }
  }));
}

void cleanupExpiredPhotoUploads().catch(() => undefined);
setInterval(() => { void cleanupExpiredPhotoUploads().catch(() => undefined); }, 5 * 60_000).unref();

async function authorizedDelivery(auth: AuthContext, publicDeliveryId: string) {
  const [delivery] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, publicDeliveryId))
    .limit(1);
  if (!delivery) return { delivery: null, allowed: false };
  const allowed =
    staffRoles.has(auth.role) ||
    (auth.role === "customer" && delivery.customerId === auth.profileId) ||
    (auth.role === "driver" && auth.driverId !== null && delivery.driverId === auth.driverId);
  return { delivery, allowed };
}

async function latestDriverLocation(deliveryId: string, publicDeliveryId: string) {
  const [location] = await db
    .select()
    .from(driverLocationsTable)
    .where(eq(driverLocationsTable.deliveryId, deliveryId))
    .orderBy(desc(driverLocationsTable.capturedAt))
    .limit(1);
  return location
    ? {
        id: location.id,
        deliveryId: publicDeliveryId,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters,
        capturedAt: location.capturedAt.toISOString(),
      }
    : null;
}

async function googleAddressSuggestions(query: string, limit: number) {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!key) return null;
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ input: query, includedRegionCodes: ["us"] }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Address provider did not respond.");
  const payload = (await response.json()) as {
    suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }>;
  };
  const predictions = (payload.suggestions ?? [])
    .map((suggestion) => suggestion.placePrediction)
    .filter((prediction): prediction is { placeId: string; text?: { text?: string } } => Boolean(prediction?.placeId))
    .slice(0, limit);
  const results = await Promise.all(predictions.map(async (prediction) => {
    const details = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(prediction.placeId)}?fields=formattedAddress,location,addressComponents`, {
      headers: { "X-Goog-Api-Key": key },
      signal: AbortSignal.timeout(5_000),
    });
    if (!details.ok) throw new Error("Address provider details did not respond.");
    const place = (await details.json()) as {
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
    };
    if (typeof place.location?.latitude !== "number" || typeof place.location.longitude !== "number") return null;
    const component = (types: string[]) => place.addressComponents?.find((item) => item.types?.some((type) => types.includes(type)))?.longText ?? null;
    return {
      id: prediction.placeId,
      label: place.formattedAddress ?? prediction.text?.text ?? "Verified address",
      address: place.formattedAddress ?? prediction.text?.text ?? "Verified address",
      latitude: place.location.latitude,
      longitude: place.location.longitude,
      source: "google" as const,
      street: [component(["street_number"]), component(["route"])].filter(Boolean).join(" ") || null,
      city: component(["locality", "postal_town", "sublocality"]),
      state: component(["administrative_area_level_1"]),
      postalCode: component(["postal_code"]),
      country: component(["country"]),
    };
  }));
  return results.filter((result): result is NonNullable<typeof result> => Boolean(result));
}

function savedAddressResponse(address: typeof customerAddressesTable.$inferSelect) {
  return {
    id: address.id,
    label: address.label,
    fullAddress: address.fullAddress,
    street: address.street,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    latitude: address.latitude,
    longitude: address.longitude,
    instructions: address.instructions,
    isDefault: address.isDefault,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}

async function requesterSupportSourceResponse(
  source: "customer_ticket" | "driver_issue",
  records: Array<{
    id: string;
    category: string;
    status: string;
    priority: string;
    createdAt: Date;
    updatedAt: Date;
  }>,
  requesterProfileId: string,
) {
  return Promise.all(records.map(async (record) => {
    const [lastEntry] = await db
      .select({
        body: supportConversationEntriesTable.body,
        createdAt: supportConversationEntriesTable.createdAt,
        authorProfileId: supportConversationEntriesTable.authorProfileId,
      })
      .from(supportConversationEntriesTable)
      .where(and(
        eq(
          source === "customer_ticket"
            ? supportConversationEntriesTable.supportTicketId
            : supportConversationEntriesTable.driverIncidentId,
          record.id,
        ),
        eq(supportConversationEntriesTable.visibility, "requester"),
      ))
      .orderBy(desc(supportConversationEntriesTable.createdAt))
      .limit(1);
    const authorRole = lastEntry && lastEntry.authorProfileId !== requesterProfileId ? "staff" as const : "requester" as const;
    return {
      id: record.id,
      source,
      category: record.category,
      status: record.status,
      priority: record.priority,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      lastConversationPreview: lastEntry
        ? { body: lastEntry.body, createdAt: lastEntry.createdAt.toISOString(), authorRole }
        : null,
      hasSupportReply: authorRole === "staff",
    };
  }));
}

function addressValues(input: {
  label: string;
  fullAddress: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  instructions?: string | null;
  isDefault?: boolean;
}) {
  return {
    label: input.label,
    fullAddress: input.fullAddress.trim(),
    street: input.street?.trim() || null,
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    postalCode: input.postalCode?.trim() || null,
    country: input.country?.trim() || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    instructions: input.instructions?.trim() || null,
    isDefault: input.isDefault ?? false,
  };
}

async function providerRoute(
  pickup: { latitude: number; longitude: number },
  dropoff: { latitude: number; longitude: number },
) {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${pickup.latitude},${pickup.longitude}`);
  url.searchParams.set("destination", `${dropoff.latitude},${dropoff.longitude}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("key", key);
  const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new Error("Route provider did not respond.");
  const payload = (await response.json()) as {
    status?: string;
    routes?: Array<{ overview_polyline?: { points?: string }; legs?: Array<{ distance?: { value?: number }; duration?: { value?: number } }> }>;
  };
  if (payload.status !== "OK") throw new Error("Route provider could not calculate this trip.");
  const route = payload.routes?.[0];
  const leg = route?.legs?.[0];
  if (!route || !leg) throw new Error("Route provider did not return a usable trip.");
  return {
    distanceMeters: leg.distance?.value ?? null,
    durationSeconds: leg.duration?.value ?? null,
    encodedPolyline: route.overview_polyline?.points ?? null,
  };
}

async function cachedProviderRoute(cacheKey: string, pickup: Coordinates, dropoff: Coordinates) {
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.route;
  const route = await providerRoute(pickup, dropoff);
  if (route) routeCache.set(cacheKey, { route, expiresAt: Date.now() + routeCacheTtlMs });
  return route;
}

router.get("/deliveries/summary", requireRoles("customer"), async (_req, res): Promise<void> => {
  res.json(GetDeliverySummaryResponse.parse(await customerSummary(currentAuth(res).profileId)));
});

router.get("/notifications", requireRoles("customer", "driver", "admin", "dispatcher", "support"), async (_req, res): Promise<void> => {
  const notifications = await db.select({
    id: notificationsTable.id,
    type: notificationsTable.type,
    title: notificationsTable.title,
    body: notificationsTable.body,
    readAt: notificationsTable.readAt,
    createdAt: notificationsTable.createdAt,
    supportTicketId: notificationsTable.supportTicketId,
    driverIncidentId: notificationsTable.driverIncidentId,
  }).from(notificationsTable)
    .where(eq(notificationsTable.profileId, currentAuth(res).profileId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(100);
  res.json(ListNotificationsResponse.parse(notifications.map((notification) => ({
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    supportSource: notification.supportTicketId ? "customer_ticket" : notification.driverIncidentId ? "driver_issue" : null,
    supportId: notification.supportTicketId ?? notification.driverIncidentId ?? null,
  }))));
});

router.get("/addresses/suggestions", requireRoles("customer"), async (req, res): Promise<void> => {
  const parsed = ListAddressSuggestionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter at least three characters to search addresses." });
    return;
  }
  const auth = currentAuth(res);
  const { q, limit } = parsed.data;
  try {
    const suggestions = await googleAddressSuggestions(q, limit);
    if (suggestions) {
      res.json(ListAddressSuggestionsResponse.parse({ suggestions, providerStatus: "available", message: null }));
      return;
    }
  } catch (error) {
    req.log.warn({ err: error }, "Address provider unavailable");
  }
  const saved = await db
    .select()
    .from(customerAddressesTable)
    .where(eq(customerAddressesTable.customerId, auth.profileId))
    .orderBy(desc(customerAddressesTable.isDefault))
    .limit(limit);
  const normalizedQuery = q.toLowerCase();
  const suggestions = saved
    .filter((address) => address.fullAddress.toLowerCase().includes(normalizedQuery) || address.label.toLowerCase().includes(normalizedQuery))
    .filter((address) => address.latitude != null && address.longitude != null)
    .map((address) => ({
      id: address.id,
      label: `${address.label} · ${address.fullAddress}`,
      address: address.fullAddress,
      latitude: address.latitude!,
      longitude: address.longitude!,
      source: "saved" as const,
      street: address.street,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
    }));
  res.json(ListAddressSuggestionsResponse.parse({
    suggestions,
    providerStatus: "unavailable",
    message: process.env.GOOGLE_MAPS_SERVER_API_KEY
      ? "Address search is temporarily unavailable. You can use a saved address or enter the full address."
      : "Address search is not configured yet. You can use a saved address or enter the full address.",
  }));
});

router.get("/addresses", requireRoles("customer"), async (_req, res): Promise<void> => {
  const addresses = await db
    .select()
    .from(customerAddressesTable)
    .where(eq(customerAddressesTable.customerId, currentAuth(res).profileId))
    .orderBy(desc(customerAddressesTable.isDefault), desc(customerAddressesTable.updatedAt));
  res.json(ListCustomerAddressesResponse.parse(addresses.map(savedAddressResponse)));
});

router.post("/addresses", requireRoles("customer"), async (req, res): Promise<void> => {
  const parsed = CreateCustomerAddressBody.safeParse(req.body);
  if (!parsed.success || (parsed.data.latitude == null) !== (parsed.data.longitude == null)) {
    res.status(400).json({ error: "Choose a label and full address. Coordinates must be provided together." });
    return;
  }
  const customerId = currentAuth(res).profileId;
  const values = addressValues(parsed.data);
  const address = await db.transaction(async (tx) => {
    if (values.isDefault) {
      await tx.update(customerAddressesTable).set({ isDefault: false }).where(eq(customerAddressesTable.customerId, customerId));
    }
    const [created] = await tx.insert(customerAddressesTable).values({ customerId, ...values }).returning();
    return created;
  });
  res.status(201).json(CreateCustomerAddressResponse.parse(savedAddressResponse(address)));
});

router.patch("/addresses/:id", requireRoles("customer"), async (req, res): Promise<void> => {
  const params = UpdateCustomerAddressParams.safeParse(req.params);
  const parsed = UpdateCustomerAddressBody.safeParse(req.body);
  if (!params.success || !parsed.success || (parsed.data.latitude == null) !== (parsed.data.longitude == null)) {
    res.status(400).json({ error: "Choose a label and full address. Coordinates must be provided together." });
    return;
  }
  const customerId = currentAuth(res).profileId;
  const values = addressValues(parsed.data);
  const address = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(customerAddressesTable).where(and(eq(customerAddressesTable.id, params.data.id), eq(customerAddressesTable.customerId, customerId))).limit(1);
    if (!existing) return null;
    if (values.isDefault) {
      await tx.update(customerAddressesTable).set({ isDefault: false }).where(eq(customerAddressesTable.customerId, customerId));
    }
    const [updated] = await tx.update(customerAddressesTable).set(values).where(and(eq(customerAddressesTable.id, existing.id), eq(customerAddressesTable.customerId, customerId))).returning();
    return updated;
  });
  if (!address) {
    res.status(404).json({ error: "That saved address was not found." });
    return;
  }
  res.json(UpdateCustomerAddressResponse.parse(savedAddressResponse(address)));
});

router.delete("/addresses/:id", requireRoles("customer"), async (req, res): Promise<void> => {
  const params = DeleteCustomerAddressParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "That saved address was not found." });
    return;
  }
  const result = await db.delete(customerAddressesTable).where(and(eq(customerAddressesTable.id, params.data.id), eq(customerAddressesTable.customerId, currentAuth(res).profileId))).returning({ id: customerAddressesTable.id });
  if (!result.length) {
    res.status(404).json({ error: "That saved address was not found." });
    return;
  }
  res.status(204).end();
});

router.post("/deliveries/quote", requireRoles("customer"), async (req, res): Promise<void> => {
  const parsed = CreateDeliveryQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check your delivery details and try again." });
    return;
  }
  try {
    validatePickupWindow(parsed.data);
    const coordinates = await resolveDeliveryCoordinates(parsed.data);
    const [settings] = await db.select().from(paymentFeeSettingsTable).where(eq(paymentFeeSettingsTable.id, "payments")).limit(1);
    const policy = settings ? {
      deliveryFeeCents: Number(settings.deliveryFeeCents), customerServiceFeeCents: Number(settings.customerServiceFeeCents),
      smallOrderThresholdCents: Number(settings.smallOrderThresholdCents), smallOrderFeeCents: Number(settings.smallOrderFeeCents),
      taxRateBasisPoints: Number(settings.taxRateBasisPoints), updatedAt: settings.updatedAt.toISOString(),
    } : undefined;
    res.json(CreateDeliveryQuoteResponse.parse(await persistQuote(currentAuth(res).profileId, { ...parsed.data, ...coordinates }, policy)));
  } catch (error) {
    if (error instanceof AddressVerificationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error instanceof DeliveryValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/deliveries/route-preview", requireRoles("customer"), async (req, res): Promise<void> => {
  const parsed = CreateDeliveryQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide both delivery addresses to preview this route." });
    return;
  }
  try {
    const coordinates = await resolveDeliveryCoordinates(parsed.data);
    const pickup = { latitude: coordinates.pickupLatitude, longitude: coordinates.pickupLongitude, label: parsed.data.pickupAddress };
    const dropoff = { latitude: coordinates.dropoffLatitude, longitude: coordinates.dropoffLongitude, label: parsed.data.dropoffAddress };
    const route = await providerRoute(pickup, dropoff);
    if (!route?.encodedPolyline) throw new Error("Route provider did not return a usable route.");
    res.json({ pickup, dropoff, ...route });
  } catch (error) {
    const message = error instanceof AddressVerificationError
      ? error.message
      : "Live route mapping is temporarily unavailable. You can still request a quote.";
    res.status(error instanceof AddressVerificationError ? error.statusCode : 503).json({ error: message });
  }
});

router.get("/deliveries", requireRoles("customer"), async (_req, res): Promise<void> => {
  res.json(ListDeliveriesResponse.parse(await listCustomerDeliveries(currentAuth(res).profileId)));
});

router.post("/deliveries", requireRoles("customer"), async (req, res): Promise<void> => {
  const requestBody = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : null;
  const paymentMethods = requestBody
    ? customerPaymentMethodKeys
      .map((key) => requestBody[key])
      .filter((value): value is unknown => value !== undefined)
    : [];
  const providers = requestBody?.provider === undefined ? [] : [requestBody.provider];
  if (
    paymentMethods.some((value) => typeof value !== "string" || !supportedCustomerPaymentMethods.has(value.trim().toLowerCase()))
    || providers.some((value) => typeof value !== "string" || value.trim().toLowerCase() !== "stripe")
  ) {
    res.status(400).json({ error: CUSTOMER_PAYMENT_METHOD_ERROR });
    return;
  }
  const parsed = CreateDeliveryBody.safeParse(req.body);
  const idempotencyKey = req.get("idempotency-key");
  if (!parsed.success || !idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    const missingSafetyConfirmation = req.body?.prohibitedItemsConfirmed !== true;
    res.status(400).json({ error: missingSafetyConfirmation ? PROHIBITED_ITEMS_CONFIRMATION_ERROR : "Please check your delivery details and use a valid checkout request key." });
    return;
  }
  try {
    const checkout = await createCustomerDelivery(currentAuth(res).profileId, parsed.data, idempotencyKey);
    res.status(201).json(CreateDeliveryResponse.parse({ ...checkout.delivery, payment: checkout.payment }));
  } catch (error) {
    if (error instanceof DeliveryValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Customer delivery payment initialization failed");
    res.status(502).json({ error: "We couldn't start a secure payment for this delivery. Please try again." });
  }
});

router.get("/deliveries/:id", requireRoles("customer", "driver", "admin"), async (req, res): Promise<void> => {
  const parsed = GetDeliveryParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide a valid delivery identifier." });
    return;
  }
  const auth = currentAuth(res);
  if (auth.role === "customer") {
    const delivery = await customerDelivery(auth.profileId, parsed.data.id);
    if (!delivery) {
      res.status(404).json({ error: "We couldn't find that delivery." });
      return;
    }
    res.json(GetDeliveryResponse.parse(delivery));
    return;
  }
  const access = await authorizedDelivery(auth, parsed.data.id);
  if (!access.delivery) {
    res.status(404).json({ error: "We couldn't find that delivery." });
    return;
  }
  if (!access.allowed) {
    res.status(403).json({ error: "You do not have access to this delivery." });
    return;
  }
  const delivery = auth.role === "driver" && auth.driverId
    ? await driverAssignedDelivery(auth.driverId, parsed.data.id)
    : access.delivery;
  if (!delivery) {
    res.status(404).json({ error: "We couldn't find that delivery." });
    return;
  }
  const { mapDelivery } = await import("../lib/delivery-service");
  res.json(GetDeliveryResponse.parse(await mapDelivery(delivery)));
});

router.get("/deliveries/:id/recipient-verification", requireRoles("customer"), async (req, res): Promise<void> => {
  const parsed = GetRecipientVerificationParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide a valid delivery identifier." });
    return;
  }
  const verification = await customerRecipientVerification(
    currentAuth(res).profileId,
    parsed.data.id,
  );
  if (!verification) {
    res.status(404).json({ error: "An active recipient code is not available." });
    return;
  }
  res.json(GetRecipientVerificationResponse.parse(verification));
});

router.get("/deliveries/:id/route", requireRoles("customer", "driver", "admin", "dispatcher"), async (req, res): Promise<void> => {
  const parsed = GetDeliveryRouteParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide a valid delivery identifier." });
    return;
  }
  const access = await authorizedDelivery(currentAuth(res), parsed.data.id);
  if (!access.delivery) {
    res.status(404).json({ error: "We couldn't find that delivery." });
    return;
  }
  if (!access.allowed) {
    res.status(403).json({ error: "You do not have access to this delivery." });
    return;
  }
  const delivery = access.delivery;
  const terminal = isTerminalDeliveryStatus(delivery.deliveryStatus);
  const driverLocation = terminal ? null : await latestDriverLocation(delivery.id, delivery.publicDeliveryId);
  const verifiedMap = delivery.mapMode === "verified";
  const pickup = {
    latitude: verifiedMap ? delivery.pickupLatitude : null,
    longitude: verifiedMap ? delivery.pickupLongitude : null,
    label: delivery.pickupAddress,
  };
  const dropoff = {
    latitude: verifiedMap ? delivery.deliveryLatitude : null,
    longitude: verifiedMap ? delivery.deliveryLongitude : null,
    label: delivery.dropoffAddress,
  };
  if (delivery.mapMode !== "verified") {
    res.json(GetDeliveryRouteResponse.parse({
      status: "demo",
      pickup,
      dropoff,
      driverLocation,
      distanceMeters: null,
      durationSeconds: null,
      encodedPolyline: null,
      message: "Live route mapping is unavailable because these addresses were not verified for maps. No location pins are shown until verified route data is available.",
    }));
    return;
  }
  if (pickup.latitude == null || pickup.longitude == null || dropoff.latitude == null || dropoff.longitude == null) {
    res.json(GetDeliveryRouteResponse.parse({
      status: "unavailable",
      pickup,
      dropoff,
      driverLocation,
      distanceMeters: null,
      durationSeconds: null,
      encodedPolyline: null,
      message: "Live route details are unavailable because one or both delivery addresses have not been mapped yet.",
    }));
    return;
  }
  try {
    const beforePickup = ["driver_assigned", "driver_en_route_pickup", "driver_arrived_pickup", "pickup_verified"].includes(delivery.deliveryStatus);
    const origin = driverLocation
      ? { latitude: driverLocation.latitude, longitude: driverLocation.longitude }
      : { latitude: pickup.latitude, longitude: pickup.longitude };
    const destination = beforePickup
      ? { latitude: pickup.latitude, longitude: pickup.longitude }
      : { latitude: dropoff.latitude, longitude: dropoff.longitude };
    const route = await cachedProviderRoute(
      `${delivery.id}:${beforePickup ? "pickup" : "dropoff"}`,
      origin,
      destination,
    );
    if (!route) throw new Error("Route provider is not configured.");
    res.json(GetDeliveryRouteResponse.parse({ status: "available", pickup, dropoff, driverLocation, message: null, ...route }));
  } catch (error) {
    req.log.warn({ err: error, deliveryId: delivery.publicDeliveryId }, "Route provider unavailable");
    res.json(GetDeliveryRouteResponse.parse({
      status: "unavailable",
      pickup,
      dropoff,
      driverLocation,
      distanceMeters: null,
      durationSeconds: null,
      encodedPolyline: null,
      message: "Live route mapping is temporarily unavailable. Your delivery status is still up to date.",
    }));
  }
});

router.post("/deliveries/:id/photos/upload-url", requireRoles("customer", "driver"), async (req, res): Promise<void> => {
  const params = CreateDeliveryPhotoUploadUrlParams.safeParse(req.params);
  const body = CreateDeliveryPhotoUploadUrlBody.safeParse(req.body);
  if (!params.success || !body.success || !Number.isInteger(body.data?.size) || !imageContentTypes.has(body.data.contentType)) {
    res.status(400).json({ error: "Upload a JPEG, PNG, or WebP image smaller than 10 MB." });
    return;
  }
  const access = await authorizedDelivery(currentAuth(res), params.data.id);
  if (!access.delivery) {
    res.status(404).json({ error: "We couldn't find that delivery." });
    return;
  }
  if (!access.allowed) {
    res.status(403).json({ error: "You do not have access to this delivery." });
    return;
  }
  try {
    const auth = currentAuth(res);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const objectPath = createDeliveryPhotoObjectPath(access.delivery.id);
    const [reservation] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${access.delivery!.id}:${auth.profileId}`}))`);
      const [outstanding] = await tx
        .select({ total: count() })
        .from(deliveryPhotoUploadsTable)
        .where(and(
          eq(deliveryPhotoUploadsTable.deliveryId, access.delivery!.id),
          eq(deliveryPhotoUploadsTable.uploaderProfileId, auth.profileId),
          gt(deliveryPhotoUploadsTable.expiresAt, new Date()),
        ));
      if ((outstanding?.total ?? 0) >= pendingPhotoUploadLimit) throw new DeliveryConflictError("Finish or wait for your pending photo uploads before adding another one.");
      return tx.insert(deliveryPhotoUploadsTable).values({
        deliveryId: access.delivery!.id,
        uploaderProfileId: auth.profileId,
        storagePath: objectPath,
        contentType: body.data.contentType,
        sizeBytes: String(body.data.size),
        expiresAt,
      }).returning();
    });
    let upload;
    try {
      upload = await createDeliveryPhotoUpload(access.delivery.id, objectPath, expiresAt.toISOString());
    } catch (error) {
      await db.delete(deliveryPhotoUploadsTable).where(eq(deliveryPhotoUploadsTable.id, reservation.id));
      throw error;
    }
    res.status(201).json(CreateDeliveryPhotoUploadUrlResponse.parse(upload));
  } catch (error) {
    if (error instanceof DeliveryConflictError) {
      res.status(429).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Private package-photo upload unavailable");
    res.status(503).json({ error: "Private photo storage is temporarily unavailable. Your delivery can continue without a photo." });
  }
});

router.post("/deliveries/:id/photos", requireRoles("customer", "driver"), async (req, res): Promise<void> => {
  const params = AttachDeliveryPhotoParams.safeParse(req.params);
  const body = AttachDeliveryPhotoBody.safeParse(req.body);
  if (!params.success || !body.success || !Number.isInteger(body.data?.size) || !imageContentTypes.has(body.data.contentType)) {
    res.status(400).json({ error: "The package photo details are invalid." });
    return;
  }
  const auth = currentAuth(res);
  const access = await authorizedDelivery(auth, params.data.id);
  if (!access.delivery) {
    res.status(404).json({ error: "We couldn't find that delivery." });
    return;
  }
  if (!access.allowed) {
    res.status(403).json({ error: "You do not have access to this delivery." });
    return;
  }
  try {
    const [pendingUpload] = await db
      .select()
      .from(deliveryPhotoUploadsTable)
      .where(and(
        eq(deliveryPhotoUploadsTable.deliveryId, access.delivery.id),
        eq(deliveryPhotoUploadsTable.uploaderProfileId, auth.profileId),
        eq(deliveryPhotoUploadsTable.storagePath, body.data.objectPath),
      ))
      .limit(1);
    if (!pendingUpload || pendingUpload.expiresAt <= new Date()) {
      res.status(403).json({ error: "That secure photo upload has expired or does not belong to you." });
      return;
    }
    if (pendingUpload.contentType !== body.data.contentType || Number(pendingUpload.sizeBytes) !== body.data.size) {
      res.status(400).json({ error: "The package photo details do not match the secure upload request." });
      return;
    }
    if (!(await verifyDeliveryPhotoObject(access.delivery.id, pendingUpload.storagePath, {
      contentType: pendingUpload.contentType,
      size: Number(pendingUpload.sizeBytes),
    }))) {
      res.status(400).json({ error: "The uploaded photo could not be verified." });
      return;
    }
    const [photo] = await db
      .insert(deliveryPhotosTable)
      .values({
        deliveryId: access.delivery.id,
        uploadedByProfileId: auth.profileId,
        storagePath: pendingUpload.storagePath,
        contentType: pendingUpload.contentType,
        sizeBytes: pendingUpload.sizeBytes,
      })
      .returning();
    await db.delete(deliveryPhotoUploadsTable).where(eq(deliveryPhotoUploadsTable.id, pendingUpload.id));
    const downloadUrl = await createDeliveryPhotoDownloadUrl(access.delivery.id, photo.storagePath);
    res.status(201).json(AttachDeliveryPhotoResponse.parse({
      id: photo.id,
      deliveryId: access.delivery.publicDeliveryId,
      contentType: photo.contentType,
      size: Number(photo.sizeBytes),
      downloadUrl,
      createdAt: photo.createdAt.toISOString(),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to attach private package photo");
    res.status(503).json({ error: "We couldn't securely attach that photo. Please try again." });
  }
});

router.get("/deliveries/:id/photos", requireRoles("customer", "driver", "admin", "dispatcher"), async (req, res): Promise<void> => {
  const params = ListDeliveryPhotosParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Please provide a valid delivery identifier." });
    return;
  }
  const access = await authorizedDelivery(currentAuth(res), params.data.id);
  if (!access.delivery) {
    res.status(404).json({ error: "We couldn't find that delivery." });
    return;
  }
  if (!access.allowed) {
    res.status(403).json({ error: "You do not have access to this delivery." });
    return;
  }
  try {
    const photos = await db
      .select()
      .from(deliveryPhotosTable)
      .where(eq(deliveryPhotosTable.deliveryId, access.delivery.id))
      .orderBy(desc(deliveryPhotosTable.createdAt));
    const response = await Promise.all(photos.map(async (photo) => ({
      id: photo.id,
      deliveryId: access.delivery!.publicDeliveryId,
      contentType: photo.contentType,
      size: Number(photo.sizeBytes),
      downloadUrl: await createDeliveryPhotoDownloadUrl(access.delivery!.id, photo.storagePath),
      createdAt: photo.createdAt.toISOString(),
    })));
    res.json(ListDeliveryPhotosResponse.parse(response));
  } catch (error) {
    req.log.error({ err: error }, "Private package-photo read unavailable");
    res.status(503).json({ error: "Private photos are temporarily unavailable. Please try again shortly." });
  }
});

router.post("/support/tickets", requireRoles("customer"), async (req, res): Promise<void> => {
  const parsed = CreateSupportTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please describe the issue before sending." });
    return;
  }
  const [ticket] = await db.insert(supportTicketsTable).values({
    customerId: currentAuth(res).profileId,
    category: parsed.data.category,
    message: parsed.data.message,
  }).returning();
  res.status(201).json(CreateSupportTicketResponse.parse({
    id: ticket.id, category: ticket.category, message: ticket.message, status: ticket.status, createdAt: ticket.createdAt.toISOString(),
  }));
});

router.get("/support/tickets", requireRoles("customer"), async (_req, res): Promise<void> => {
  const auth = currentAuth(res);
  const tickets = await db.select({
    id: supportTicketsTable.id,
    category: supportTicketsTable.category,
    status: supportTicketsTable.status,
    priority: supportTicketsTable.priority,
    createdAt: supportTicketsTable.createdAt,
    updatedAt: supportTicketsTable.updatedAt,
  }).from(supportTicketsTable)
    .where(eq(supportTicketsTable.customerId, auth.profileId))
    .orderBy(desc(supportTicketsTable.createdAt))
    .limit(100);
  res.json(ListCustomerSupportTicketsResponse.parse(
    await requesterSupportSourceResponse("customer_ticket", tickets, auth.profileId),
  ));
});

router.get("/support/tickets/:id/conversation", requireRoles("customer"), async (req, res): Promise<void> => {
  const params = ListCustomerSupportTicketConversationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Please provide a valid support ticket identifier." }); return; }
  const auth = currentAuth(res);
  const [ticket] = await db.select().from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, params.data.id), eq(supportTicketsTable.customerId, auth.profileId))).limit(1);
  if (!ticket) { res.status(404).json({ error: "Support ticket not found." }); return; }
  const entries = await db.select({
    id: supportConversationEntriesTable.id,
    body: supportConversationEntriesTable.body,
    createdAt: supportConversationEntriesTable.createdAt,
    authorProfileId: supportConversationEntriesTable.authorProfileId,
    authorRole: profilesTable.role,
  }).from(supportConversationEntriesTable)
    .innerJoin(profilesTable, eq(supportConversationEntriesTable.authorProfileId, profilesTable.id))
    .where(and(eq(supportConversationEntriesTable.supportTicketId, ticket.id), eq(supportConversationEntriesTable.visibility, "requester")))
    .orderBy(supportConversationEntriesTable.createdAt);
  res.json(ListCustomerSupportTicketConversationResponse.parse([
    { id: `origin:${ticket.id}`, body: ticket.message, createdAt: ticket.createdAt.toISOString(), author: { role: "requester", name: "You" }, origin: true },
    ...entries.map((entry) => ({
      id: entry.id, body: entry.body, createdAt: entry.createdAt.toISOString(),
      author: entry.authorProfileId === auth.profileId ? { role: "requester", name: "You" } : { role: "staff", name: "Support" },
      origin: false,
    })),
  ]));
});

router.post("/support/tickets/:id/conversation", requireRoles("customer"), async (req, res): Promise<void> => {
  const params = CreateCustomerSupportTicketConversationReplyParams.safeParse(req.params);
  const body = CreateCustomerSupportTicketConversationReplyBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.body.trim().length < 2) { res.status(400).json({ error: "Reply must be between 2 and 2,000 characters." }); return; }
  const auth = currentAuth(res);
  const result = await db.transaction(async (tx) => {
    const [ticket] = await tx.select({ id: supportTicketsTable.id }).from(supportTicketsTable)
      .where(and(eq(supportTicketsTable.id, params.data.id), eq(supportTicketsTable.customerId, auth.profileId))).for("update").limit(1);
    if (!ticket) return null;
    const requestId = body.data.clientRequestId ?? null;
    const [existing] = requestId ? await tx.select().from(supportConversationEntriesTable)
      .where(and(eq(supportConversationEntriesTable.authorProfileId, auth.profileId), eq(supportConversationEntriesTable.clientRequestId, requestId))).limit(1) : [];
    if (existing) return { entry: existing, idempotent: true };
    const [entry] = await tx.insert(supportConversationEntriesTable).values({
      supportTicketId: ticket.id, authorProfileId: auth.profileId, body: body.data.body.trim(), visibility: "requester", clientRequestId: requestId,
    }).returning();
    return { entry, idempotent: false };
  });
  if (!result) { res.status(404).json({ error: "Support ticket not found." }); return; }
  res.status(result.idempotent ? 200 : 201).json(CreateCustomerSupportTicketConversationReplyResponse.parse({
    id: result.entry.id, body: result.entry.body, createdAt: result.entry.createdAt.toISOString(), idempotent: result.idempotent,
  }));
});

router.get("/driver/profile", requireRoles("driver"), async (_req, res): Promise<void> => {
  try { res.json(GetDriverProfileResponse.parse(await getDriverProfile(currentAuth(res).profileId))); }
  catch (error) { res.status(403).json({ error: error instanceof Error ? error.message : "Driver profile is not available." }); }
});
router.patch("/driver/profile", requireRoles("driver"), async (req, res): Promise<void> => {
  const parsed = UpdateDriverProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the profile details and try again." });
    return;
  }
  try {
    res.json(UpdateDriverProfileResponse.parse(await updateDriverProfile(currentAuth(res).profileId, parsed.data)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update driver profile." });
  }
});
router.get("/driver/onboarding", requireRoles("driver"), async (_req, res): Promise<void> => {
  try { res.json(GetDriverOnboardingResponse.parse(await getDriverOnboarding(currentAuth(res).profileId))); }
  catch (error) { res.status(403).json({ error: error instanceof Error ? error.message : "Driver profile is not available." }); }
});
router.patch("/driver/onboarding", requireRoles("driver"), async (req, res): Promise<void> => {
  const parsed = UpdateDriverOnboardingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Please check the onboarding information and try again." }); return; }
  try { res.json(UpdateDriverOnboardingResponse.parse(await updateDriverOnboarding(currentAuth(res).profileId, parsed.data))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to save onboarding." }); }
});
router.patch("/driver/availability", requireRoles("driver"), async (req, res): Promise<void> => {
  const parsed = UpdateDriverAvailabilityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose online or offline availability." }); return; }
  try { res.json(UpdateDriverAvailabilityResponse.parse(await updateDriverAvailability(currentAuth(res).profileId, parsed.data.availabilityStatus))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update availability." }); }
});
router.get("/driver/settings", requireRoles("driver"), async (_req, res): Promise<void> => {
  try { res.json(GetDriverSettingsResponse.parse(await getDriverSettings(currentAuth(res).profileId))); }
  catch (error) { res.status(403).json({ error: error instanceof Error ? error.message : "Driver settings are not available." }); }
});
router.patch("/driver/settings", requireRoles("driver"), async (req, res): Promise<void> => {
  const parsed = UpdateDriverSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Please check the delivery preferences and try again." }); return; }
  try { res.json(UpdateDriverSettingsResponse.parse(await updateDriverSettings(currentAuth(res).profileId, parsed.data))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update driver settings." }); }
});
router.patch("/driver/location", requireRoles("driver"), async (req, res): Promise<void> => {
  const parsed = UpdateDriverAvailabilityLocationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Please provide valid latitude and longitude." }); return; }
  const capturedAt = parsed.data.capturedAt ? new Date(parsed.data.capturedAt) : new Date();
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 5 * 60_000 || capturedAt.getTime() < Date.now() - 15 * 60_000) {
    res.status(400).json({ error: "Location timestamps must be recent and cannot be far in the future." }); return;
  }
  try {
    const { profile, driver } = await driverContext(currentAuth(res).profileId);
    if (profile.status !== "active" || driver.approvalStatus !== "approved" || !["online", "available"].includes(driver.availabilityStatus)) {
      res.status(403).json({ error: "Only active approved online drivers can update availability location." }); return;
    }
    const [updated] = await db.update(driversTable).set({
      currentLatitude: parsed.data.latitude, currentLongitude: parsed.data.longitude, lastLocationUpdate: capturedAt,
    }).where(eq(driversTable.id, driver.id)).returning();
    res.json(UpdateDriverAvailabilityLocationResponse.parse({
      latitude: updated!.currentLatitude, longitude: updated!.currentLongitude, capturedAt: updated!.lastLocationUpdate!.toISOString(),
    }));
  } catch (error) {
    res.status(403).json({ error: error instanceof Error ? error.message : "Driver location is unavailable." });
  }
});
router.post("/driver/documents/upload-url", requireRoles("driver"), async (req, res): Promise<void> => {
  const { documentType, name, size, contentType } = req.body as Record<string, unknown>;
  const auth = currentAuth(res);
  if (!auth.driverId) { res.status(403).json({ error: "Driver profile is not available." }); return; }
  if (
    typeof documentType !== "string" || !driverDocumentTypes.has(documentType) ||
    typeof name !== "string" || !name.trim() || name.length > 160 ||
    typeof size !== "number" || !Number.isInteger(size) || !Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024 ||
    typeof contentType !== "string" || !driverDocumentContentTypes.has(contentType)
  ) {
    res.status(400).json({ error: "Upload a JPEG, PNG, or PDF document smaller than 10 MB." });
    return;
  }
  try {
    res.status(201).json(await createDriverDocumentUpload(auth.driverId));
  } catch (error) {
    req.log.error({ err: error }, "Private driver-document upload unavailable");
    res.status(503).json({ error: "Private document storage is temporarily unavailable. Please try again." });
  }
});
router.post("/driver/documents", requireRoles("driver"), async (req, res): Promise<void> => {
  const { documentType, objectPath, expiryDate } = req.body as Record<string, unknown>;
  const auth = currentAuth(res);
  if (!auth.driverId) { res.status(403).json({ error: "Driver profile is not available." }); return; }
  const validExpiryDate = typeof expiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) && (() => {
    const [year, month, day] = expiryDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  })();
  if (
    typeof documentType !== "string" || !driverDocumentTypes.has(documentType) || typeof objectPath !== "string" ||
    (expiryDate !== undefined && !validExpiryDate) ||
    (documentType !== "driver_photo" && !validExpiryDate)
  ) {
    res.status(400).json({ error: "The uploaded document details are invalid." });
    return;
  }
  try {
    if (!(await documentObjectExists(auth.driverId, objectPath))) {
      res.status(400).json({ error: "The uploaded document could not be verified." });
      return;
    }
    const [document] = await db.insert(driverDocumentsTable).values({
      driverId: auth.driverId,
      documentType,
      storagePath: objectPath,
      verificationStatus: "pending",
      expiryDate: typeof expiryDate === "string" ? expiryDate : null,
    }).returning();
    res.status(201).json(CreateDriverDocumentResponse.parse({
      id: document.id,
      documentType: document.documentType,
      verificationStatus: document.verificationStatus,
      expiryDate: document.expiryDate,
      rejectionReason: document.rejectionReason,
      createdAt: document.createdAt.toISOString(),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to record private driver document");
    res.status(503).json({ error: "We couldn't securely record that document. Please try again." });
  }
});
router.get("/driver/offers", requireRoles("driver"), async (_req, res): Promise<void> => {
  try { res.json(ListDriverOffersResponse.parse(await listDriverOffers(currentAuth(res).profileId))); }
  catch (error) {
    if (isRetryableDriverOfferError(error)) {
      res.status(409).json({ error: "Delivery offers changed while loading. Please retry." });
      return;
    }
    res.status(403).json({ error: error instanceof Error ? error.message : "Delivery offers are not available." });
  }
});
router.post("/driver/deliveries/:id/accept", requireRoles("driver"), async (req, res): Promise<void> => {
  const params = AcceptDriverDeliveryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Please provide a valid delivery identifier." }); return; }
  try {
    const result = await acceptDriverDelivery(currentAuth(res).profileId, params.data.id);
    if (!result) { res.status(404).json({ error: "Delivery offer not found." }); return; }
    res.json(AcceptDriverDeliveryResponse.parse(result));
  } catch (error) {
    const retryable = isRetryableDriverOfferError(error);
    res.status(error instanceof DriverOfferConflictError || retryable ? 409 : 400).json({
      error: retryable
        ? "This delivery offer changed while it was being accepted. Please retry."
        : error instanceof Error ? error.message : "This delivery offer is no longer available.",
    });
  }
});
router.post("/driver/deliveries/:id/decline", requireRoles("driver"), async (req, res): Promise<void> => {
  const params = DeclineDriverDeliveryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Please provide a valid delivery identifier." }); return; }
  try {
    const result = await declineDriverDelivery(currentAuth(res).profileId, params.data.id);
    if (!result) { res.status(404).json({ error: "Delivery offer not found." }); return; }
    res.json(DeclineDriverDeliveryResponse.parse(result));
  } catch (error) {
    res.status(409).json({
      error: isRetryableDriverOfferError(error)
        ? "This delivery offer changed while it was being declined. Please retry."
        : error instanceof Error ? error.message : "This offer cannot be declined.",
    });
  }
});
router.get("/driver/deliveries", requireRoles("driver"), async (_req, res): Promise<void> => {
  const auth = currentAuth(res);
  if (!auth.driverId) { res.status(403).json({ error: "Driver profile is not available." }); return; }
  res.json(ListDriverDeliveriesResponse.parse(await driverDeliveries(auth.driverId)));
});
router.post("/driver/deliveries/:id/status", requireRoles("driver"), async (req, res): Promise<void> => {
  const params = UpdateDriverDeliveryStatusParams.safeParse(req.params);
  const body = UpdateDriverDeliveryStatusBody.safeParse(req.body);
  if (!params.success || !body.success || !driverControlledStatuses.has(body.data.status as DeliveryStatus)) {
    res.status(400).json({ error: "Please provide a valid delivery status update." }); return;
  }
  const auth = currentAuth(res);
  if (!auth.driverId) { res.status(403).json({ error: "Driver profile is not available." }); return; }
  const delivery = await driverAssignedDelivery(auth.driverId, params.data.id);
  if (!delivery) { res.status(404).json({ error: "That assigned delivery was not found." }); return; }
  try {
    const updated = await transitionDelivery(delivery.id, auth.profileId, body.data.status as DeliveryStatus, body.data.reason);
    const { mapDelivery } = await import("../lib/delivery-service");
    res.json(UpdateDriverDeliveryStatusResponse.parse(await mapDelivery(updated)));
  } catch (error) {
    res.status(error instanceof DeliveryConflictError ? 409 : 400).json({ error: error instanceof Error ? error.message : "Invalid status transition." });
  }
});
router.post("/driver/deliveries/:id/location", requireRoles("driver"), async (req, res): Promise<void> => {
  const params = UpdateDriverLocationParams.safeParse(req.params);
  const body = UpdateDriverLocationBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Please provide a valid location update." }); return; }
  const auth = currentAuth(res);
  if (!auth.driverId) { res.status(403).json({ error: "Driver profile is not available." }); return; }
  const capturedAt = body.data.capturedAt ? new Date(body.data.capturedAt) : new Date();
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 5 * 60_000 || capturedAt.getTime() < Date.now() - 15 * 60_000) {
    res.status(400).json({ error: "Location timestamps must be recent and cannot be far in the future." }); return;
  }
  try {
  const result = await db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(deliveriesTable)
      .where(and(eq(deliveriesTable.publicDeliveryId, params.data.id), eq(deliveriesTable.driverId, auth.driverId!)))
      .for("update")
      .limit(1);
    if (!delivery) throw new Error("That assigned delivery was not found.");
    if (isTerminalDeliveryStatus(delivery.deliveryStatus)) throw new DeliveryConflictError("Location updates are only accepted while this delivery is active.");
    const [latest] = await tx
      .select()
      .from(driverLocationsTable)
      .where(eq(driverLocationsTable.deliveryId, delivery.id))
      .orderBy(desc(driverLocationsTable.capturedAt))
      .limit(1);
    if (latest && capturedAt <= latest.capturedAt) {
      throw new DeliveryConflictError("This location update is stale or duplicated and was not recorded.");
    }
    const [created] = await tx.insert(driverLocationsTable).values({
      deliveryId: delivery.id, driverId: auth.driverId!, latitude: body.data.latitude, longitude: body.data.longitude, accuracyMeters: body.data.accuracyMeters ?? null, capturedAt,
    }).returning();
    await tx.update(driversTable).set({ currentLatitude: body.data.latitude, currentLongitude: body.data.longitude, lastLocationUpdate: created.capturedAt }).where(eq(driversTable.id, auth.driverId!));
    const event = await recordDeliveryEvent(tx, {
      type: "driver.location_updated",
      deliveryId: delivery.id,
      customerId: delivery.customerId,
      driverId: auth.driverId,
      payload: {
        id: created.id,
        latitude: created.latitude,
        longitude: created.longitude,
        accuracyMeters: created.accuracyMeters,
        capturedAt: created.capturedAt.toISOString(),
      },
    });
    return { location: created, delivery, event };
  });
  publishDeliveryEvent({ ...result.event, deliveryId: result.delivery.publicDeliveryId });
  res.status(201).json(UpdateDriverLocationResponse.parse({
    id: result.location.id, deliveryId: result.delivery.publicDeliveryId, latitude: result.location.latitude, longitude: result.location.longitude, accuracyMeters: result.location.accuracyMeters, capturedAt: result.location.capturedAt.toISOString(),
  }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record this location update.";
    res.status(error instanceof DeliveryConflictError ? 409 : message.includes("not found") ? 404 : 400).json({ error: message });
  }
});
router.post("/driver/deliveries/:id/verify-recipient", requireRoles("driver"), async (req, res): Promise<void> => {
  const params = VerifyDriverRecipientParams.safeParse(req.params);
  const body = VerifyDriverRecipientBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Enter the recipient's delivery code." }); return; }
  try { res.json(VerifyDriverRecipientResponse.parse(await verifyDriverRecipient(currentAuth(res).profileId, params.data.id, body.data.otp))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Recipient verification failed." }); }
});
router.get("/driver/earnings", requireRoles("driver"), async (_req, res): Promise<void> => {
  try { res.json(GetDriverEarningsResponse.parse(await getDriverEarnings(currentAuth(res).profileId))); }
  catch (error) { res.status(403).json({ error: error instanceof Error ? error.message : "Driver earnings are not available." }); }
});
router.post("/driver/issues", requireRoles("driver"), async (req, res): Promise<void> => {
  const parsed = CreateDriverIssueBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Please describe the issue before sending it." }); return; }
  try { res.status(201).json(CreateDriverIssueResponse.parse(await createDriverIssue(currentAuth(res).profileId, parsed.data))); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unable to submit the issue." }); }
});

router.get("/driver/issues", requireRoles("driver"), async (_req, res): Promise<void> => {
  const auth = currentAuth(res);
  if (!auth.driverId) { res.status(403).json({ error: "Driver profile is not available." }); return; }
  const incidents = await db.select({
    id: driverIncidentsTable.id,
    category: driverIncidentsTable.category,
    status: driverIncidentsTable.status,
    priority: driverIncidentsTable.priority,
    createdAt: driverIncidentsTable.createdAt,
    updatedAt: driverIncidentsTable.updatedAt,
  }).from(driverIncidentsTable)
    .where(eq(driverIncidentsTable.driverId, auth.driverId))
    .orderBy(desc(driverIncidentsTable.createdAt))
    .limit(100);
  res.json(ListDriverIssuesResponse.parse(
    await requesterSupportSourceResponse("driver_issue", incidents, auth.profileId),
  ));
});

router.get("/driver/issues/:id/conversation", requireRoles("driver"), async (req, res): Promise<void> => {
  const params = ListDriverIssueConversationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Please provide a valid driver incident identifier." }); return; }
  const auth = currentAuth(res);
  const [incident] = await db.select({
    id: driverIncidentsTable.id, message: driverIncidentsTable.message, createdAt: driverIncidentsTable.createdAt,
  }).from(driverIncidentsTable).innerJoin(driversTable, eq(driverIncidentsTable.driverId, driversTable.id))
    .where(and(eq(driverIncidentsTable.id, params.data.id), eq(driversTable.profileId, auth.profileId))).limit(1);
  if (!incident) { res.status(404).json({ error: "Driver incident not found." }); return; }
  const entries = await db.select({
    id: supportConversationEntriesTable.id, body: supportConversationEntriesTable.body, createdAt: supportConversationEntriesTable.createdAt,
    authorProfileId: supportConversationEntriesTable.authorProfileId,
  }).from(supportConversationEntriesTable)
    .where(and(eq(supportConversationEntriesTable.driverIncidentId, incident.id), eq(supportConversationEntriesTable.visibility, "requester")))
    .orderBy(supportConversationEntriesTable.createdAt);
  res.json(ListDriverIssueConversationResponse.parse([
    { id: `origin:${incident.id}`, body: incident.message, createdAt: incident.createdAt.toISOString(), author: { role: "requester", name: "You" }, origin: true },
    ...entries.map((entry) => ({ id: entry.id, body: entry.body, createdAt: entry.createdAt.toISOString(), author: entry.authorProfileId === auth.profileId ? { role: "requester", name: "You" } : { role: "staff", name: "Support" }, origin: false })),
  ]));
});

router.post("/driver/issues/:id/conversation", requireRoles("driver"), async (req, res): Promise<void> => {
  const params = CreateDriverIssueConversationReplyParams.safeParse(req.params);
  const body = CreateDriverIssueConversationReplyBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.body.trim().length < 2) { res.status(400).json({ error: "Reply must be between 2 and 2,000 characters." }); return; }
  const auth = currentAuth(res);
  const result = await db.transaction(async (tx) => {
    const [incident] = await tx.select({ id: driverIncidentsTable.id }).from(driverIncidentsTable).innerJoin(driversTable, eq(driverIncidentsTable.driverId, driversTable.id))
      .where(and(eq(driverIncidentsTable.id, params.data.id), eq(driversTable.profileId, auth.profileId))).for("update").limit(1);
    if (!incident) return null;
    const requestId = body.data.clientRequestId ?? null;
    const [existing] = requestId ? await tx.select().from(supportConversationEntriesTable)
      .where(and(eq(supportConversationEntriesTable.authorProfileId, auth.profileId), eq(supportConversationEntriesTable.clientRequestId, requestId))).limit(1) : [];
    if (existing) return { entry: existing, idempotent: true };
    const [entry] = await tx.insert(supportConversationEntriesTable).values({
      driverIncidentId: incident.id, authorProfileId: auth.profileId, body: body.data.body.trim(), visibility: "requester", clientRequestId: requestId,
    }).returning();
    return { entry, idempotent: false };
  });
  if (!result) { res.status(404).json({ error: "Driver incident not found." }); return; }
  res.status(result.idempotent ? 200 : 201).json(CreateDriverIssueConversationReplyResponse.parse({
    id: result.entry.id, body: result.entry.body, createdAt: result.entry.createdAt.toISOString(), idempotent: result.idempotent,
  }));
});

router.get("/admin/deliveries", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const query = ListAdminDeliveriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "The dispatch search or filter is invalid." });
    return;
  }
  res.json(ListAdminDeliveriesResponse.parse(await listStaffDeliveries(query.data)));
});
router.get("/admin/drivers", requireAdminRoles("admin", "dispatcher"), async (_req, res): Promise<void> => {
  res.json(ListApprovedDriversResponse.parse(await listApprovedDrivers()));
});
router.post("/admin/deliveries/:id/assign", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const params = AssignDeliveryDriverParams.safeParse(req.params);
  const body = AssignDeliveryDriverBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Please provide a valid driver assignment." }); return; }
  try {
    const assigned = await assignDelivery(params.data.id, body.data.driverId, currentAuth(res).profileId);
    if (!assigned) { res.status(404).json({ error: "That delivery was not found." }); return; }
    res.json(AssignDeliveryDriverResponse.parse({
      id: assigned.publicDeliveryId,
      status: assigned.deliveryStatus,
      updatedAt: assigned.updatedAt.toISOString(),
    }));
  } catch (error) {
    res.status(error instanceof DeliveryConflictError ? 409 : 400).json({ error: error instanceof Error ? error.message : "Invalid assignment." });
  }
});
router.post("/admin/deliveries/:id/status", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const params = UpdateAdminDeliveryStatusParams.safeParse(req.params);
  const body = UpdateAdminDeliveryStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Please provide a valid operational delivery status update." }); return;
  }
  if (providerControlledStatuses.has(body.data.status as DeliveryStatus)) {
    res.status(403).json({ error: "Payment provider events control payment statuses." }); return;
  }
  const access = await authorizedDelivery(currentAuth(res), params.data.id);
  if (!access.delivery) { res.status(404).json({ error: "That delivery was not found." }); return; }
  try {
    const updated = await transitionDelivery(access.delivery.id, currentAuth(res).profileId, body.data.status as DeliveryStatus, body.data.reason);
    res.json(UpdateAdminDeliveryStatusResponse.parse({
      id: updated.publicDeliveryId,
      status: updated.deliveryStatus,
      updatedAt: updated.updatedAt.toISOString(),
    }));
  } catch (error) {
    res.status(error instanceof DeliveryConflictError ? 409 : 400).json({ error: error instanceof Error ? error.message : "Invalid status transition." });
  }
});
router.get("/admin/dispatch-alerts", requireAdminRoles("admin", "dispatcher"), async (_req, res): Promise<void> => {
  res.json(ListDispatchAlertsResponse.parse(await listDispatchAlerts(currentAuth(res).profileId)));
});
router.post("/admin/dispatch-alerts/:id/acknowledge", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const params = AcknowledgeDispatchAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Please provide a valid alert identifier." });
    return;
  }
  const alert = await acknowledgeDispatchAlert(currentAuth(res).profileId, params.data.id);
  if (!alert) {
    res.status(404).json({ error: "That dispatch alert was not found." });
    return;
  }
  res.json(AcknowledgeDispatchAlertResponse.parse(alert));
});
router.get("/admin/audit-logs", requireAdminRoles("admin", "dispatcher"), async (_req, res): Promise<void> => {
  const auth = currentAuth(res);
  const isAdmin = auth.role === "admin";
  const logs = await db
    .select()
    .from(adminAuditLogsTable)
    .where(isAdmin ? undefined : inArray(adminAuditLogsTable.entityType, ["delivery", "dispatch_alert"]))
    .orderBy(desc(adminAuditLogsTable.createdAt))
    .limit(100);
  const response = await Promise.all(logs.map(async (log) => {
    const [actor] = log.actorProfileId
      ? await db.select({ firstName: profilesTable.firstName, lastName: profilesTable.lastName }).from(profilesTable).where(eq(profilesTable.id, log.actorProfileId)).limit(1)
      : [];
    const [delivery] = log.entityType === "delivery" && log.entityId
      ? await db.select({ publicDeliveryId: deliveriesTable.publicDeliveryId, orderNumber: deliveriesTable.orderNumber, driverId: deliveriesTable.driverId }).from(deliveriesTable).where(eq(deliveriesTable.id, log.entityId)).limit(1)
      : [];
    const [driver] = delivery?.driverId
      ? await db
          .select({ firstName: profilesTable.firstName, lastName: profilesTable.lastName })
          .from(driversTable)
          .innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
          .where(eq(driversTable.id, delivery.driverId))
          .limit(1)
      : [];
    return {
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: ["delivery.driver_assigned", "dispatch.alert_acknowledged"].includes(log.action)
        ? (delivery?.publicDeliveryId ?? log.entityId)
        : log.entityId,
      createdAt: log.createdAt.toISOString(),
      actorName: actor ? `${actor.firstName} ${actor.lastName}` : null,
      entityLabel: delivery ? `Order ${delivery.orderNumber}` : null,
      driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
       metadata: isAdmin ? log.metadata : {},
    };
  }));
  res.json(ListAdminAuditLogsResponse.parse(response));
});

router.get("/events", requireRoles("customer", "driver", "admin", "dispatcher", "support"), (req, res): void => {
  const auth = currentAuth(res);
  const requestedCursor = Number.parseInt(
    (typeof req.query.cursor === "string" ? req.query.cursor : req.get("last-event-id")) ?? "0",
    10,
  );
  let cursor = Number.isSafeInteger(requestedCursor) && requestedCursor > 0 ? requestedCursor : 0;
  let closed = false;
  res.status(200).setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (event: { type: string; cursor: number; deliveryId: string; customerId: string; driverId: string | null; createdAt: string; payload: Record<string, unknown> }) => {
    if (closed || event.cursor <= cursor) return;
    const isStaff = staffRoles.has(auth.role);
    const isOwner = event.customerId === auth.profileId || (auth.driverId && event.driverId === auth.driverId);
    if (!isStaff && !isOwner) return;
    cursor = event.cursor;
    res.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify({ type: event.type, deliveryId: event.deliveryId, createdAt: event.createdAt, cursor: event.cursor, payload: event.payload })}\n\n`);
  };
  const replay = async () => {
    const events = await listDeliveryEventsAfter({
      cursor,
      customerId: auth.profileId,
      driverId: auth.driverId,
      isStaff: staffRoles.has(auth.role),
    });
    events.forEach(send);
  };
  res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString(), cursor })}\n\n`);
  void replay().catch((error) => req.log.warn({ err: error }, "Unable to replay delivery events"));
  const unsubscribe = subscribeToDeliveryEvents((event) => {
    send(event);
  });
  const unsubscribeAdmin = subscribeToAdminUpdates((event) => {
    if (auth.role !== "admin") return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
  const recoveryPoll = setInterval(() => { void replay().catch((error) => req.log.warn({ err: error }, "Unable to poll delivery events")); }, 2_000);
  req.on("close", () => { closed = true; clearInterval(heartbeat); clearInterval(recoveryPoll); unsubscribe(); unsubscribeAdmin(); res.end(); });
});

export default router;