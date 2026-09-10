import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Storage } from "@google-cloud/storage";
import Stripe from "stripe";
import { and, count, eq, inArray, ne, or } from "drizzle-orm";

process.env.NODE_ENV = "production";
process.env.CORS_ORIGIN = [
  "https://www.anythinganywhere.com",
  "https://driver.anythinganywhere.com",
  "https://admin.anythinganywhere.com",
].join(",");
process.env.ALLOW_DEMO_SESSION = "false";
process.env.PAYMENTS_TEST_MODE = "true";
process.env.PASSWORD_RESET_FROM_EMAIL = "Anything Anywhere <no-reply@example.test>";
process.env.REPLIT_CONNECTORS_HOSTNAME = "http://resend-test.local";
process.env.REPLIT_IDENTITY = "password-reset-integration-test";
process.env.GOOGLE_MAPS_SERVER_API_KEY = "google-maps-integration-test-key";
process.env.CUSTOMER_APP_URL = "https://www.anythinganywhere.com";
process.env.ADMIN_APP_URL = "https://admin.anythinganywhere.com";
process.env.PRIVATE_OBJECT_DIR = "test-private-bucket/private";

// Keep private-document coverage hermetic while using paths that satisfy the
// same driver-scoped private-object validation used in production.
const privateTestObjects = new Set<string>();
const originalStorageBucket = Storage.prototype.bucket;
Storage.prototype.bucket = ((bucketName: string) => ({
  file: (objectName: string) => ({
    exists: async () => [privateTestObjects.has(`${bucketName}/${objectName}`)],
    getSignedUrl: async () => [
      `https://signed-private.example.test/${encodeURIComponent(bucketName)}/${encodeURIComponent(objectName)}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=300&X-Goog-Signature=test-signature`,
    ],
  }),
})) as typeof Storage.prototype.bucket;

type ResendMockCall = {
  body: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
  };
};

const resendMockCalls: ResendMockCall[] = [];
let resendMockShouldFail = false;
let googleMapsAvailable = true;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  if (url.startsWith("https://maps.googleapis.com/maps/api/geocode/json")) {
    if (!googleMapsAvailable) {
      return new Response(JSON.stringify({ status: "OVER_QUERY_LIMIT", results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const address = new URL(url).searchParams.get("address") ?? "";
    const location = address.includes("300 South Dawson")
      ? { lat: 35.7758, lng: -78.6417 }
      : { lat: 35.7796, lng: -78.6382 };
    return new Response(JSON.stringify({
      status: "OK",
      results: [{ geometry: { location } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("https://maps.googleapis.com/maps/api/directions/json")) {
    return new Response(JSON.stringify({
      status: "OK",
      routes: [{
        overview_polyline: { points: "c`~eFf`cjM??" },
        legs: [{ distance: { value: 1450 }, duration: { value: 360 } }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url !== "http://resend-test.local/api/v2/proxy/emails") {
    return realFetch(input, init);
  }

  const rawBody = typeof init?.body === "string" ? init.body : "";
  resendMockCalls.push({ body: JSON.parse(rawBody) as ResendMockCall["body"] });
  if (resendMockShouldFail) {
    return new Response(JSON.stringify({ error: "provider body must not be logged" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ id: `mock-email-${resendMockCalls.length}` }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const [{ default: app }, database, paymentWebhookService, deliveryService, deliveryEvents, notificationDeliveryWorker, driverService] = await Promise.all([
  import("../src/app.ts"),
  import("@workspace/db"),
  import("../src/lib/payment-webhook-service.ts"),
  import("../src/lib/delivery-service.ts"),
  import("../src/lib/delivery-events.ts"),
  import("../src/lib/notification-delivery-worker.ts"),
  import("../src/lib/driver-service.ts"),
]);

const {
  db,
  deliveriesTable,
  deliveryStatusHistoryTable,
  deliveryVerificationsTable,
  driverLocationsTable,
  driversTable,
  notificationAttemptsTable,
  notificationsTable,
  paymentWebhookEventsTable,
  passwordResetTokensTable,
  paymentsTable,
  promoCodesTable,
  promotionRedemptionsTable,
  profilesTable,
  sessionsTable,
  adminAuditLogsTable,
  driverDocumentsTable,
  driverApplicationsTable,
  driverIncidentsTable,
  supportTicketsTable,
  supportConversationEntriesTable,
  refundOperationsTable,
  generalSettingsTable,
  securitySettingsTable,
  paymentFeeSettingsTable,
  emailSettingsTable,
  deliveryQuotesTable,
  customerAddressesTable,
  driverBonusesTable,
  driverBonusEventsTable,
  driverDeliveryOfferAttemptsTable,
  dispatchSettingsTable,
  driverPreferencesTable,
} = database;
const { processVerifiedStripeEvent } = paymentWebhookService;
const { recordPromotionRedemption, transitionDelivery } = deliveryService;
const { listDeliveryEventsAfter, subscribeToDeliveryEvents, subscribeToAdminUpdates } = deliveryEvents;
const { runNotificationDeliveryWorker } = notificationDeliveryWorker;
const { listDriverOffers, setPickupRouteProviderForTests } = driverService;
type ProfileRole = "customer" | "driver" | "dispatcher" | "admin" | "support";

type FixtureProfile = {
  id: string;
  authUserId: string;
  role: ProfileRole;
  email: string;
  token: string;
};

type JsonResponse = {
  status: number;
  body: unknown;
};

const deliveryBody = {
  pickupAddress: "100 Fayetteville Street, Raleigh, NC",
  dropoffAddress: "300 South Dawson Street, Raleigh, NC",
  category: "Documents",
  size: "small",
  weight: "under5",
  care: "standard",
  priority: "asap",
  pickupName: "Pickup Contact",
  pickupPhone: "9195550100",
  recipientName: "Recipient Contact",
  recipientPhone: "9195550101",
  prohibitedItemsConfirmed: true,
};

const runId = randomUUID();
const fixtureProfiles: FixtureProfile[] = [];
const fixtureDeliveryIds: string[] = [];
const fixturePromotionIds: string[] = [];
const registeredProfileIds: string[] = [];
let assignedDriverId = "";
let unassignedDriverId = "";
let customer: FixtureProfile;
let otherCustomer: FixtureProfile;
let dispatcher: FixtureProfile;
let admin: FixtureProfile;
let support: FixtureProfile;
let assignedDriver: FixtureProfile;
let unassignedDriver: FixtureProfile;
let server: Server;
let baseUrl = "";
let createdDeliveryId = "";
let createdPaymentIntentId = "";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function createProfile(role: ProfileRole): Promise<FixtureProfile> {
  const authUserId = randomUUID();
  const token = randomUUID();
  const email = `${role}-${runId}-${fixtureProfiles.length}@example.test`;
  const [profile] = await db
    .insert(profilesTable)
    .values({
      authUserId,
      role,
      firstName: `Test ${role}`,
      lastName: "Delivery",
      email,
      status: "active",
    })
    .returning();

  await db.insert(sessionsTable).values({
    profileId: profile.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    userAgent: "delivery-integration-test",
  });

  const fixture = { id: profile.id, authUserId, role, email, token };
  fixtureProfiles.push(fixture);
  return fixture;
}

function bearer(profile: FixtureProfile): HeadersInit {
  return { authorization: `Bearer ${profile.token}` };
}

function sessionCookie(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookie = headers.getSetCookie?.()[0] ?? headers.get("set-cookie");
  assert.ok(setCookie, "Authentication should set a session cookie.");
  return setCookie;
}

function sessionCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [];
  assert.ok(cookies.length > 0, "Authentication should set session cookies.");
  return cookies;
}

async function request(path: string, init: RequestInit = {}): Promise<JsonResponse> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (path === "/api/deliveries" && init.method === "POST" && !headers.has("idempotency-key")) {
    headers.set("idempotency-key", randomUUID());
  }
  if (path === "/api/deliveries" && init.method === "POST" && headers.has("authorization") && typeof body === "string") {
    const payload = JSON.parse(body) as Record<string, unknown>;
    if (!payload.quoteId) {
      const quoteResponse = await fetch(`${baseUrl}/api/deliveries/quote`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          pickupAddress: payload.pickupAddress,
          dropoffAddress: payload.dropoffAddress,
          category: payload.category,
          size: payload.size,
          weight: payload.weight,
          care: payload.care,
          priority: payload.priority,
        }),
      });
      assert.equal(quoteResponse.status, 200);
      const quote = await quoteResponse.json() as { id: string };
      body = JSON.stringify({ ...payload, quoteId: quote.id });
    }
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, body });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

type VerificationFixture = {
  profile: FixtureProfile;
  driverId: string;
  documents: Record<"license" | "insurance" | "vehicle_registration", string>;
};

async function createVerificationFixture(options: {
  submitted?: boolean;
  documentStatus?: "approved" | "pending" | "rejected";
  expiredDocument?: boolean;
  backgroundCheckStatus?: "not_started" | "pending" | "clear" | "review";
  mvrCheckStatus?: "not_started" | "pending" | "clear" | "review";
} = {}): Promise<VerificationFixture> {
  const profile = await createProfile("driver");
  await db
    .update(profilesTable)
    .set({ firstName: "Verification", lastName: "Driver" })
    .where(eq(profilesTable.id, profile.id));
  const [driver] = await db.insert(driversTable).values({
    profileId: profile.id,
    onboardingStatus: options.submitted === false ? "pending" : "submitted",
    approvalStatus: "pending",
    availabilityStatus: "offline",
    vehicleType: "van",
    vehicleMake: "Ford",
    vehicleModel: "Transit",
    vehicleColor: "White",
    licensePlate: "VERIFY1",
  }).returning();
  await db.insert(driverApplicationsTable).values({
    driverId: driver.id,
    licenseState: "NC",
    licenseLastFour: "1234",
    insuranceProvider: "Verification Mutual",
    insuranceExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    backgroundCheckStatus: options.backgroundCheckStatus ?? "clear",
    mvrCheckStatus: options.mvrCheckStatus ?? "clear",
    submittedAt: options.submitted === false ? null : new Date(),
  });
  const documentStatus = options.documentStatus ?? "approved";
  const documents = {} as VerificationFixture["documents"];
  for (const documentType of ["license", "insurance", "vehicle_registration"] as const) {
    const object = `private/driver-documents/${driver.id}/${documentType}-${randomUUID()}.pdf`;
    privateTestObjects.add(`test-private-bucket/${object}`);
    const [document] = await db.insert(driverDocumentsTable).values({
      driverId: driver.id,
      documentType,
      storagePath: `/objects/${object}`,
      verificationStatus: documentStatus,
      expiryDate: options.expiredDocument ? "2020-01-01" : "2030-01-01",
    }).returning();
    documents[documentType] = document.id;
  }
  return { profile, driverId: driver.id, documents };
}

async function seedCurrentComplianceDocuments(...driverIds: string[]): Promise<void> {
  await db.insert(driverDocumentsTable).values(
    driverIds.flatMap((driverId) =>
      ["license", "insurance", "vehicle_registration"].map((documentType) => ({
        driverId,
        documentType,
        storagePath: `/objects/test-compliance/${driverId}/${documentType}-${randomUUID()}`,
        verificationStatus: "approved",
        expiryDate: "2030-01-01",
      }))),
  );
}

async function createAvailableOffer(): Promise<string> {
  const checkout = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(checkout.status, 201);
  const publicDeliveryId = (checkout.body as { id: string }).id;
  const [delivery] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, publicDeliveryId))
    .limit(1);
  assert.ok(delivery);
  fixtureDeliveryIds.push(delivery.id);
  await db.update(deliveriesTable).set({
    deliveryStatus: "searching_driver",
    paymentStatus: "paid",
    driverId: null,
    offerExpiresAt: new Date(Date.now() + 60_000),
  }).where(eq(deliveriesTable.id, delivery.id));
  return publicDeliveryId;
}

async function waitForResendCall(expectedCount: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (resendMockCalls.length < expectedCount && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(resendMockCalls.length, expectedCount, "The password reset provider call should complete.");
}

async function waitForUsedResetToken(profileId: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const [record] = await db
      .select({ usedAt: passwordResetTokensTable.usedAt })
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.profileId, profileId))
      .limit(1);
    if (record?.usedAt) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("A recovery token must be invalidated after provider failure.");
}

test("enforces customer mobile-number bounds and permits signup without an address", async () => {
  const registration = async (phone: string) => {
    const response = await request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        firstName: "Signup",
        lastName: "Bounds",
        email: `signup-${runId}-${phone.length}-${randomUUID()}@example.test`,
        phone,
        password: "CustomerSignup2026!",
      }),
    });
    if (response.status === 201) {
      const profileId = (response.body as { profile: { id: string } }).profile.id;
      registeredProfileIds.push(profileId);
    }
    return response;
  };

  assert.equal((await registration("919555010")).status, 400, "nine digits must be rejected");
  assert.equal((await registration("9195550101234567")).status, 400, "sixteen digits must be rejected");

  const tenDigit = await registration("9195550100");
  assert.equal(tenDigit.status, 201, "ten digits must be accepted");
  assert.equal((tenDigit.body as { profile: { phone: string } }).profile.phone, "9195550100");

  const fifteenDigit = await registration("+1 (919) 555-01001234");
  assert.equal(fifteenDigit.status, 201, "fifteen digits must be accepted");
  assert.equal(
    (fifteenDigit.body as { profile: { phone: string } }).profile.phone,
    "+1 (919) 555-01001234",
  );
  assert.equal(
    (fifteenDigit.body as { profile: { role: string } }).profile.role,
    "customer",
  );
});

test("returns the quoted scheduled pickup window on checkout, owner list, and detail", async () => {
  const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const quote = await request("/api/deliveries/quote", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify({ ...deliveryBody, priority: "scheduled", scheduledPickupStartAt: start, scheduledPickupEndAt: end }),
  });
  assert.equal(quote.status, 200);
  assert.equal((quote.body as { scheduledPickupStartAt: string }).scheduledPickupStartAt, start);
  const checkout = await request("/api/deliveries", {
    method: "POST",
    headers: { ...bearer(customer), "idempotency-key": `scheduled-${randomUUID()}` },
    body: JSON.stringify({
      ...deliveryBody,
      priority: "scheduled",
      scheduledPickupStartAt: start,
      scheduledPickupEndAt: end,
      quoteId: (quote.body as { id: string }).id,
    }),
  });
  assert.equal(checkout.status, 201);
  const id = (checkout.body as { id: string }).id;
  const [scheduledDelivery] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, id))
    .limit(1);
  assert.ok(scheduledDelivery);
  fixtureDeliveryIds.push(scheduledDelivery.id);
  for (const body of [checkout.body, (await request("/api/deliveries", { headers: bearer(customer) })).body, (await request(`/api/deliveries/${id}`, { headers: bearer(customer) })).body]) {
    const delivery = (Array.isArray(body) ? body.find((item) => item.id === id) : body) as { scheduledPickupStartAt: string; scheduledPickupEndAt: string };
    assert.equal(delivery.scheduledPickupStartAt, start);
    assert.equal(delivery.scheduledPickupEndAt, end);
  }
});

test("holds far-future scheduled work out of driver matching until the 30-minute lead", async () => {
  await db.update(driversTable).set({
    currentLatitude: 35.7796,
    currentLongitude: -78.6382,
    lastLocationUpdate: new Date(),
  }).where(eq(driversTable.id, unassignedDriverId));
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const quote = await request("/api/deliveries/quote", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify({ ...deliveryBody, priority: "scheduled", scheduledPickupStartAt: start, scheduledPickupEndAt: end }),
  });
  assert.equal(quote.status, 200);
  const checkout = await request("/api/deliveries", {
    method: "POST",
    headers: { ...bearer(customer), "idempotency-key": `dispatch-lead-${randomUUID()}` },
    body: JSON.stringify({
      ...deliveryBody, priority: "scheduled", scheduledPickupStartAt: start, scheduledPickupEndAt: end,
      quoteId: (quote.body as { id: string }).id,
    }),
  });
  assert.equal(checkout.status, 201);
  const publicId = (checkout.body as { id: string }).id;
  const paymentIntentId = (checkout.body as { payment: { paymentIntentId: string } }).payment.paymentIntentId;
  fixtureDeliveryIds.push((await db.select({ id: deliveriesTable.id }).from(deliveriesTable).where(eq(deliveriesTable.publicDeliveryId, publicId)).limit(1))[0].id);
  await processVerifiedStripeEvent({
    id: `evt_scheduled_${randomUUID().replaceAll("-", "")}`,
    type: "payment_intent.succeeded",
    data: { object: { id: paymentIntentId, status: "succeeded" } },
  } as any);
  let [held] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.publicDeliveryId, publicId)).limit(1);
  assert.equal(held.paymentStatus, "paid");
  assert.equal(held.deliveryStatus, "paid");
  assert.equal((await listDriverOffers(unassignedDriver.id)).some((offer) => offer.id === publicId), false);

  const dueStart = new Date(Date.now() + 10 * 60 * 1000);
  const dueEnd = new Date(Date.now() + 70 * 60 * 1000);
  await db.update(deliveriesTable).set({
    scheduledAt: dueStart, scheduledPickupStartAt: dueStart, scheduledPickupEndAt: dueEnd,
  }).where(eq(deliveriesTable.id, held.id));
  const offers = await listDriverOffers(unassignedDriver.id);
  assert.equal((await db.select({ status: deliveriesTable.deliveryStatus }).from(deliveriesTable).where(eq(deliveriesTable.id, held.id)).limit(1))[0].status, "searching_driver");
  assert.ok(offers.some((offer) => offer.id === publicId));
});

test("validates scheduled quote pairs and keeps ASAP quotes unscheduled", async () => {
  const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const start = future.toISOString();
  const end = new Date(future.getTime() + 60 * 60 * 1000).toISOString();
  const quoteRequest = (body: Record<string, unknown>) => request("/api/deliveries/quote", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify({ ...deliveryBody, ...body }),
  });

  for (const invalid of [
    { priority: "scheduled", scheduledPickupStartAt: start },
    { priority: "scheduled", scheduledPickupEndAt: end },
    { priority: "scheduled", scheduledPickupStartAt: new Date(Date.now() - 60_000).toISOString(), scheduledPickupEndAt: end },
    { priority: "scheduled", scheduledPickupStartAt: end, scheduledPickupEndAt: start },
  ]) {
    const response = await quoteRequest(invalid);
    assert.equal(response.status, 400);
  }

  const asap = await quoteRequest({
    priority: "asap",
    scheduledPickupStartAt: start,
    scheduledPickupEndAt: end,
  });
  assert.equal(asap.status, 400, "ASAP must reject scheduled fields rather than silently changing intent");

  const unchanged = await quoteRequest({ priority: "asap" });
  assert.equal(unchanged.status, 200);
  assert.equal((unchanged.body as Record<string, unknown>).scheduledPickupStartAt, null);
  assert.equal((unchanged.body as Record<string, unknown>).scheduledPickupEndAt, null);
});

test("keeps saved addresses customer-owned across list, update, and delete", async () => {
  const addressBody = {
    label: "Home",
    fullAddress: "100 Fayetteville Street, Raleigh, NC 27601",
    street: "100 Fayetteville Street",
    city: "Raleigh",
    state: "NC",
    postalCode: "27601",
    country: "US",
    latitude: 35.7796,
    longitude: -78.6382,
    instructions: "Leave at the front desk",
    isDefault: true,
  };
  const create = await request("/api/addresses", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(addressBody),
  });
  assert.equal(create.status, 201);
  const created = create.body as { id: string; label: string; isDefault: boolean };
  assert.equal(created.label, "Home");
  assert.equal(created.isDefault, true);

  const ownList = await request("/api/addresses", { headers: bearer(customer) });
  assert.equal(ownList.status, 200);
  assert.ok(
    (ownList.body as Array<{ id: string }>).some((address) => address.id === created.id),
    "the creating customer should see the saved address",
  );

  const otherList = await request("/api/addresses", { headers: bearer(otherCustomer) });
  assert.equal(otherList.status, 200);
  assert.equal(
    (otherList.body as Array<{ id: string }>).some((address) => address.id === created.id),
    false,
    "another customer must not see the saved address",
  );

  const otherUpdate = await request(`/api/addresses/${created.id}`, {
    method: "PATCH",
    headers: bearer(otherCustomer),
    body: JSON.stringify({ ...addressBody, label: "Work" }),
  });
  assert.equal(otherUpdate.status, 404);

  const otherDelete = await request(`/api/addresses/${created.id}`, {
    method: "DELETE",
    headers: bearer(otherCustomer),
  });
  assert.equal(otherDelete.status, 404);

  const update = await request(`/api/addresses/${created.id}`, {
    method: "PATCH",
    headers: bearer(customer),
    body: JSON.stringify({
      ...addressBody,
      label: "Work",
      fullAddress: "300 South Dawson Street, Raleigh, NC 27601",
      street: "300 South Dawson Street",
      instructions: "Call on arrival",
      isDefault: false,
    }),
  });
  assert.equal(update.status, 200);
  assert.equal((update.body as { label: string; fullAddress: string; isDefault: boolean }).label, "Work");
  assert.equal(
    (update.body as { fullAddress: string }).fullAddress,
    "300 South Dawson Street, Raleigh, NC 27601",
  );
  assert.equal((update.body as { isDefault: boolean }).isDefault, false);

  const remove = await request(`/api/addresses/${created.id}`, {
    method: "DELETE",
    headers: bearer(customer),
  });
  assert.equal(remove.status, 204);
  const afterDelete = await request("/api/addresses", { headers: bearer(customer) });
  assert.equal(
    (afterDelete.body as Array<{ id: string }>).some((address) => address.id === created.id),
    false,
  );
});

test("allows credentialed sessions and SSE only from the public app origins", async () => {
  const approvedOrigins = [
    "https://www.anythinganywhere.com",
    "https://driver.anythinganywhere.com",
    "https://admin.anythinganywhere.com",
  ];

  for (const origin of approvedOrigins) {
    const preflight = await fetch(`${baseUrl}/api/auth/sign-in`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  }

  const rejectedPreflight = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: "OPTIONS",
    headers: {
      origin: "https://untrusted.example",
      "access-control-request-method": "POST",
    },
  });
  assert.equal(rejectedPreflight.headers.get("access-control-allow-origin"), null);
  assert.equal(rejectedPreflight.headers.get("access-control-allow-credentials"), null);

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: {
      origin: approvedOrigins[0],
      "content-type": "application/json",
    },
    body: JSON.stringify({
      firstName: "Cross",
      lastName: "Origin",
      email: `cross-origin-${randomUUID()}@example.test`,
      phone: "9195550148",
      password: "CrossOrigin2026!",
    }),
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.headers.get("access-control-allow-origin"), approvedOrigins[0]);
  assert.equal(registration.headers.get("access-control-allow-credentials"), "true");
  const cookie = sessionCookie(registration);
  assert.match(cookie, /;\s*Domain=\.anythinganywhere\.com;/i);
  assert.match(cookie, /;\s*HttpOnly;/i);
  assert.match(cookie, /;\s*Secure;/i);
  assert.match(cookie, /;\s*SameSite=Lax/i);
  const registered = await registration.json() as { profile: { id: string } };
  fixtureProfiles.push({
    id: registered.profile.id,
    authUserId: "",
    role: "customer",
    token: "",
  });
  const cookieHeader = cookie.split(";", 1)[0];
  const session = await fetch(`${baseUrl}/api/auth/session?noDemo=true`, {
    headers: { origin: approvedOrigins[0], cookie: cookieHeader },
  });
  assert.equal(session.status, 200);
  assert.match(session.headers.get("cache-control") ?? "", /\bno-store\b/i);
  assert.equal((await session.json() as { profile: { id: string } }).profile.id, registered.profile.id);

  for (const origin of approvedOrigins) {
    const deniedAdmin = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { origin, cookie: cookieHeader },
    });
    assert.equal(deniedAdmin.status, 401);
    assert.equal(deniedAdmin.headers.get("access-control-allow-origin"), origin);
    assert.equal(deniedAdmin.headers.get("access-control-allow-credentials"), "true");
  }

  const events = await fetch(`${baseUrl}/api/events?cursor=0`, {
    headers: {
      origin: approvedOrigins[1],
      cookie: cookieHeader,
    },
  });
  assert.equal(events.status, 200);
  assert.equal(events.headers.get("content-type"), "text/event-stream");
  assert.equal(events.headers.get("access-control-allow-origin"), approvedOrigins[1]);
  assert.equal(events.headers.get("access-control-allow-credentials"), "true");
  await events.body?.cancel();
});

test("consumes password reset links once, revokes sessions, and creates a new session", async () => {
  const resetProfile = await createProfile("customer");
  const resetToken = randomUUID();
  await db.insert(passwordResetTokensTable).values({
    profileId: resetProfile.id,
    tokenHash: hashToken(resetToken),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  const malformed = await request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ password: "NewPassword2026!" }),
  });
  assert.equal(malformed.status, 400);
  assert.match((malformed.body as { error: string }).error, /invalid or malformed/i);

  const completed = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: resetToken, password: "NewPassword2026!" }),
  });
  assert.equal(completed.status, 200);
  const cookie = sessionCookie(completed).split(";", 1)[0];
  const resetSession = await completed.json() as { profile: { id: string; role: string } };
  assert.equal(resetSession.profile.id, resetProfile.id);
  assert.equal(resetSession.profile.role, "customer");

  const priorSession = await request("/api/deliveries/summary", { headers: bearer(resetProfile) });
  assert.equal(priorSession.status, 401);

  const newSession = await fetch(`${baseUrl}/api/auth/session?noDemo=true`, {
    headers: { cookie },
  });
  assert.equal(newSession.status, 200);

  const signIn = await request("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({
      email: `customer-${runId}-${fixtureProfiles.length - 1}@example.test`,
      password: "NewPassword2026!",
    }),
  });
  assert.equal(signIn.status, 200);

  const replay = await request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token: resetToken, password: "AnotherPassword2026!" }),
  });
  assert.equal(replay.status, 410);
  assert.match((replay.body as { error: string }).error, /already been used/i);

  const expiredToken = randomUUID();
  await db.insert(passwordResetTokensTable).values({
    profileId: resetProfile.id,
    tokenHash: hashToken(expiredToken),
    expiresAt: new Date(Date.now() - 60_000),
  });
  const expired = await request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token: expiredToken, password: "AnotherPassword2026!" }),
  });
  assert.equal(expired.status, 410);
  assert.match((expired.body as { error: string }).error, /expired/i);

  const unknownRequest = await request("/api/auth/password-reset", {
    method: "POST",
    body: JSON.stringify({ email: `not-an-account-${randomUUID()}@example.test` }),
  });
  assert.equal(unknownRequest.status, 202);
  assert.deepEqual(unknownRequest.body, { accepted: true });
});

test("sends a trusted reset link and consumes the emailed token once", async () => {
  resendMockShouldFail = false;
  const resetProfile = await createProfile("customer");
  const requestStart = resendMockCalls.length;
  const response = await request("/api/auth/password-reset", {
    method: "POST",
    body: JSON.stringify({ email: resetProfile.email }),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { accepted: true });

  await waitForResendCall(requestStart + 1);
  const email = resendMockCalls[requestStart].body;
  assert.deepEqual(email.to, [resetProfile.email]);
  assert.equal(email.subject, "Reset your Anything Anywhere password");
  assert.match(email.text, /Use this link within 30 minutes:/);
  assert.match(email.html, /within 30 minutes/);

  const resetUrl = new URL(email.text.split("\n")[3] ?? "");
  assert.equal(resetUrl.origin, "https://www.anythinganywhere.com");
  assert.equal(resetUrl.pathname, "/reset-password");
  const resetToken = resetUrl.searchParams.get("token");
  assert.ok(resetToken);
  assert.equal(resetUrl.searchParams.size, 1);

  const [record] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.profileId, resetProfile.id))
    .limit(1);
  assert.ok(record);
  assert.equal(record.tokenHash, hashToken(resetToken));
  assert.equal(record.usedAt, null);

  const completed = await request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token: resetToken, password: "EmailResetPassword2026!" }),
  });
  assert.equal(completed.status, 200);

  const replay = await request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token: resetToken, password: "AnotherResetPassword2026!" }),
  });
  assert.equal(replay.status, 410);
  assert.match((replay.body as { error: string }).error, /already been used/i);
});

test("keeps staff password recovery inside the Admin application", async () => {
  resendMockShouldFail = false;
  const resetProfile = await createProfile("admin");
  const requestStart = resendMockCalls.length;
  const response = await request("/api/auth/admin/password-reset", {
    method: "POST",
    body: JSON.stringify({ email: resetProfile.email }),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { accepted: true });

  await waitForResendCall(requestStart + 1);
  const email = resendMockCalls[requestStart].body;
  assert.deepEqual(email.to, [resetProfile.email]);
  const resetUrl = new URL(email.text.split("\n")[3] ?? "");
  assert.equal(resetUrl.origin, "https://admin.anythinganywhere.com");
  assert.equal(resetUrl.pathname, "/admin/reset-password");
  const resetToken = resetUrl.searchParams.get("token");
  assert.ok(resetToken);

  const completed = await request("/api/auth/admin/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token: resetToken, password: "AdminResetPassword2026!" }),
  });
  assert.equal(completed.status, 200);
  assert.equal((completed.body as { profile: { role: string } }).profile.role, "admin");
});

test("admin password reset honors the configured staff timeout and never creates a customer session", async () => {
  const configured = await request("/api/admin/settings/security", {
    method: "PUT",
    headers: bearer(admin),
    body: JSON.stringify({ sessionTimeoutMinutes: 15, suspiciousLoginAlerts: true }),
  });
  assert.equal(configured.status, 200);

  const resetAdmin = await createProfile("admin");
  const adminToken = randomUUID();
  await db.insert(passwordResetTokensTable).values({
    profileId: resetAdmin.id,
    tokenHash: hashToken(adminToken),
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  const completed = await fetch(`${baseUrl}/api/auth/admin/password-reset/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: adminToken, password: "AdminTimeoutReset2026!" }),
  });
  assert.equal(completed.status, 200);
  const cookies = sessionCookies(completed);
  assert.equal(cookies.some((cookie) => cookie.startsWith("aa_admin_session=")), true);
  assert.equal(cookies.some((cookie) => cookie.startsWith("aa_session=")), false);
  const adminCookie = cookies.find((cookie) => cookie.startsWith("aa_admin_session="));
  assert.ok(adminCookie);
  const issuedToken = adminCookie.split(";", 1)[0].split("=", 2)[1];
  assert.ok(issuedToken);
  const [issuedSession] = await db
    .select({ expiresAt: sessionsTable.expiresAt })
    .from(sessionsTable)
    .where(eq(sessionsTable.tokenHash, hashToken(issuedToken)))
    .limit(1);
  assert.ok(issuedSession);
  const lifetime = issuedSession.expiresAt.getTime() - Date.now();
  assert.ok(lifetime >= 14 * 60_000 && lifetime <= 15 * 60_000 + 5_000);

  const resetCustomer = await createProfile("customer");
  const customerToken = randomUUID();
  await db.insert(passwordResetTokensTable).values({
    profileId: resetCustomer.id,
    tokenHash: hashToken(customerToken),
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  const customerAttempt = await fetch(`${baseUrl}/api/auth/admin/password-reset/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: customerToken, password: "CustomerResetDenied2026!" }),
  });
  assert.equal(customerAttempt.status, 400);
  assert.equal(customerAttempt.headers.get("set-cookie"), null);
  const [customerRecord] = await db
    .select({ usedAt: passwordResetTokensTable.usedAt })
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.tokenHash, hashToken(customerToken)))
    .limit(1);
  assert.equal(customerRecord.usedAt, null);
  await db.delete(securitySettingsTable).where(eq(securitySettingsTable.id, "security"));
});

test("admin settings require an admin session and persist validated general settings", async () => {
  assert.equal((await request("/api/admin/settings")).status, 401);
  assert.equal((await request("/api/admin/settings", { headers: bearer(dispatcher) })).status, 403);

  const initial = await request("/api/admin/settings", { headers: bearer(admin) });
  assert.equal(initial.status, 200);
  const general = (initial.body as { general: Record<string, unknown> }).general;
  const invalid = await request("/api/admin/settings/general", {
    method: "PUT",
    headers: bearer(admin),
    body: JSON.stringify({ ...general, businessEmail: "not-an-email" }),
  });
  assert.equal(invalid.status, 400);

  const saved = await request("/api/admin/settings/general", {
    method: "PUT",
    headers: bearer(admin),
    body: JSON.stringify({ ...general, tagline: `Settings test ${runId}` }),
  });
  assert.equal(saved.status, 200);
  assert.equal((saved.body as { tagline: string }).tagline, `Settings test ${runId}`);
  const reloaded = await request("/api/admin/settings", { headers: bearer(admin) });
  assert.equal((reloaded.body as { general: { tagline: string } }).general.tagline, `Settings test ${runId}`);
  const [persisted] = await db.select({ tagline: generalSettingsTable.tagline }).from(generalSettingsTable).limit(1);
  assert.equal(persisted?.tagline, `Settings test ${runId}`);
  const settingsAudit = await db.select({ action: adminAuditLogsTable.action }).from(adminAuditLogsTable)
    .where(and(eq(adminAuditLogsTable.actorProfileId, admin.id), eq(adminAuditLogsTable.action, "settings.general.updated")));
  assert.ok(settingsAudit.length >= 1);
  assert.equal((await request("/api/admin/settings/general", {
    method: "PUT", headers: bearer(dispatcher), body: JSON.stringify(general),
  })).status, 403);
});

test("security settings validate, audit, time-limit new staff sessions, and revoke other staff sessions", async () => {
  assert.equal((await request("/api/admin/settings/security")).status, 401);
  assert.equal((await request("/api/admin/settings/security", { headers: bearer(dispatcher) })).status, 403);
  const initial = await request("/api/admin/settings/security", { headers: bearer(admin) });
  assert.equal(initial.status, 200);
  assert.deepEqual((initial.body as { sessionTimeoutMinutes: number; suspiciousLoginAlerts: boolean }).sessionTimeoutMinutes, 60);
  assert.equal((await request("/api/admin/settings/security", {
    method: "PUT", headers: bearer(admin), body: JSON.stringify({ sessionTimeoutMinutes: 14, suspiciousLoginAlerts: true }),
  })).status, 400);
  const saved = await request("/api/admin/settings/security", {
    method: "PUT", headers: bearer(admin), body: JSON.stringify({ sessionTimeoutMinutes: 15, suspiciousLoginAlerts: false }),
  });
  assert.equal(saved.status, 200);
  assert.equal((saved.body as { sessionTimeoutMinutes: number; suspiciousLoginAlerts: boolean }).sessionTimeoutMinutes, 15);
  assert.equal(
    ((await request("/api/admin/settings/security", { headers: bearer(admin) })).body as { suspiciousLoginAlerts: boolean }).suspiciousLoginAlerts,
    false,
  );
  assert.ok((await db.select({ id: adminAuditLogsTable.id }).from(adminAuditLogsTable).where(and(
    eq(adminAuditLogsTable.actorProfileId, admin.id), eq(adminAuditLogsTable.action, "settings.security.updated"),
  ))).length);

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ firstName: "Timed", lastName: "Admin", email: `timed-admin-${runId}@example.test`, phone: "9195550191", password: "TimedAdminPassword2026!" }),
  });
  assert.equal(registration.status, 201);
  const timedProfile = (await registration.json() as { profile: { id: string } }).profile;
  registeredProfileIds.push(timedProfile.id);
  await db.update(profilesTable).set({ role: "admin" }).where(eq(profilesTable.id, timedProfile.id));
  const signIn = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `timed-admin-${runId}@example.test`, password: "TimedAdminPassword2026!", adminSession: true }),
  });
  assert.equal(signIn.status, 200);
  const token = sessionCookie(signIn).split(";", 1)[0].split("=", 2)[1];
  assert.ok(token);
  const [newSession] = await db.select({ expiresAt: sessionsTable.expiresAt }).from(sessionsTable)
    .where(eq(sessionsTable.tokenHash, hashToken(token))).limit(1);
  assert.ok(newSession);
  assert.ok(newSession.expiresAt.getTime() - Date.now() <= 15 * 60_000 + 5_000);
  assert.ok(newSession.expiresAt.getTime() - Date.now() >= 14 * 60_000);

  const otherStaff = await createProfile("support");
  const revoked = await request("/api/admin/settings/security/revoke-other-sessions", { method: "POST", headers: bearer(admin) });
  assert.equal(revoked.status, 200);
  assert.ok((revoked.body as { revokedSessionCount: number }).revokedSessionCount >= 1);
  assert.equal((await request("/api/admin/dashboard", { headers: bearer(otherStaff) })).status, 401);
  assert.equal((await request("/api/admin/dashboard", { headers: bearer(admin) })).status, 200);
  // Subsequent regressions share the dispatcher/support fixtures.
  await db.update(sessionsTable).set({ revokedAt: null }).where(inArray(
    sessionsTable.tokenHash,
    [hashToken(dispatcher.token), hashToken(support.token)],
  ));
});

test("payment fee policies persist, affect new quotes, and never reprice saved quotes", async () => {
  assert.equal((await request("/api/admin/settings/payments-fees", { headers: bearer(dispatcher) })).status, 403);
  const initial = await request("/api/admin/settings/payments-fees", { headers: bearer(admin) });
  assert.equal(initial.status, 200);
  assert.equal((await request("/api/admin/settings/payments-fees", {
    method: "PUT", headers: bearer(admin),
    body: JSON.stringify({ ...(initial.body as object), taxRateBasisPoints: 10001 }),
  })).status, 400);
  const policy = { currency: "USD", customerServiceFeeCents: 125, deliveryFeeCents: 250, smallOrderThresholdCents: 2_000, smallOrderFeeCents: 175, taxRateBasisPoints: 725, refundWindowDays: 30 };
  const saved = await request("/api/admin/settings/payments-fees", { method: "PUT", headers: bearer(admin), body: JSON.stringify(policy) });
  assert.equal(saved.status, 200);
  assert.equal((saved.body as { appliedToCheckout: boolean }).appliedToCheckout, true);
  assert.equal(
    ((await request("/api/admin/settings/payments-fees", { headers: bearer(admin) })).body as { currency: string }).currency,
    "USD",
  );
  assert.ok((await db.select({ id: adminAuditLogsTable.id }).from(adminAuditLogsTable).where(eq(adminAuditLogsTable.action, "settings.payments_fees.updated"))).length);

  const quoted = await request("/api/deliveries/quote", {
    method: "POST", headers: bearer(customer), body: JSON.stringify(deliveryBody),
  });
  assert.equal(quoted.status, 200);
  const firstQuote = quoted.body as { id: string; total: number; deliveryFee: number; customerServiceFee: number; smallOrderFee: number; tax: number };
  assert.equal(firstQuote.deliveryFee, 2.5);
  assert.equal(firstQuote.customerServiceFee, 1.25);
  assert.equal(firstQuote.smallOrderFee, 1.75);
  assert.ok(firstQuote.tax > 0);
  const changed = { ...policy, deliveryFeeCents: 9900, taxRateBasisPoints: 0 };
  assert.equal((await request("/api/admin/settings/payments-fees", { method: "PUT", headers: bearer(admin), body: JSON.stringify(changed) })).status, 200);
  const newerQuote = await request("/api/deliveries/quote", { method: "POST", headers: bearer(customer), body: JSON.stringify(deliveryBody) });
  assert.equal(newerQuote.status, 200);
  assert.notEqual((newerQuote.body as { total: number }).total, firstQuote.total);
  const checkout = await request("/api/deliveries", {
    method: "POST", headers: { ...bearer(customer), "idempotency-key": randomUUID() },
    body: JSON.stringify({ ...deliveryBody, quoteId: firstQuote.id }),
  });
  assert.equal(checkout.status, 201);
  assert.equal((checkout.body as { total: number }).total, firstQuote.total);
  const [pricedDelivery] = await db.select({ id: deliveriesTable.id }).from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, (checkout.body as { id: string }).id)).limit(1);
  assert.ok(pricedDelivery);
  fixtureDeliveryIds.push(pricedDelivery.id);
});

test("email settings validate and redact provider failures while using the Resend mock", async () => {
  assert.equal((await request("/api/admin/settings/email", { headers: bearer(dispatcher) })).status, 403);
  const initial = await request("/api/admin/settings/email", { headers: bearer(admin) });
  assert.equal(initial.status, 200);
  assert.equal((await request("/api/admin/settings/email", {
    method: "PUT", headers: bearer(admin), body: JSON.stringify({ ...(initial.body as object), replyToEmail: "invalid" }),
  })).status, 400);
  const emailPolicy = { senderDisplayName: "Anything Anywhere Ops", replyToEmail: "ops@example.test", supportEmail: "help@example.test", welcomeEnabled: false, passwordResetEnabled: true, orderConfirmationEnabled: false, orderDeliveredEnabled: true };
  assert.equal((await request("/api/admin/settings/email", { method: "PUT", headers: bearer(admin), body: JSON.stringify(emailPolicy) })).status, 200);
  assert.equal(
    ((await request("/api/admin/settings/email", { headers: bearer(admin) })).body as { senderDisplayName: string }).senderDisplayName,
    emailPolicy.senderDisplayName,
  );
  assert.ok((await db.select({ id: adminAuditLogsTable.id }).from(adminAuditLogsTable).where(eq(adminAuditLogsTable.action, "settings.email.updated"))).length);
  const start = resendMockCalls.length;
  resendMockShouldFail = false;
  assert.equal((await request("/api/admin/settings/email/test", { method: "POST", headers: bearer(admin) })).status, 202);
  await waitForResendCall(start + 1);
  assert.equal(resendMockCalls[start].body.subject, "Anything Anywhere email settings test");
  resendMockShouldFail = true;
  const failed = await request("/api/admin/settings/email/test", { method: "POST", headers: bearer(admin) });
  assert.equal(failed.status, 503);
  assert.equal(JSON.stringify(failed.body).includes("provider body must not be logged"), false);
  resendMockShouldFail = false;
});

test("admin promotions normalize codes, validate and preserve redeemed economic terms", async () => {
  const promotion = { code: `sale_${runId.slice(0, 8)}`, description: "Integration sale", discountType: "percent", discountValue: 10, startsAt: null, expiresAt: null, maxRedemptions: 10 };
  assert.equal((await request("/api/admin/promotions", { method: "POST", headers: bearer(dispatcher), body: JSON.stringify(promotion) })).status, 403);
  assert.equal((await request("/api/admin/promotions", { method: "POST", headers: bearer(admin), body: JSON.stringify({ ...promotion, discountValue: 101 }) })).status, 400);
  const created = await request("/api/admin/promotions", { method: "POST", headers: bearer(admin), body: JSON.stringify(promotion) });
  assert.equal(created.status, 201);
  const saved = created.body as { id: string; code: string; active: boolean };
  fixturePromotionIds.push(saved.id);
  assert.equal(saved.code, promotion.code.toUpperCase());
  assert.equal((await request("/api/admin/promotions", { method: "POST", headers: bearer(admin), body: JSON.stringify({ ...promotion, code: promotion.code.toUpperCase() }) })).status, 409);
  assert.equal((await request(`/api/admin/promotions/${saved.id}/status`, { method: "POST", headers: bearer(admin), body: JSON.stringify({ active: true }) })).status, 200);
  await db.update(promoCodesTable).set({ redemptionCount: "1" }).where(eq(promoCodesTable.id, saved.id));
  assert.equal((await request(`/api/admin/promotions/${saved.id}`, { method: "PUT", headers: bearer(admin), body: JSON.stringify({ ...promotion, code: "rewritten", discountValue: 20 }) })).status, 409);
  const edited = await request(`/api/admin/promotions/${saved.id}`, { method: "PUT", headers: bearer(admin), body: JSON.stringify({ ...promotion, description: "Updated safely" }) });
  assert.equal(edited.status, 200);
  assert.equal((await request(`/api/admin/promotions/${saved.id}/status`, { method: "POST", headers: bearer(admin), body: JSON.stringify({ active: false }) })).status, 200);
  const reloaded = await request("/api/admin/promotions", { headers: bearer(admin) });
  assert.equal(reloaded.status, 200);
  const listedPromotion = (reloaded.body as Array<{ id: string; active: boolean }>).find((entry) => entry.id === saved.id);
  assert.equal(listedPromotion?.active, false);
  const auditActions = await db.select({ action: adminAuditLogsTable.action }).from(adminAuditLogsTable).where(eq(adminAuditLogsTable.entityId, saved.id));
  assert.ok(["promotion.created", "promotion.updated", "promotion.activated", "promotion.deactivated"].every((action) => auditActions.some((audit) => audit.action === action)));
});

test("admin integration and system status are authorized, live, timestamped, and secret-free", async () => {
  for (const path of ["/api/admin/settings/integrations", "/api/admin/settings/system-status"]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { headers: bearer(dispatcher) })).status, 403);
  }
  const integrations = await request("/api/admin/settings/integrations", { headers: bearer(admin) });
  assert.equal(integrations.status, 200);
  const integrationText = JSON.stringify(integrations.body);
  assert.equal(integrationText.includes(process.env.GOOGLE_MAPS_SERVER_API_KEY!), false);
  assert.equal(integrationText.includes("provider body must not be logged"), false);
  const health = integrations.body as {
    api: { healthy: boolean; lastCheckedAt: string };
    database: { healthy: boolean; lastCheckedAt: string };
    stripe: { configured: boolean; healthy: boolean; lastCheckedAt: string };
  };
  assert.equal(health.api.healthy, true);
  assert.equal(health.database.healthy, true);
  assert.ok(Number.isFinite(new Date(health.database.lastCheckedAt).getTime()));
  assert.equal(health.stripe.configured, true);
  assert.equal(typeof health.stripe.healthy, "boolean", "credential lookup may make a configured/test-mode Stripe integration healthy");
  assert.ok(Number.isFinite(new Date(health.stripe.lastCheckedAt).getTime()));
  const system = await request("/api/admin/settings/system-status", { headers: bearer(admin) });
  assert.equal(system.status, 200);
  assert.equal((system.body as { api: string; database: string }).api, "healthy");
  assert.equal((system.body as { database: string }).database, "healthy");
  assert.ok(Number.isFinite(new Date((system.body as { checkedAt: string }).checkedAt).getTime()));
});

test("admin staff settings keep credentials private and support session revocation", async () => {
  const users = await request("/api/admin/settings/admin-users", { headers: bearer(admin) });
  assert.equal(users.status, 200);
  const supportUser = (users.body as Array<{ id: string; email: string; passwordHash?: string; token?: string }>).find((user) => user.id === support.id);
  assert.ok(supportUser);
  assert.equal("passwordHash" in supportUser, false);
  assert.equal("token" in supportUser, false);

  const selfDisable = await request(`/api/admin/settings/admin-users/${admin.id}`, {
    method: "PATCH", headers: bearer(admin), body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(selfDisable.status, 400);
  const revocationTarget = await createProfile("support");
  const revoked = await request(`/api/admin/settings/admin-users/${revocationTarget.id}/revoke-sessions`, {
    method: "POST", headers: bearer(admin),
  });
  assert.equal(revoked.status, 200);
  assert.ok((revoked.body as { revokedSessionCount: number }).revokedSessionCount >= 1);
  assert.equal((await request("/api/admin/dashboard", { headers: bearer(revocationTarget) })).status, 401);
});

test("pending drivers cannot become operational", async () => {
  const pending = await createVerificationFixture({
    submitted: false,
    backgroundCheckStatus: "not_started",
    mvrCheckStatus: "not_started",
  });
  const offerId = await createAvailableOffer();

  const online = await request("/api/driver/availability", {
    method: "PATCH",
    headers: bearer(pending.profile),
    body: JSON.stringify({ availabilityStatus: "online" }),
  });
  assert.equal(online.status, 400);
  assert.equal((await request("/api/driver/offers", { headers: bearer(pending.profile) })).status, 403);
  assert.equal((await request(`/api/driver/deliveries/${offerId}/accept`, {
    method: "POST",
    headers: bearer(pending.profile),
  })).status, 400);
});

test("Admin approval reports each unmet Driver verification prerequisite", async () => {
  const attemptApproval = async (fixture: VerificationFixture, requirement: string) => {
    const response = await request(`/api/admin/drivers/${fixture.driverId}/decision`, {
      method: "POST",
      headers: bearer(admin),
      body: JSON.stringify({ decision: "approved" }),
    });
    assert.equal(response.status, 409);
    assert.equal(
      (response.body as { requirements: Array<{ code: string }> }).requirements.some(({ code }) => code === requirement),
      true,
      `approval should report ${requirement}`,
    );
    const [driver] = await db.select({
      approvalStatus: driversTable.approvalStatus,
      onboardingStatus: driversTable.onboardingStatus,
      availabilityStatus: driversTable.availabilityStatus,
    }).from(driversTable).where(eq(driversTable.id, fixture.driverId));
    assert.deepEqual(driver, {
      approvalStatus: "pending",
      onboardingStatus: fixture === unsubmitted ? "pending" : "submitted",
      availabilityStatus: "offline",
    });
  };

  const unsubmitted = await createVerificationFixture({ submitted: false });
  await attemptApproval(unsubmitted, "ONBOARDING_NOT_SUBMITTED");

  const missingDocuments = await createVerificationFixture();
  await db.delete(driverDocumentsTable).where(eq(driverDocumentsTable.driverId, missingDocuments.driverId));
  await attemptApproval(missingDocuments, "LICENSE_DOCUMENT_MISSING");

  await attemptApproval(await createVerificationFixture({ documentStatus: "pending" }), "LICENSE_DOCUMENT_NOT_APPROVED");
  await attemptApproval(await createVerificationFixture({ documentStatus: "rejected" }), "LICENSE_DOCUMENT_NOT_APPROVED");
  await attemptApproval(await createVerificationFixture({ expiredDocument: true }), "LICENSE_DOCUMENT_EXPIRED");
  await attemptApproval(await createVerificationFixture({ backgroundCheckStatus: "pending" }), "BACKGROUND_CHECK_NOT_CLEAR");
  await attemptApproval(await createVerificationFixture({ mvrCheckStatus: "review" }), "MVR_NOT_CLEAR");
});

test("only Admins can decide verification or access a private Driver document URL", async () => {
  const fixture = await createVerificationFixture();
  const documentId = fixture.documents.license;

  assert.equal((await request(`/api/admin/drivers/${fixture.driverId}/decision`, {
    method: "POST",
    headers: bearer(dispatcher),
    body: JSON.stringify({ decision: "approved" }),
  })).status, 403);
  assert.equal((await request(`/api/admin/driver-documents/${documentId}/download-url`, {
    method: "POST",
    headers: bearer(dispatcher),
  })).status, 403);

  const downloaded = await request(`/api/admin/driver-documents/${documentId}/download-url`, {
    method: "POST",
    headers: bearer(admin),
  });
  assert.equal(downloaded.status, 200);
  const download = downloaded.body as { url: string; expiresAt: string };
  assert.match(download.url, /^https:\/\/signed-private\.example\.test\//);
  assert.match(download.url, /X-Goog-Expires=300/);
  assert.equal(download.url.includes("/objects/"), false, "a permanent object path must not be returned");
  const expiresIn = new Date(download.expiresAt).getTime() - Date.now();
  assert.ok(expiresIn > 0 && expiresIn <= 5 * 60_000, "the document URL expiry must be short-lived");
});

test("complete verification approves atomically and enables the Driver offer workflow", async () => {
  setPickupRouteProviderForTests(async () => ({ distanceMiles: 1, minutes: 5, source: "road" }));
  try {
  const fixture = await createVerificationFixture();
  const decision = await request(`/api/admin/drivers/${fixture.driverId}/decision`, {
    method: "POST",
    headers: bearer(admin),
    body: JSON.stringify({ decision: "approved" }),
  });
  assert.equal(decision.status, 200);

  const [approved] = await db.select({
    approvalStatus: driversTable.approvalStatus,
    onboardingStatus: driversTable.onboardingStatus,
    availabilityStatus: driversTable.availabilityStatus,
    profileStatus: profilesTable.status,
  }).from(driversTable).innerJoin(profilesTable, eq(profilesTable.id, driversTable.profileId))
    .where(eq(driversTable.id, fixture.driverId));
  assert.deepEqual(approved, {
    approvalStatus: "approved",
    onboardingStatus: "approved",
    availabilityStatus: "offline",
    profileStatus: "active",
  });

  const online = await request("/api/driver/availability", {
    method: "PATCH",
    headers: bearer(fixture.profile),
    body: JSON.stringify({ availabilityStatus: "online" }),
  });
  assert.equal(online.status, 200);
  const location = await request("/api/driver/location", {
    method: "PATCH", headers: bearer(fixture.profile),
    body: JSON.stringify({ latitude: 35.7796, longitude: -78.6382, capturedAt: new Date().toISOString() }),
  });
  assert.equal(location.status, 200);
  const offerId = await createAvailableOffer();
  const offers = await request("/api/driver/offers", { headers: bearer(fixture.profile) });
  assert.equal(offers.status, 200);
  assert.equal((offers.body as Array<{ id: string }>).some((offer) => offer.id === offerId), true);
  assert.equal((await request(`/api/driver/deliveries/${offerId}/accept`, {
    method: "POST",
    headers: bearer(fixture.profile),
  })).status, 200);
  } finally {
    setPickupRouteProviderForTests();
  }
});

test("keeps password reset responses generic while throttling repeated requests", async () => {
  resendMockShouldFail = false;
  const resetProfile = await createProfile("customer");
  const email = resetProfile.email;
  const requestStart = resendMockCalls.length;
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => request("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ email }),
    })),
  );

  for (const response of responses) {
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, { accepted: true });
  }
  await waitForResendCall(requestStart + 3);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(resendMockCalls.length, requestStart + 3);
});

test("invalidates the recovery token when Resend rejects delivery", async () => {
  resendMockShouldFail = true;
  const resetProfile = await createProfile("customer");
  const requestStart = resendMockCalls.length;
  const response = await request("/api/auth/password-reset", {
    method: "POST",
    body: JSON.stringify({ email: resetProfile.email }),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { accepted: true });

  await waitForResendCall(requestStart + 1);
  await waitForUsedResetToken(resetProfile.id);
  const [record] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.profileId, resetProfile.id))
    .limit(1);
  assert.ok(record);
  assert.ok(record.usedAt);
});

test("driver onboarding requires all current documents and returns every persisted vehicle field", async () => {
  const candidate = await createProfile("driver");
  const [candidateDriver] = await db.insert(driversTable).values({
    profileId: candidate.id,
    onboardingStatus: "pending",
    approvalStatus: "pending",
    availabilityStatus: "offline",
  }).returning();
  const onboarding = {
    firstName: "Avery",
    lastName: "Driver",
    phone: "9195550100",
    licenseState: "NC",
    licenseLastFour: "1234",
    vehicleType: "van",
    vehicleMake: "Ford",
    vehicleModel: "Transit",
    vehicleColor: "White",
    licensePlate: "ABC1234",
    insuranceProvider: "Example Mutual",
    insuranceExpiresAt: "2027-06-30",
    acknowledgeSafety: true,
  };

  const customerDenied = await request("/api/driver/onboarding", {
    method: "PATCH",
    headers: bearer(customer),
    body: JSON.stringify(onboarding),
  });
  assert.equal(customerDenied.status, 403);

  const missingDocuments = await request("/api/driver/onboarding", {
    method: "PATCH",
    headers: bearer(candidate),
    body: JSON.stringify(onboarding),
  });
  assert.equal(missingDocuments.status, 400);
  const [unchanged] = await db.select({ onboardingStatus: driversTable.onboardingStatus })
    .from(driversTable).where(eq(driversTable.id, candidateDriver.id));
  assert.equal(unchanged.onboardingStatus, "pending");

  await db.insert(driverDocumentsTable).values([
    { driverId: candidateDriver.id, documentType: "license", storagePath: "/objects/license", verificationStatus: "pending" },
    { driverId: candidateDriver.id, documentType: "insurance", storagePath: "/objects/insurance", verificationStatus: "rejected" },
    { driverId: candidateDriver.id, documentType: "vehicle_registration", storagePath: "/objects/registration", verificationStatus: "pending" },
  ]);
  const rejectedDocument = await request("/api/driver/onboarding", {
    method: "PATCH",
    headers: bearer(candidate),
    body: JSON.stringify(onboarding),
  });
  assert.equal(rejectedDocument.status, 400);

  await db.insert(driverDocumentsTable).values({
    driverId: candidateDriver.id,
    documentType: "insurance",
    storagePath: "/objects/replacement-insurance",
    verificationStatus: "pending",
  });
  const submitted = await request("/api/driver/onboarding", {
    method: "PATCH",
    headers: bearer(candidate),
    body: JSON.stringify(onboarding),
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.onboardingStatus, "submitted");
  assert.equal(submitted.body.profile.approvalStatus, "pending");
  assert.equal(submitted.body.vehicleType, "van");
  assert.equal(submitted.body.vehicleMake, "Ford");
  assert.equal(submitted.body.vehicleModel, "Transit");
  assert.equal(submitted.body.vehicleColor, "White");
  assert.equal(submitted.body.licensePlate, "ABC1234");

  const resumed = await request("/api/driver/onboarding", { headers: bearer(candidate) });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.vehicleType, "van");
  assert.equal(resumed.body.vehicleMake, "Ford");
  assert.equal(resumed.body.vehicleModel, "Transit");
  assert.equal(resumed.body.vehicleColor, "White");
  assert.equal(resumed.body.licensePlate, "ABC1234");
});

test("driver profile edits are session-owned, preserve approved compliance data, and retain active vehicle snapshots", async () => {
  const owner = await createVerificationFixture();
  const other = await createVerificationFixture();
  await db.update(driversTable).set({ approvalStatus: "approved", onboardingStatus: "approved" })
    .where(eq(driversTable.id, owner.driverId));
  await db.update(driversTable).set({ approvalStatus: "approved", onboardingStatus: "approved" })
    .where(eq(driversTable.id, other.driverId));

  const customerDenied = await request("/api/driver/profile", {
    method: "PATCH", headers: bearer(customer), body: JSON.stringify({ firstName: "Denied" }),
  });
  assert.equal(customerDenied.status, 403, "a non-driver cannot alter a driver profile");

  const safe = await request("/api/driver/profile", {
    method: "PATCH", headers: bearer(owner.profile), body: JSON.stringify({
      firstName: "Updated", phone: "9195550199", address: "100 Safe Street, Raleigh, NC",
      emergencyContactName: "Casey Contact", emergencyContactPhone: "9195550188",
    }),
  });
  assert.equal(safe.status, 200);
  assert.equal((safe.body as { profile: { firstName: string } }).profile.firstName, "Updated");
  const [ownerProfile] = await db.select().from(profilesTable).where(eq(profilesTable.id, owner.profile.id));
  assert.equal(ownerProfile.firstName, "Updated");
  assert.equal(ownerProfile.address, "100 Safe Street, Raleigh, NC");
  assert.equal(ownerProfile.emergencyContactName, "Casey Contact");

  const ownOnly = await request("/api/driver/profile", {
    method: "PATCH", headers: bearer(other.profile), body: JSON.stringify({ vehicleMake: "Other Driver Vehicle" }),
  });
  assert.equal(ownOnly.status, 200);
  const [ownerBefore] = await db.select().from(driversTable).where(eq(driversTable.id, owner.driverId));
  assert.equal(ownerBefore.vehicleMake, "Ford", "one driver's session cannot select another driver's identity");

  const [active] = await db.insert(deliveriesTable).values({
    publicDeliveryId: randomUUID(), orderNumber: `PROFILE-${randomUUID()}`, customerId: customer.id,
    driverId: owner.driverId, pickupAddress: "100 Fayetteville Street", pickupContactName: "Pickup", pickupContactPhone: "9195550100",
    dropoffAddress: "300 South Dawson Street", recipientName: "Recipient", recipientPhone: "9195550101",
    packageCategory: "Documents", weightCategory: "under5", sizeCategory: "small", careLevel: "standard", priority: "asap",
    basePrice: "10", distanceFee: "1", careFee: "0", tax: "0", totalPrice: "11", paymentStatus: "paid", deliveryStatus: "driver_assigned",
    driverVehicleSnapshot: { vehicleType: "van", vehicleMake: "Ford", vehicleModel: "Transit", vehicleColor: "White", licensePlate: "VERIFY1" },
  }).returning();
  fixtureDeliveryIds.push(active.id);

  const submitted = await request("/api/driver/profile", {
    method: "PATCH", headers: bearer(owner.profile),
    body: JSON.stringify({ vehicleMake: "Mercedes", vehicleYear: 2024, licensePlate: "NEWPLATE", insuranceProvider: "New Mutual" }),
  });
  assert.equal(submitted.status, 200);
  assert.equal((submitted.body as { complianceReviewStatus: string }).complianceReviewStatus, "pending");
  const [preserved] = await db.select().from(driversTable).where(eq(driversTable.id, owner.driverId));
  assert.equal(preserved.vehicleMake, "Ford");
  assert.equal(preserved.licensePlate, "VERIFY1");
  const [preservedApplication] = await db.select().from(driverApplicationsTable).where(eq(driverApplicationsTable.driverId, owner.driverId));
  assert.equal(preservedApplication.insuranceProvider, "Verification Mutual");
  const [stableDelivery] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.id, active.id));
  assert.deepEqual(stableDelivery.driverVehicleSnapshot, { vehicleType: "van", vehicleMake: "Ford", vehicleModel: "Transit", vehicleColor: "White", licensePlate: "VERIFY1" });

  const adminList = await request("/api/admin/driver-review", { headers: bearer(admin) });
  assert.equal(adminList.status, 200);
  const listed = (adminList.body as Array<{ id: string; complianceReviewStatus?: string; pendingProfileChanges?: Record<string, string> | null }>)
    .find((record) => record.id === owner.driverId);
  assert.equal(listed?.complianceReviewStatus, "pending");
  assert.deepEqual(listed?.pendingProfileChanges, {
    vehicleMake: "Mercedes", vehicleYear: 2024, licensePlate: "NEWPLATE", insuranceProvider: "New Mutual",
  });

  const adminDetail = await request(`/api/admin/drivers/${owner.driverId}/review`, { headers: bearer(admin) });
  assert.equal(adminDetail.status, 200);
  const detail = adminDetail.body as {
    application: { insuranceProvider: string };
    complianceReviewStatus: string;
    pendingProfileChanges: Record<string, string> | null;
    pendingProfileSubmittedAt: string | null;
  };
  assert.equal(detail.application.insuranceProvider, "Verification Mutual", "approved application data remains separately visible");
  assert.equal(detail.complianceReviewStatus, "pending");
  assert.equal(detail.pendingProfileChanges?.vehicleMake, "Mercedes");
  assert.equal(detail.pendingProfileChanges?.vehicleYear, 2024);
  assert.ok(detail.pendingProfileSubmittedAt);
  assert.equal(JSON.stringify(detail).includes("storagePath"), false, "admin review detail must not expose private object paths");

  const dispatcherDetail = await request(`/api/admin/drivers/${owner.driverId}/review`, { headers: bearer(dispatcher) });
  assert.equal(dispatcherDetail.status, 200);
  assert.equal("pendingProfileChanges" in (dispatcherDetail.body as Record<string, unknown>), false, "non-admin staff do not receive compliance request details");
  const customerReviewDenied = await request(`/api/admin/drivers/${owner.driverId}/review`, { headers: bearer(customer) });
  assert.equal(customerReviewDenied.status, 403);

  const onboarding = await request("/api/driver/onboarding", { headers: bearer(owner.profile) });
  assert.equal(onboarding.status, 200);
  assert.equal(JSON.stringify(onboarding.body).includes("storagePath"), false, "private object paths must never reach drivers");

  const rejected = await request(`/api/admin/drivers/${owner.driverId}/profile-review`, {
    method: "POST", headers: bearer(admin), body: JSON.stringify({ decision: "rejected", reason: "Plate image is unreadable" }),
  });
  assert.equal(rejected.status, 200);
  assert.equal((rejected.body as { complianceReviewStatus: string; complianceReviewReason: string }).complianceReviewStatus, "rejected");
  assert.match((rejected.body as { complianceReviewReason: string }).complianceReviewReason, /unreadable/);

  const resubmitted = await request("/api/driver/profile", {
    method: "PATCH", headers: bearer(owner.profile), body: JSON.stringify({ licensePlate: "CLEAR123" }),
  });
  assert.equal(resubmitted.status, 200);
  const approved = await request(`/api/admin/drivers/${owner.driverId}/profile-review`, {
    method: "POST", headers: bearer(admin), body: JSON.stringify({ decision: "approved" }),
  });
  assert.equal(approved.status, 200);
  const [applied] = await db.select().from(driversTable).where(eq(driversTable.id, owner.driverId));
  assert.equal(applied.licensePlate, "CLEAR123");
  const [audit] = await db.select().from(adminAuditLogsTable)
    .where(and(eq(adminAuditLogsTable.entityId, owner.driverId), eq(adminAuditLogsTable.action, "driver.profile_change_approved")));
  assert.ok(audit?.metadata.oldValues && audit.metadata.newValues, "the staff decision and its old/new values are written in the review transaction");
});

test("expired current compliance blocks new offers, acceptance, and dispatch assignment without changing deliveries", async () => {
  const driverFixture = await createVerificationFixture();
  await db.update(driversTable).set({ approvalStatus: "approved", onboardingStatus: "approved", availabilityStatus: "online" })
    .where(eq(driversTable.id, driverFixture.driverId));
  await db.insert(driverDocumentsTable).values(
    ["license", "insurance", "vehicle_registration"].map((documentType) => ({
      driverId: driverFixture.driverId,
      documentType,
      storagePath: `/objects/test-compliance/expired-${driverFixture.driverId}-${documentType}-${randomUUID()}`,
      verificationStatus: "approved",
      expiryDate: "2020-01-01",
    })),
  );
  const offerId = await createAvailableOffer();
  const offers = await request("/api/driver/offers", { headers: bearer(driverFixture.profile) });
  assert.equal(offers.status, 403);
  const accept = await request(`/api/driver/deliveries/${offerId}/accept`, {
    method: "POST", headers: bearer(driverFixture.profile),
  });
  assert.equal(accept.status, 400);
  const dispatch = await request(`/api/admin/deliveries/${offerId}/assign`, {
    method: "POST", headers: bearer(dispatcher), body: JSON.stringify({ driverId: driverFixture.driverId }),
  });
  assert.equal(dispatch.status, 400);
  const [delivery] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.publicDeliveryId, offerId));
  assert.equal(delivery.driverId, null, "future-work denial must not mutate delivery assignment");
  assert.equal(delivery.deliveryStatus, "searching_driver");
});

async function createAssignedDeliveryFixture(
  deliveryStatus: "driver_assigned" | "driver_arrived_delivery" | "delivery_verification_pending" = "driver_assigned",
) {
  const checkout = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(checkout.status, 201);
  const publicDeliveryId = (checkout.body as { id: string }).id;
  const [delivery] = await db
    .select({ id: deliveriesTable.id, publicDeliveryId: deliveriesTable.publicDeliveryId })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, publicDeliveryId))
    .limit(1);
  assert.ok(delivery);
  fixtureDeliveryIds.push(delivery.id);
  await db
    .update(deliveriesTable)
    .set({
      driverId: assignedDriverId,
      assignedAt: new Date(),
      paymentStatus: "paid",
      deliveryStatus,
    })
    .where(eq(deliveriesTable.id, delivery.id));
  return delivery;
}

before(async () => {
  customer = await createProfile("customer");
  otherCustomer = await createProfile("customer");
  dispatcher = await createProfile("dispatcher");
  admin = await createProfile("admin");
  support = await createProfile("support");
  assignedDriver = await createProfile("driver");
  unassignedDriver = await createProfile("driver");

  const [driver] = await db
    .insert(driversTable)
    .values({
      profileId: assignedDriver.id,
      onboardingStatus: "complete",
      availabilityStatus: "available",
      approvalStatus: "approved",
      vehicleMake: "Toyota",
      vehicleModel: "Prius",
      vehicleColor: "Blue",
    })
    .returning();
  assignedDriverId = driver.id;

  const [secondDriver] = await db
    .insert(driversTable)
    .values({
      profileId: unassignedDriver.id,
      onboardingStatus: "complete",
      availabilityStatus: "available",
      approvalStatus: "approved",
    })
    .returning();
  unassignedDriverId = secondDriver.id;
  await seedCurrentComplianceDocuments(driver.id, secondDriver.id);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  if (fixtureDeliveryIds.length) {
    const paymentIds = (
      await db
        .select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(inArray(paymentsTable.deliveryId, fixtureDeliveryIds))
    ).map((payment) => payment.id);
    await db.delete(paymentWebhookEventsTable).where(inArray(paymentWebhookEventsTable.deliveryId, fixtureDeliveryIds));
    if (paymentIds.length) {
      await db.delete(adminAuditLogsTable).where(inArray(adminAuditLogsTable.entityId, paymentIds));
      await db.delete(refundOperationsTable).where(inArray(refundOperationsTable.paymentId, paymentIds));
    }
    await db.delete(adminAuditLogsTable).where(inArray(adminAuditLogsTable.entityId, fixtureDeliveryIds));
    await db.delete(driverDeliveryOfferAttemptsTable).where(inArray(driverDeliveryOfferAttemptsTable.deliveryId, fixtureDeliveryIds));
    await db.delete(paymentsTable).where(inArray(paymentsTable.deliveryId, fixtureDeliveryIds));
    await db.delete(deliveryStatusHistoryTable).where(inArray(deliveryStatusHistoryTable.deliveryId, fixtureDeliveryIds));
    await db.delete(deliveriesTable).where(inArray(deliveriesTable.id, fixtureDeliveryIds));
  }
  if (fixturePromotionIds.length) {
    await db.delete(promoCodesTable).where(inArray(promoCodesTable.id, fixturePromotionIds));
  }
  // Settings tests initialize singleton rows; leave the integration database in
  // the same unconfigured state in which it began.
  await db.delete(securitySettingsTable).where(eq(securitySettingsTable.id, "security"));
  await db.delete(paymentFeeSettingsTable).where(eq(paymentFeeSettingsTable.id, "payments"));
  await db.delete(emailSettingsTable).where(eq(emailSettingsTable.id, "email"));
  await db.delete(deliveryQuotesTable).where(eq(deliveryQuotesTable.customerId, customer.id));
  const profileIds = fixtureProfiles.map((profile) => profile.id);
  if (profileIds.length) {
    const ticketIds = (
      await db
        .select({ id: supportTicketsTable.id })
        .from(supportTicketsTable)
        .where(inArray(supportTicketsTable.customerId, profileIds))
    ).map((ticket) => ticket.id);
    if (ticketIds.length) await db.delete(supportTicketsTable).where(inArray(supportTicketsTable.id, ticketIds));
    const driverIds = (await db.select({ id: driversTable.id }).from(driversTable).where(inArray(driversTable.profileId, profileIds))).map((driver) => driver.id);
    if (driverIds.length) await db.delete(driverIncidentsTable).where(inArray(driverIncidentsTable.driverId, driverIds));
    if (driverIds.length) await db.delete(driverPreferencesTable).where(inArray(driverPreferencesTable.driverId, driverIds));
    await db.delete(driverDocumentsTable).where(inArray(driverDocumentsTable.driverId, [assignedDriverId, unassignedDriverId]));
    const bonusIds = (await db.select({ id: driverBonusesTable.id }).from(driverBonusesTable).where(inArray(driverBonusesTable.driverId, driverIds))).map((bonus) => bonus.id);
    if (bonusIds.length) {
      // The production trigger makes events append-only. Integration teardown
      // temporarily disables user triggers as the database owner only.
      await database.pool.query("ALTER TABLE driver_bonus_events DISABLE TRIGGER USER");
      await db.delete(driverBonusEventsTable).where(inArray(driverBonusEventsTable.bonusId, bonusIds));
      await database.pool.query("ALTER TABLE driver_bonus_events ENABLE TRIGGER USER");
      await db.delete(driverBonusesTable).where(inArray(driverBonusesTable.id, bonusIds));
      await db.delete(adminAuditLogsTable).where(inArray(adminAuditLogsTable.entityId, bonusIds));
    }
    await db.delete(adminAuditLogsTable).where(inArray(adminAuditLogsTable.actorProfileId, profileIds));
    await db.delete(sessionsTable).where(inArray(sessionsTable.profileId, profileIds));
    await db.delete(driversTable).where(inArray(driversTable.profileId, profileIds));
    await db.delete(profilesTable).where(inArray(profilesTable.id, profileIds));
  }
  if (registeredProfileIds.length) {
    await db.delete(customerAddressesTable).where(inArray(customerAddressesTable.customerId, registeredProfileIds));
    await db.delete(profilesTable).where(inArray(profilesTable.id, registeredProfileIds));
  }
  globalThis.fetch = realFetch;
  Storage.prototype.bucket = originalStorageBucket;
  await database.pool.end();
});

test("requires authenticated Admin sessions and revokes Admin access after logout", async () => {
  const loggedOut = await request("/api/admin/dashboard");
  assert.equal(loggedOut.status, 401);
  const loggedOutAdminSession = await request("/api/auth/session?admin=true");
  assert.equal(loggedOutAdminSession.status, 401);

  const customerDenied = await request("/api/admin/dashboard", { headers: bearer(customer) });
  assert.equal(customerDenied.status, 403);
  const customerSessionPreserved = await request("/api/addresses", { headers: bearer(customer) });
  assert.equal(customerSessionPreserved.status, 200);
  const customerCookieDenied = await fetch(`${baseUrl}/api/auth/session?admin=true`, {
    headers: { cookie: `aa_session=${customer.token}` },
  });
  assert.equal(customerCookieDenied.status, 401);

  const driverDenied = await request("/api/admin/dashboard", { headers: bearer(assignedDriver) });
  assert.equal(driverDenied.status, 403);
  const driverSessionPreserved = await request("/api/driver/profile", { headers: bearer(assignedDriver) });
  assert.equal(driverSessionPreserved.status, 200);

  const customerEmail = `customer-admin-login-${runId}-${randomUUID()}@example.test`;
  const customerRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      firstName: "Customer",
      lastName: "Only",
      email: customerEmail,
      phone: "9195550188",
      password: "CustomerOnly2026!",
    }),
  });
  assert.equal(customerRegistration.status, 201);
  const registeredCustomer = await customerRegistration.json() as { profile: { id: string } };
  registeredProfileIds.push(registeredCustomer.profile.id);
  const customerAdminSignIn = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: customerEmail,
      password: "CustomerOnly2026!",
      adminSession: true,
    }),
  });
  assert.equal(customerAdminSignIn.status, 403);
  assert.equal(customerAdminSignIn.headers.get("set-cookie"), null);

  const email = `admin-login-${runId}-${randomUUID()}@example.test`;
  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      firstName: "Secure",
      lastName: "Admin",
      email,
      phone: "9195550199",
      password: "SecureAdmin2026!",
    }),
  });
  assert.equal(registration.status, 201);
  const legacyCookie = sessionCookie(registration).split(";", 1)[0];
  const registered = await registration.json() as { profile: { id: string } };
  registeredProfileIds.push(registered.profile.id);
  await db.update(profilesTable).set({ role: "admin" }).where(eq(profilesTable.id, registered.profile.id));

  const legacySessionDenied = await fetch(`${baseUrl}/api/auth/session?admin=true`, {
    headers: { cookie: legacyCookie },
  });
  assert.equal(legacySessionDenied.status, 401);
  const legacyAdminApiDenied = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { cookie: legacyCookie },
  });
  assert.equal(legacyAdminApiDenied.status, 401);

  const signIn = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "SecureAdmin2026!",
      adminSession: true,
    }),
  });
  assert.equal(signIn.status, 200);
  assert.equal((await signIn.clone().json() as { profile: { role: string } }).profile.role, "admin");
  const setCookies = sessionCookies(signIn);
  assert.equal(setCookies.some((cookie) => cookie.startsWith("aa_session=")), true);
  assert.equal(setCookies.some((cookie) => cookie.startsWith("aa_admin_session=")), true);
  const adminCookie = setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");

  const adminSession = await fetch(`${baseUrl}/api/auth/session?admin=true`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(adminSession.status, 200);

  const authorized = await fetch(`${baseUrl}/api/admin/dashboard`, { headers: { cookie: adminCookie } });
  assert.equal(authorized.status, 200);

  const logout = await fetch(`${baseUrl}/api/auth/signout`, {
    method: "POST",
    headers: {
      cookie: adminCookie,
      origin: "https://admin.anythinganywhere.com",
    },
  });
  assert.equal(logout.status, 204);

  const revokedSession = await fetch(`${baseUrl}/api/auth/session?noDemo=true`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(revokedSession.status, 401);
  const revokedAdminSession = await fetch(`${baseUrl}/api/auth/session?admin=true`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(revokedAdminSession.status, 401);

  const revokedAdminApi = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(revokedAdminApi.status, 401);
});

test("Admin customer APIs search, detail, suspend, revoke sessions, reactivate, and audit", async () => {
  const target = await createProfile("customer");
  const uniqueSearch = `UniqueSearch-${runId}`;
  await db.update(profilesTable).set({ firstName: uniqueSearch, lastName: "Customer" }).where(eq(profilesTable.id, target.id));

  assert.equal((await request("/api/admin/customers", { headers: bearer(dispatcher) })).status, 403);
  const searched = await request(`/api/admin/customers?search=${encodeURIComponent(uniqueSearch)}`, { headers: bearer(admin) });
  assert.equal(searched.status, 200);
  assert.deepEqual((searched.body as Array<{ id: string }>).map(({ id }) => id), [target.id]);
  const detail = await request(`/api/admin/customers/${target.id}`, { headers: bearer(admin) });
  assert.equal(detail.status, 200);
  assert.equal((detail.body as { customer: { id: string } }).customer.id, target.id);

  let published = false;
  const unsubscribe = subscribeToAdminUpdates((event) => { published ||= event.type === "admin.updated"; });
  const suspended = await request(`/api/admin/customers/${target.id}/status`, {
    method: "PUT", headers: bearer(admin), body: JSON.stringify({ status: "suspended", reason: "Integration test suspension" }),
  });
  unsubscribe();
  assert.equal(suspended.status, 200);
  assert.ok((suspended.body as { revokedSessionCount: number }).revokedSessionCount >= 1);
  assert.equal(published, true, "a successful Admin mutation must publish admin.updated");
  assert.equal((await request("/api/deliveries/summary", { headers: bearer(target) })).status, 401);
  assert.equal((await db.select({ status: profilesTable.status }).from(profilesTable).where(eq(profilesTable.id, target.id)))[0]?.status, "suspended");

  const reactivated = await request(`/api/admin/customers/${target.id}/status`, {
    method: "PUT", headers: bearer(admin), body: JSON.stringify({ status: "active", reason: "Integration test complete" }),
  });
  assert.equal(reactivated.status, 200);
  assert.equal((await db.select({ status: profilesTable.status }).from(profilesTable).where(eq(profilesTable.id, target.id)))[0]?.status, "active");
  const actions = (await db.select({ action: adminAuditLogsTable.action }).from(adminAuditLogsTable)
    .where(eq(adminAuditLogsTable.entityId, target.id))).map(({ action }) => action);
  assert.ok(actions.includes("customer.suspended"));
  assert.ok(actions.includes("customer.reactivated"));
});

test("Admin payments list is typed, summary is uncapped, and mocked refunds persist with audit", async () => {
  const delivery = await createAssignedDeliveryFixture();
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.deliveryId, delivery.id)).limit(1);
  assert.ok(payment);
  await db.update(paymentsTable).set({
    provider: "stripe", providerPaymentId: `pi_refund_${runId}`, status: "paid", amount: "17.50",
  }).where(eq(paymentsTable.id, payment.id));
  await db.insert(paymentsTable).values(Array.from({ length: 205 }, (_, index) => ({
    deliveryId: delivery.id, customerId: customer.id, provider: "test", status: "paid",
    amount: "1.00", currency: "usd", metadata: { fixture: runId, index },
  })));

  assert.equal((await request("/api/admin/payments", { headers: bearer(support) })).status, 403);
  const listed = await request("/api/admin/payments?status=paid", { headers: bearer(admin) });
  assert.equal(listed.status, 200);
  assert.equal((listed.body as unknown[]).length, 200);
  const typed = (listed.body as Array<{ amount: unknown; createdAt: unknown; refund: unknown }>)[0];
  assert.equal(typeof typed?.amount, "number");
  assert.equal(typeof typed?.createdAt, "string");
  assert.ok(typed && "refund" in typed);

  const allPaid = await db.select({ amount: paymentsTable.amount }).from(paymentsTable).where(eq(paymentsTable.status, "paid"));
  const summary = await request("/api/admin/payments/summary", { headers: bearer(admin) });
  assert.equal(summary.status, 200);
  assert.equal((summary.body as { paidCount: number }).paidCount, allPaid.length);
  assert.equal((summary.body as { grossPaidRevenue: number }).grossPaidRevenue, allPaid.reduce((sum, row) => sum + Number(row.amount), 0));

  process.env.STRIPE_TEST_REFUND_ID = `re_test_${runId}`;
  try {
    const refunded = await request(`/api/admin/payments/${payment.id}/refund`, {
      method: "POST", headers: bearer(admin), body: JSON.stringify({ reason: "Customer-requested test refund" }),
    });
    assert.equal(refunded.status, 202);
    assert.equal((refunded.body as { refundReference: string }).refundReference, `re_test_${runId}`);
  } finally {
    delete process.env.STRIPE_TEST_REFUND_ID;
  }
  const [operation] = await db.select().from(refundOperationsTable).where(eq(refundOperationsTable.paymentId, payment.id));
  assert.equal(operation?.status, "provider_accepted");
  assert.equal(operation?.providerRefundId, `re_test_${runId}`);
  const audits = await db.select({ action: adminAuditLogsTable.action }).from(adminAuditLogsTable).where(eq(adminAuditLogsTable.entityId, payment.id));
  assert.ok(audits.some(({ action }) => action === "payment.refund_requested"));
  assert.ok(audits.some(({ action }) => action === "payment.refund_provider_accepted"));
});

test("limits staff operations by role and audits driver document review", async () => {
  const deniedDashboard = await request("/api/admin/dashboard", { headers: bearer(customer) });
  assert.equal(deniedDashboard.status, 403);

  const deniedRefund = await request(`/api/admin/payments/${randomUUID()}/refund`, {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify({ reason: "Customer must never authorize a refund." }),
  });
  assert.equal(deniedRefund.status, 403);

  const dashboard = await request("/api/admin/dashboard", { headers: bearer(dispatcher) });
  assert.equal(dashboard.status, 200);
  assert.equal(typeof (dashboard.body as { deliveriesToday: unknown }).deliveriesToday, "number");
  assert.equal("revenue" in (dashboard.body as Record<string, unknown>), false);
  assert.equal((dashboard.body as { trend: Array<Record<string, unknown>> }).trend.every((day) => !("revenue" in day)), true);

  const dispatcherAnalytics = await request("/api/admin/analytics", { headers: bearer(dispatcher) });
  assert.equal(dispatcherAnalytics.status, 200);
  assert.equal((dispatcherAnalytics.body as { daily: Array<Record<string, unknown>> }).daily.every((day) => !("revenue" in day)), true);

  const oversizedDriverSearch = await request(`/api/admin/driver-review?search=${"x".repeat(121)}`, { headers: bearer(dispatcher) });
  assert.equal(oversizedDriverSearch.status, 400);

  const oversizedCustomerSearch = await request(`/api/admin/customers?search=${"x".repeat(121)}`, { headers: bearer(admin) });
  assert.equal(oversizedCustomerSearch.status, 400);

  const reviewList = await request("/api/admin/driver-review?status=approved", { headers: bearer(dispatcher) });
  assert.equal(reviewList.status, 200);
  assert.ok(Array.isArray(reviewList.body));
  assert.equal((reviewList.body as Array<Record<string, unknown>>).every((driver) => !("email" in driver) && !("phone" in driver) && !("licensePlate" in driver) && !("rating" in driver)), true);

  const dispatcherDriverDetail = await request(`/api/admin/drivers/${assignedDriverId}/review`, { headers: bearer(dispatcher) });
  assert.equal(dispatcherDriverDetail.status, 200);
  assert.equal("documents" in (dispatcherDriverDetail.body as Record<string, unknown>), false);
  assert.equal("earnings" in (dispatcherDriverDetail.body as Record<string, unknown>), false);
  assert.equal("application" in (dispatcherDriverDetail.body as Record<string, unknown>), false);
  assert.equal("rating" in ((dispatcherDriverDetail.body as { driver: Record<string, unknown> }).driver), false);

  const [document] = await db
    .insert(driverDocumentsTable)
    .values({
      driverId: unassignedDriverId,
      documentType: "license",
      storagePath: `/objects/private/test/${runId}/license.pdf`,
      verificationStatus: "pending",
    })
    .returning();

  const forbiddenReview = await request(`/api/admin/driver-documents/${document.id}/review`, {
    method: "POST",
    headers: bearer(dispatcher),
    body: JSON.stringify({ decision: "approved" }),
  });
  assert.equal(forbiddenReview.status, 403);

  const overlyLongDecision = await request(`/api/admin/drivers/${assignedDriverId}/decision`, {
    method: "POST",
    headers: bearer(admin),
    body: JSON.stringify({ decision: "approved", reason: `${"x".repeat(500)} ` }),
  });
  assert.equal(overlyLongDecision.status, 400);

  const approvedReview = await request(`/api/admin/driver-documents/${document.id}/review`, {
    method: "POST",
    headers: bearer(admin),
    body: JSON.stringify({ decision: "approved" }),
  });
  assert.equal(approvedReview.status, 200);
  assert.equal((approvedReview.body as { verificationStatus: string }).verificationStatus, "approved");

  const audits = await db
    .select({ action: adminAuditLogsTable.action })
    .from(adminAuditLogsTable)
    .where(eq(adminAuditLogsTable.entityId, document.id));
  assert.equal(audits.some((entry) => entry.action === "driver_document.approved"), true);
});

test("projects and safely resolves, progresses, and reopens staff support tickets", async () => {
  const ticketResponse = await request("/api/support/tickets", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify({ category: "delivery_issue", message: "Please confirm the pickup window." }),
  });
  assert.equal(ticketResponse.status, 201);
  const ticketId = (ticketResponse.body as { id: string }).id;
  const linkedDelivery = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(linkedDelivery.status, 201);
  const linkedPublicDeliveryId = (linkedDelivery.body as { id: string }).id;
  const [linkedDeliveryRecord] = await db
    .select({ id: deliveriesTable.id, orderNumber: deliveriesTable.orderNumber })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, linkedPublicDeliveryId))
    .limit(1);
  assert.ok(linkedDeliveryRecord);
  fixtureDeliveryIds.push(linkedDeliveryRecord.id);
  await db.update(supportTicketsTable)
    .set({ deliveryId: linkedDeliveryRecord.id })
    .where(eq(supportTicketsTable.id, ticketId));

  const suspendedSupport = await createProfile("support");
  await db.update(profilesTable).set({ status: "suspended" }).where(eq(profilesTable.id, suspendedSupport.id));
  const inactiveAssignment = await request(`/api/admin/support/tickets/${ticketId}`, {
    method: "PATCH",
    headers: bearer(admin),
    body: JSON.stringify({ assignedProfileId: suspendedSupport.id }),
  });
  assert.equal(inactiveAssignment.status, 400);

  const unresolved = await request(`/api/admin/support/tickets/${ticketId}`, {
    method: "PATCH",
    headers: bearer(admin),
    body: JSON.stringify({ status: "resolved", priority: "urgent" }),
  });
  assert.equal(unresolved.status, 400);

  const updateResponse = await request(`/api/admin/support/tickets/${ticketId}`, {
    method: "PATCH",
    headers: bearer(admin),
    body: JSON.stringify({ status: "resolved", priority: "urgent", resolution: "  Dispatch   review requested.  " }),
  });
  assert.equal(updateResponse.status, 200);
  const resolved = updateResponse.body as {
    status: string; resolution: string; resolvedAt: string | null; resolvedBy: { id: string } | null;
    requester: { name: string; email: string | null; phone: string | null; role: string };
  };
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolution, "Dispatch review requested.");
  assert.ok(resolved.resolvedAt);
  assert.equal(resolved.resolvedBy?.id, admin.id);
  assert.equal(resolved.requester.role, "customer");
  assert.equal(resolved.requester.name, "Test customer Delivery");
  const auditCountBeforeRetry = (await db.select().from(adminAuditLogsTable).where(eq(adminAuditLogsTable.entityId, ticketId))).length;
  const duplicateResolve = await request(`/api/admin/support/tickets/${ticketId}`, {
    method: "PATCH", headers: bearer(admin),
    body: JSON.stringify({ status: "resolved", resolution: "Dispatch review requested." }),
  });
  assert.equal(duplicateResolve.status, 200);
  assert.equal((duplicateResolve.body as { resolvedAt: string }).resolvedAt, resolved.resolvedAt);
  assert.equal((await db.select().from(adminAuditLogsTable).where(eq(adminAuditLogsTable.entityId, ticketId))).length, auditCountBeforeRetry);

  const invalidReopen = await request(`/api/admin/support/tickets/${ticketId}`, {
    method: "PATCH", headers: bearer(support), body: JSON.stringify({ status: "in_progress", resolution: "must be omitted" }),
  });
  assert.equal(invalidReopen.status, 400);

  const reopened = await request(`/api/admin/support/tickets/${ticketId}`, {
    method: "PATCH",
    headers: bearer(support),
    body: JSON.stringify({ status: "in_progress" }),
  });
  assert.equal(reopened.status, 200);
  const reopenedBody = reopened.body as { status: string; resolution: string | null; resolvedAt: string | null; resolvedBy: unknown };
  assert.equal(reopenedBody.status, "in_progress");
  assert.equal(reopenedBody.resolution, null);
  assert.equal(reopenedBody.resolvedAt, null);
  assert.equal(reopenedBody.resolvedBy, null);

  const driverIssue = await request("/api/driver/issues", {
    method: "POST", headers: bearer(assignedDriver),
    body: JSON.stringify({ category: "delivery_issue", message: "Driver needs dispatch assistance." }),
  });
  assert.equal(driverIssue.status, 201);
  const driverIssueId = (driverIssue.body as { id: string }).id;
  const resolvedDriverIssue = await request(`/api/admin/support/tickets/${driverIssueId}`, {
    method: "PATCH", headers: bearer(admin),
    body: JSON.stringify({ source: "driver_issue", status: "resolved", resolution: "Dispatch contacted the driver." }),
  });
  assert.equal(resolvedDriverIssue.status, 200);
  assert.equal((resolvedDriverIssue.body as { source: string; requester: { role: string } }).source, "driver_issue");
  assert.equal((resolvedDriverIssue.body as { requester: { role: string } }).requester.role, "driver");
  const driverAuditCount = (await db.select().from(adminAuditLogsTable).where(eq(adminAuditLogsTable.entityId, driverIssueId))).length;
  const duplicateDriverResolve = await request(`/api/admin/support/tickets/${driverIssueId}`, {
    method: "PATCH", headers: bearer(admin),
    body: JSON.stringify({ source: "driver_issue", status: "resolved", resolution: "Dispatch contacted the driver." }),
  });
  assert.equal(duplicateDriverResolve.status, 200);
  assert.equal((duplicateDriverResolve.body as { resolvedAt: string }).resolvedAt, (resolvedDriverIssue.body as { resolvedAt: string }).resolvedAt);
  assert.equal((await db.select().from(adminAuditLogsTable).where(eq(adminAuditLogsTable.entityId, driverIssueId))).length, driverAuditCount);
  const reopenedDriverIssue = await request(`/api/admin/support/tickets/${driverIssueId}`, {
    method: "PATCH", headers: bearer(support), body: JSON.stringify({ source: "driver_issue", status: "open" }),
  });
  assert.equal(reopenedDriverIssue.status, 200);
  assert.equal((reopenedDriverIssue.body as { status: string; resolution: string | null }).status, "open");
  assert.equal((reopenedDriverIssue.body as { resolution: string | null }).resolution, null);

  assert.equal((await request("/api/admin/support/tickets", { headers: bearer(customer) })).status, 403);
  assert.equal((await request("/api/admin/support/tickets", { headers: bearer(dispatcher) })).status, 403);

  const overlyLongResolution = await request(`/api/admin/support/tickets/${ticketId}`, {
    method: "PATCH",
    headers: bearer(admin),
    body: JSON.stringify({ status: "resolved", resolution: `${"x".repeat(2_000)} ` }),
  });
  assert.equal(overlyLongResolution.status, 400);

  const commentResponse = await request(`/api/admin/support/tickets/${ticketId}/comments/customer_ticket`, {
    method: "POST",
    headers: bearer(admin),
    body: JSON.stringify({ source: "customer_ticket", body: "Escalated to the delivery desk." }),
  });
  assert.equal(commentResponse.status, 201);

  const overlyLongComment = await request(`/api/admin/support/tickets/${ticketId}/comments/customer_ticket`, {
    method: "POST",
    headers: bearer(admin),
    body: JSON.stringify({ source: "customer_ticket", body: `${"x".repeat(2_000)} ` }),
  });
  assert.equal(overlyLongComment.status, 400);

  const agentsResponse = await request("/api/admin/support/agents", { headers: bearer(admin) });
  assert.equal(agentsResponse.status, 200);
  assert.equal((agentsResponse.body as Array<{ id: string }>).some((agent) => agent.id === admin.id), true);

  const commentsResponse = await request(`/api/admin/support/tickets/${ticketId}/comments/customer_ticket`, { headers: bearer(admin) });
  assert.equal(commentsResponse.status, 200);
  assert.equal((commentsResponse.body as Array<{ body: string }>).some((comment) => comment.body === "Escalated to the delivery desk."), true);

  const ticketsResponse = await request("/api/admin/support/tickets?priority=urgent", { headers: bearer(admin) });
  assert.equal(ticketsResponse.status, 200);
  const listed = (ticketsResponse.body as Array<{
    id: string; reference: string; requester: { name: string; email: string | null; phone: string | null };
    deliveryId: string | null; orderNumber: string | null;
  }>).find((ticket) => ticket.id === ticketId);
  assert.ok(listed);
  assert.equal(listed.reference, ticketId);
  assert.equal(listed.requester.name, "Test customer Delivery");
  assert.equal(listed.deliveryId, linkedPublicDeliveryId);
  assert.equal(listed.orderNumber, linkedDeliveryRecord.orderNumber);
  const audits = await db.select().from(adminAuditLogsTable).where(eq(adminAuditLogsTable.entityId, ticketId));
  assert.equal(audits.some((entry) => entry.action === "support_ticket.updated"), true);
});

test("support assignment and conversations work for both sources with requester ownership", async () => {
  const customerTicket = await request("/api/support/tickets", {
    method: "POST", headers: bearer(customer),
    body: JSON.stringify({ category: "delivery_issue", message: "Customer conversation origin." }),
  });
  assert.equal(customerTicket.status, 201);
  const customerTicketId = (customerTicket.body as { id: string }).id;
  const driverIssue = await request("/api/driver/issues", {
    method: "POST", headers: bearer(assignedDriver),
    body: JSON.stringify({ category: "delivery_issue", message: "Driver conversation origin." }),
  });
  assert.equal(driverIssue.status, 201);
  const driverIssueId = (driverIssue.body as { id: string }).id;

  for (const { id, source } of [
    { id: customerTicketId, source: "customer_ticket" },
    { id: driverIssueId, source: "driver_issue" },
  ] as const) {
    const assigned = await request(`/api/admin/support/tickets/${id}`, {
      method: "PATCH", headers: bearer(admin), body: JSON.stringify({ source, assignedProfileId: support.id }),
    });
    assert.equal(assigned.status, 200);
    assert.equal((assigned.body as { assignedProfileId: string; assignee: { id: string } }).assignedProfileId, support.id);
    assert.equal((assigned.body as { assignee: { id: string } }).assignee.id, support.id);
  }
  const assignedQueue = await request("/api/admin/support/tickets", { headers: bearer(admin) });
  assert.equal(assignedQueue.status, 200);
  for (const id of [customerTicketId, driverIssueId]) {
    const row = (assignedQueue.body as Array<{ id: string; assignedProfileId: string | null; assignee: { id: string } | null }>).find((ticket) => ticket.id === id);
    assert.equal(row?.assignedProfileId, support.id);
    assert.equal(row?.assignee?.id, support.id);
  }

  const notificationCountBefore = Number((await db.select({ value: count() }).from(notificationsTable)
    .where(inArray(notificationsTable.profileId, [customer.id, assignedDriver.id])))[0]?.value ?? 0);
  const customerStaffReply = await request(`/api/admin/support/tickets/${customerTicketId}/comments/customer_ticket`, {
    method: "POST", headers: bearer(admin),
    body: JSON.stringify({ source: "customer_ticket", body: "Customer support response.", clientRequestId: randomUUID() }),
  });
  assert.equal(customerStaffReply.status, 201);
  const driverStaffReply = await request(`/api/admin/support/tickets/${driverIssueId}/comments/driver_issue`, {
    method: "POST", headers: bearer(admin),
    body: JSON.stringify({ source: "driver_issue", body: "Driver support response.", clientRequestId: randomUUID() }),
  });
  assert.equal(driverStaffReply.status, 201);

  // Lists are database-backed (not process-local conversation state), scoped to
  // the requester, and expose no staff assignment or audit fields.
  const customerTickets = await request("/api/support/tickets", { headers: bearer(customer) });
  assert.equal(customerTickets.status, 200);
  const customerTicketListItem = (customerTickets.body as Array<{
    id: string; source: string; lastConversationPreview: { body: string; authorRole: string } | null; hasSupportReply: boolean;
  }>).find((ticket) => ticket.id === customerTicketId);
  assert.equal(customerTicketListItem?.source, "customer_ticket");
  assert.equal(customerTicketListItem?.lastConversationPreview?.body, "Customer support response.");
  assert.equal(customerTicketListItem?.lastConversationPreview?.authorRole, "staff");
  assert.equal(customerTicketListItem?.hasSupportReply, true);
  assert.equal(((await request("/api/support/tickets", { headers: bearer(otherCustomer) })).body as Array<{ id: string }>)
    .some((ticket) => ticket.id === customerTicketId), false);
  const driverIssues = await request("/api/driver/issues", { headers: bearer(assignedDriver) });
  assert.equal(driverIssues.status, 200);
  assert.equal((driverIssues.body as Array<{ id: string; source: string; hasSupportReply: boolean }>)
    .some((issue) => issue.id === driverIssueId && issue.source === "driver_issue" && issue.hasSupportReply), true);
  assert.equal(((await request("/api/driver/issues", { headers: bearer(unassignedDriver) })).body as Array<{ id: string }>)
    .some((issue) => issue.id === driverIssueId), false);

  const customerNotifications = await request("/api/notifications", { headers: bearer(customer) });
  assert.equal(customerNotifications.status, 200);
  assert.equal((customerNotifications.body as Array<{ type: string; supportSource: string | null; supportId: string | null }>)
    .some((notification) => notification.type === "support_reply" && notification.supportSource === "customer_ticket" && notification.supportId === customerTicketId), true);
  const driverNotifications = await request("/api/notifications", { headers: bearer(assignedDriver) });
  assert.equal(driverNotifications.status, 200);
  assert.equal((driverNotifications.body as Array<{ type: string; supportSource: string | null; supportId: string | null }>)
    .some((notification) => notification.type === "support_reply" && notification.supportSource === "driver_issue" && notification.supportId === driverIssueId), true);

  const customerConversation = await request(`/api/support/tickets/${customerTicketId}/conversation`, { headers: bearer(customer) });
  assert.equal(customerConversation.status, 200);
  assert.deepEqual((customerConversation.body as Array<{ body: string }>).map(({ body }) => body), [
    "Customer conversation origin.", "Customer support response.",
  ]);
  assert.equal((await request(`/api/support/tickets/${customerTicketId}/conversation`, { headers: bearer(otherCustomer) })).status, 404);
  const customerReplyId = randomUUID();
  const customerReply = await request(`/api/support/tickets/${customerTicketId}/conversation`, {
    method: "POST", headers: bearer(customer),
    body: JSON.stringify({ body: "Customer owner follow-up.", clientRequestId: customerReplyId }),
  });
  assert.equal(customerReply.status, 201);
  const customerReplyRetry = await request(`/api/support/tickets/${customerTicketId}/conversation`, {
    method: "POST", headers: bearer(customer),
    body: JSON.stringify({ body: "Customer owner follow-up.", clientRequestId: customerReplyId }),
  });
  assert.equal(customerReplyRetry.status, 200);
  assert.equal((customerReplyRetry.body as { idempotent: boolean }).idempotent, true);

  const driverConversation = await request(`/api/driver/issues/${driverIssueId}/conversation`, { headers: bearer(assignedDriver) });
  assert.equal(driverConversation.status, 200);
  assert.deepEqual((driverConversation.body as Array<{ body: string }>).map(({ body }) => body), [
    "Driver conversation origin.", "Driver support response.",
  ]);
  assert.equal((await request(`/api/driver/issues/${driverIssueId}/conversation`, { headers: bearer(unassignedDriver) })).status, 404);
  const driverReply = await request(`/api/driver/issues/${driverIssueId}/conversation`, {
    method: "POST", headers: bearer(assignedDriver), body: JSON.stringify({ body: "Driver owner follow-up." }),
  });
  assert.equal(driverReply.status, 201);

  const notificationCountAfter = Number((await db.select({ value: count() }).from(notificationsTable)
    .where(inArray(notificationsTable.profileId, [customer.id, assignedDriver.id])))[0]?.value ?? 0);
  assert.equal(notificationCountAfter, notificationCountBefore + 2);
  const requesterEntries = await db.select().from(supportConversationEntriesTable)
    .where(or(
      eq(supportConversationEntriesTable.supportTicketId, customerTicketId),
      eq(supportConversationEntriesTable.driverIncidentId, driverIssueId),
    ));
  assert.equal(requesterEntries.every((entry) => entry.visibility === "requester"), true);

  for (const { id, source } of [
    { id: customerTicketId, source: "customer_ticket" },
    { id: driverIssueId, source: "driver_issue" },
  ] as const) {
    const unassigned = await request(`/api/admin/support/tickets/${id}`, {
      method: "PATCH", headers: bearer(admin), body: JSON.stringify({ source, assignedProfileId: null }),
    });
    assert.equal(unassigned.status, 200);
    assert.equal((unassigned.body as { assignedProfileId: null }).assignedProfileId, null);
    assert.equal((unassigned.body as { assignee: null }).assignee, null);
  }
});

test("rejects cookie-authenticated writes from an unapproved production origin", async () => {
  const response = await request("/api/deliveries", {
    method: "POST",
    headers: {
      cookie: `aa_session=${customer.token}`,
      origin: "https://unapproved.example.test",
    },
    body: JSON.stringify(deliveryBody),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    error: "Cookie-authenticated requests require an approved origin.",
  });
});

test("rejects delivery creation without prohibited-items confirmation", async () => {
  const response = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify({ ...deliveryBody, prohibitedItemsConfirmed: false }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    error: "Please confirm that your package does not contain prohibited items before continuing.",
  });
});

test("rejects cash and non-Stripe payment selectors before creating a delivery", async () => {
  const beforeCount = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.customerId, customer.id));

  for (const paymentSelector of [
    { paymentMethod: "cash" },
    { payment_method: "cash_on_delivery" },
    { provider: "cod" },
    { provider: "card" },
    { provider: "paypal" },
  ]) {
    const response = await request("/api/deliveries", {
      method: "POST",
      headers: bearer(customer),
      body: JSON.stringify({ ...deliveryBody, ...paymentSelector }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: "Cash and other offline payment methods are not available. Please use Stripe card checkout.",
    });
  }

  const afterCount = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.customerId, customer.id));
  assert.equal(afterCount.length, beforeCount.length);
});

test("creates a Stripe payment intent without storing card data and prevents customer-to-customer access", async () => {
  const createResponse = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });

  assert.equal(createResponse.status, 201);
  const created = createResponse.body as {
    id: string;
    status: string;
    prohibitedItemsConfirmed: boolean;
    prohibitedItemsConfirmedAt: string;
    prohibitedItemsPolicyVersion: string;
    payment: { provider: string; paymentIntentId: string; clientSecret: string };
  };
  assert.equal(created.status, "payment_pending");
  assert.equal(created.prohibitedItemsConfirmed, true);
  assert.ok(created.prohibitedItemsConfirmedAt);
  assert.equal(created.prohibitedItemsPolicyVersion, "v1");
  assert.equal(created.payment.provider, "stripe");
  assert.match(created.payment.paymentIntentId, /^pi_test_/);
  assert.match(created.payment.clientSecret, /_secret_mock$/);
  createdDeliveryId = created.id;
  createdPaymentIntentId = created.payment.paymentIntentId;

  const [record] = await db
    .select({
      id: deliveriesTable.id,
      paymentStatus: deliveriesTable.paymentStatus,
      deliveryStatus: deliveriesTable.deliveryStatus,
      prohibitedItemsConfirmed: deliveriesTable.prohibitedItemsConfirmed,
      prohibitedItemsConfirmedAt: deliveriesTable.prohibitedItemsConfirmedAt,
      prohibitedItemsPolicyVersion: deliveriesTable.prohibitedItemsPolicyVersion,
    })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, createdDeliveryId))
    .limit(1);
  assert.ok(record);
  fixtureDeliveryIds.push(record.id);
  assert.equal(record.paymentStatus, "pending");
  assert.equal(record.deliveryStatus, "payment_pending");
  assert.equal(record.prohibitedItemsConfirmed, true);
  assert.ok(record.prohibitedItemsConfirmedAt);
  assert.equal(record.prohibitedItemsPolicyVersion, "v1");

  const [payment] = await db
    .select({
      status: paymentsTable.status,
      customerId: paymentsTable.customerId,
      provider: paymentsTable.provider,
      providerPaymentId: paymentsTable.providerPaymentId,
      metadata: paymentsTable.metadata,
    })
    .from(paymentsTable)
    .where(eq(paymentsTable.deliveryId, record.id))
    .limit(1);
  assert.equal(payment?.status, "pending");
  assert.equal(payment?.customerId, customer.id);
  assert.equal(payment?.provider, "stripe");
  assert.equal(payment?.providerPaymentId, createdPaymentIntentId);
  assert.equal("cardNumber" in (payment?.metadata ?? {}), false);

  const detailResponse = await request(`/api/deliveries/${createdDeliveryId}`, {
    headers: bearer(otherCustomer),
  });
  assert.equal(detailResponse.status, 404);

  const listResponse = await request("/api/deliveries", { headers: bearer(otherCustomer) });
  assert.equal(listResponse.status, 200);
  assert.ok(Array.isArray(listResponse.body));
  assert.equal(listResponse.body.some((delivery) => (delivery as { id: string }).id === createdDeliveryId), false);
});

test("keeps historical cash payment records readable", async () => {
  const [delivery] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, createdDeliveryId))
    .limit(1);
  assert.ok(delivery);
  const [payment] = await db
    .select({ id: paymentsTable.id })
    .from(paymentsTable)
    .where(eq(paymentsTable.deliveryId, delivery.id))
    .limit(1);
  assert.ok(payment);

  await db.update(paymentsTable).set({
    provider: "cash",
    providerPaymentId: null,
    status: "paid",
  }).where(eq(paymentsTable.id, payment.id));
  try {
    const detailResponse = await request(`/api/deliveries/${createdDeliveryId}`, {
      headers: bearer(customer),
    });
    assert.equal(detailResponse.status, 200);
    assert.equal((detailResponse.body as { id: string }).id, createdDeliveryId);

    const listResponse = await request("/api/deliveries", { headers: bearer(customer) });
    assert.equal(listResponse.status, 200);
    assert.ok((listResponse.body as Array<{ id: string }>).some((delivery) => delivery.id === createdDeliveryId));
  } finally {
    await db.update(paymentsTable).set({
      provider: "stripe",
      providerPaymentId: createdPaymentIntentId,
      status: "pending",
    }).where(eq(paymentsTable.id, payment.id));
  }
});

test("exports a filtered admin-only CSV report without spreadsheet formula injection", async () => {
  const reportDate = new Date().toISOString().slice(0, 10);
  const promotionCode = `=EXPORT-${randomUUID().slice(0, 8)}`;
  const outOfRangePromotionCode = `OUTSIDE-${randomUUID().slice(0, 8)}`;
  const [promotion] = await db.insert(promoCodesTable).values({
    code: promotionCode,
    discountType: "percent",
    discountValue: "15",
    redemptionCount: "2",
    active: "true",
  }).returning();
  fixturePromotionIds.push(promotion.id);
  const [outOfRangePromotion] = await db.insert(promoCodesTable).values({
    code: outOfRangePromotionCode,
    discountType: "percent",
    discountValue: "10",
    redemptionCount: "99",
    active: "true",
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    updatedAt: new Date("2020-01-01T00:00:00.000Z"),
  }).returning();
  fixturePromotionIds.push(outOfRangePromotion.id);
  const [reportDelivery] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, createdDeliveryId))
    .limit(1);
  assert.ok(reportDelivery);
  await recordPromotionRedemption({
    promotionCode,
    savingsAmount: 7.5,
    deliveryId: reportDelivery.id,
    redeemedAt: new Date(`${reportDate}T12:00:00.000Z`),
  });
  const outOfRangeCheckout = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(outOfRangeCheckout.status, 201);
  const [outOfRangeDelivery] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, (outOfRangeCheckout.body as { id: string }).id))
    .limit(1);
  assert.ok(outOfRangeDelivery);
  fixtureDeliveryIds.push(outOfRangeDelivery.id);
  await recordPromotionRedemption({
    promotionCode: outOfRangePromotionCode,
    savingsAmount: 10,
    deliveryId: outOfRangeDelivery.id,
    redeemedAt: new Date("2020-01-01T12:00:00.000Z"),
  });
  const forbidden = await fetch(`${baseUrl}/api/admin/analytics/export?startDate=${reportDate}&endDate=${reportDate}`, {
    headers: bearer(dispatcher),
  });
  assert.equal(forbidden.status, 403);

  const invalidRange = await request("/api/admin/analytics/export?startDate=not-a-date&endDate=2026-08-21", {
    headers: bearer(admin),
  });
  assert.equal(invalidRange.status, 400);
  const invalidCalendarDate = await request("/api/admin/analytics/export?startDate=2026-02-30&endDate=2026-03-01", {
    headers: bearer(admin),
  });
  assert.equal(invalidCalendarDate.status, 400);

  const report = await fetch(`${baseUrl}/api/admin/analytics/export?startDate=${reportDate}&endDate=${reportDate}`, {
    headers: bearer(admin),
  });
  assert.equal(report.status, 200);
  assert.match(report.headers.get("content-type") ?? "", /^text\/csv/);
  assert.match(report.headers.get("content-disposition") ?? "", /analytics-/);
  const csv = await report.text();
  assert.match(csv, /^report_type,date,metric,status,identifier,count,amount,currency,discount_type,discount_value,redemptions/m);
  assert.match(csv, new RegExp(`delivery,${reportDate},deliveries`));
  assert.match(csv, new RegExp(`payment,${reportDate},payments,pending`));
  assert.match(csv, new RegExp(`promotion,${reportDate},redemptions_period,,'${promotionCode},,7\\.50,usd,,,1`));
  assert.equal(csv.includes(outOfRangePromotionCode), false);
});

test("returns the original checkout when a customer retries the same idempotency key", async () => {
  const headers = new Headers(bearer(customer));
  headers.set("idempotency-key", randomUUID());
  const first = await request("/api/deliveries", { method: "POST", headers, body: JSON.stringify(deliveryBody) });
  const second = await request("/api/deliveries", { method: "POST", headers, body: JSON.stringify(deliveryBody) });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstCheckout = first.body as { id: string; payment: { paymentIntentId: string } };
  const secondCheckout = second.body as { id: string; payment: { paymentIntentId: string } };
  assert.deepEqual(secondCheckout, firstCheckout);
  const [record] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, firstCheckout.id))
    .limit(1);
  assert.ok(record);
  fixtureDeliveryIds.push(record.id);
});

test("does not create a quote with fallback coordinates when Maps verification is unavailable", async () => {
  googleMapsAvailable = false;
  try {
    const response = await request("/api/deliveries/quote", {
      method: "POST",
      headers: bearer(customer),
      body: JSON.stringify(deliveryBody),
    });
    assert.equal(response.status, 503);
    assert.match((response.body as { error: string }).error, /address verification is temporarily unavailable/i);
  } finally {
    googleMapsAvailable = true;
  }
});

test("resolves simultaneous checkout requests with one key to one persisted checkout", async () => {
  const promotionCode = `RACE-KEY-${randomUUID().slice(0, 8)}`;
  const [promotion] = await db.insert(promoCodesTable).values({
    code: promotionCode,
    discountType: "fixed",
    discountValue: "5",
    maxRedemptions: "1",
    redemptionCount: "0",
    active: "true",
  }).returning();
  fixturePromotionIds.push(promotion.id);

  const quote = await request("/api/deliveries/quote", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(quote.status, 200);
  const checkoutBody = {
    ...deliveryBody,
    quoteId: (quote.body as { id: string }).id,
    promotionCode,
  };
  const checkoutKey = randomUUID();
  const checkoutHeaders = () => {
    const headers = new Headers(bearer(customer));
    headers.set("idempotency-key", checkoutKey);
    return headers;
  };

  const [first, second] = await Promise.all([
    request("/api/deliveries", { method: "POST", headers: checkoutHeaders(), body: JSON.stringify(checkoutBody) }),
    request("/api/deliveries", { method: "POST", headers: checkoutHeaders(), body: JSON.stringify(checkoutBody) }),
  ]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.deepEqual(second.body, first.body);

  const publicDeliveryId = (first.body as { id: string }).id;
  const [delivery] = await db
    .select({ id: deliveriesTable.id, paymentStatus: deliveriesTable.paymentStatus, deliveryStatus: deliveriesTable.deliveryStatus })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, publicDeliveryId))
    .limit(1);
  assert.ok(delivery);
  fixtureDeliveryIds.push(delivery.id);
  const payments = await db
    .select({ id: paymentsTable.id, status: paymentsTable.status, amount: paymentsTable.amount })
    .from(paymentsTable)
    .where(eq(paymentsTable.deliveryId, delivery.id));
  const redemptions = await db
    .select({ id: promotionRedemptionsTable.id, deliveryId: promotionRedemptionsTable.deliveryId })
    .from(promotionRedemptionsTable)
    .where(eq(promotionRedemptionsTable.promotionId, promotion.id));
  const [storedPromotion] = await db
    .select({ redemptionCount: promoCodesTable.redemptionCount })
    .from(promoCodesTable)
    .where(eq(promoCodesTable.id, promotion.id))
    .limit(1);

  assert.equal(delivery.paymentStatus, "pending");
  assert.equal(delivery.deliveryStatus, "payment_pending");
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.status, "pending");
  assert.equal(payments[0]?.amount, (first.body as { total: number }).total.toFixed(2));
  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0]?.deliveryId, delivery.id);
  assert.equal(storedPromotion?.redemptionCount, "1");
});

test("allows only one simultaneous checkout to redeem a one-use promotion", async () => {
  const promotionCode = `RACE-CAP-${randomUUID().slice(0, 8)}`;
  const [promotion] = await db.insert(promoCodesTable).values({
    code: promotionCode,
    discountType: "percent",
    discountValue: "25",
    maxRedemptions: "1",
    redemptionCount: "0",
    active: "true",
  }).returning();
  fixturePromotionIds.push(promotion.id);

  const quote = await request("/api/deliveries/quote", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(quote.status, 200);
  const checkoutBody = JSON.stringify({
    ...deliveryBody,
    quoteId: (quote.body as { id: string }).id,
    promotionCode,
  });
  const makeHeaders = () => {
    const headers = new Headers(bearer(customer));
    headers.set("idempotency-key", randomUUID());
    return headers;
  };

  const results = await Promise.all([
    request("/api/deliveries", { method: "POST", headers: makeHeaders(), body: checkoutBody }),
    request("/api/deliveries", { method: "POST", headers: makeHeaders(), body: checkoutBody }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort((a, b) => a - b), [201, 502]);

  const successfulCheckout = results.find((result) => result.status === 201);
  assert.ok(successfulCheckout);
  const publicDeliveryId = (successfulCheckout.body as { id: string }).id;
  const [delivery] = await db
    .select({ id: deliveriesTable.id, paymentStatus: deliveriesTable.paymentStatus, deliveryStatus: deliveriesTable.deliveryStatus })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, publicDeliveryId))
    .limit(1);
  assert.ok(delivery);
  fixtureDeliveryIds.push(delivery.id);
  const payments = await db
    .select({ id: paymentsTable.id, deliveryId: paymentsTable.deliveryId })
    .from(paymentsTable)
    .where(eq(paymentsTable.deliveryId, delivery.id));
  const redemptions = await db
    .select({ id: promotionRedemptionsTable.id, deliveryId: promotionRedemptionsTable.deliveryId })
    .from(promotionRedemptionsTable)
    .where(eq(promotionRedemptionsTable.promotionId, promotion.id));
  const [storedPromotion] = await db
    .select({ redemptionCount: promoCodesTable.redemptionCount })
    .from(promoCodesTable)
    .where(eq(promoCodesTable.id, promotion.id))
    .limit(1);

  assert.equal(delivery.paymentStatus, "pending");
  assert.equal(delivery.deliveryStatus, "payment_pending");
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.deliveryId, delivery.id);
  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0]?.deliveryId, delivery.id);
  assert.equal(storedPromotion?.redemptionCount, "1");
});

test("exposes only the publishable Stripe checkout configuration", async () => {
  const response = await request("/api/payments/stripe-config", { headers: bearer(customer) });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { publishableKey: "pk_test_mock" });
});

test("rejects Stripe webhook payloads with an invalid signature", async () => {
  const response = await request("/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=0,v1=not-a-valid-signature" },
    body: JSON.stringify({ id: "evt_untrusted", type: "payment_intent.succeeded", data: { object: {} } }),
  });
  assert.equal(response.status, 400);
  assert.match((response.body as { error: string }).error, /verification failed/i);
});

test("returns a retryable response when verified webhook processing cannot match a payment", async () => {
  const payload = JSON.stringify({
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_unmatched_verified_event", status: "succeeded" } },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_mock" });
  const response = await request("/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
  assert.equal(response.status, 500);
  assert.match((response.body as { error: string }).error, /will retry/i);
});

test("uses verified Stripe events for payment state and audits duplicate delivery", async () => {
  const dispatcherDeliveryRead = await request(`/api/deliveries/${createdDeliveryId}`, { headers: bearer(dispatcher) });
  assert.equal(dispatcherDeliveryRead.status, 403);

  const invalidResponse = await request(`/api/admin/deliveries/${createdDeliveryId}/status`, {
    method: "POST",
    headers: bearer(dispatcher),
    body: JSON.stringify({ status: "delivered", reason: "skip payment and delivery" }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.match((invalidResponse.body as { error: string }).error, /recipient verification is required/i);

  const paidResponse = await request(`/api/admin/deliveries/${createdDeliveryId}/status`, {
    method: "POST",
    headers: bearer(dispatcher),
    body: JSON.stringify({ status: "paid", reason: "provider payment verified" }),
  });
  assert.equal(paidResponse.status, 403);
  assert.match((paidResponse.body as { error: string }).error, /payment provider/i);

  const event = {
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    type: "payment_intent.succeeded",
    data: { object: { id: createdPaymentIntentId, status: "succeeded" } },
  } as any;
  assert.deepEqual(await processVerifiedStripeEvent(event), { disposition: "processed", action: "succeeded" });
  assert.deepEqual(await processVerifiedStripeEvent(event), { disposition: "duplicate" });

  const [delivery] = await db
    .select({
      paymentStatus: deliveriesTable.paymentStatus,
      deliveryStatus: deliveriesTable.deliveryStatus,
    })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, createdDeliveryId))
    .limit(1);
  assert.deepEqual(delivery, { paymentStatus: "paid", deliveryStatus: "searching_driver" });

  const [payment] = await db
    .select({ id: paymentsTable.id, status: paymentsTable.status })
    .from(paymentsTable)
    .where(eq(paymentsTable.providerPaymentId, createdPaymentIntentId))
    .limit(1);
  assert.deepEqual(payment && { status: payment.status }, { status: "paid" });
  const paymentAudits = await db
    .select({ action: adminAuditLogsTable.action })
    .from(adminAuditLogsTable)
    .where(eq(adminAuditLogsTable.entityId, payment!.id));
  assert.equal(paymentAudits.some((audit) => audit.action === "payment.succeeded"), true);
  assert.equal(paymentAudits.some((audit) => audit.action === "payment.webhook_duplicate"), true);

  const prematureAssignment = await request(`/api/admin/deliveries/${createdDeliveryId}/status`, {
    method: "POST",
    headers: bearer(dispatcher),
    body: JSON.stringify({ status: "driver_assigned", reason: "assignment without driver" }),
  });
  assert.equal(prematureAssignment.status, 400);
  assert.match((prematureAssignment.body as { error: string }).error, /assign a driver/i);
});

test("audits failed and refunded Stripe payment events", async () => {
  const failedCheckout = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(failedCheckout.status, 201);
  const failed = failedCheckout.body as { id: string; payment: { paymentIntentId: string } };
  const [failedRecord] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, failed.id))
    .limit(1);
  assert.ok(failedRecord);
  fixtureDeliveryIds.push(failedRecord.id);
  assert.deepEqual(
    await processVerifiedStripeEvent({
      id: `evt_${randomUUID().replaceAll("-", "")}`,
      type: "payment_intent.canceled",
      data: { object: { id: failed.payment.paymentIntentId, status: "canceled" } },
    } as any),
    { disposition: "processed", action: "failed" },
  );
  const [failedStatus] = await db
    .select({ paymentStatus: deliveriesTable.paymentStatus, deliveryStatus: deliveriesTable.deliveryStatus })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, failedRecord.id))
    .limit(1);
  assert.deepEqual(failedStatus, { paymentStatus: "failed", deliveryStatus: "failed" });
  const [failedPayment] = await db
    .select({ id: paymentsTable.id })
    .from(paymentsTable)
    .where(eq(paymentsTable.providerPaymentId, failed.payment.paymentIntentId))
    .limit(1);
  const failedAudits = await db
    .select({ action: adminAuditLogsTable.action })
    .from(adminAuditLogsTable)
    .where(eq(adminAuditLogsTable.entityId, failedPayment!.id));
  assert.equal(failedAudits.some((audit) => audit.action === "payment.failed"), true);
  const failedAlertsResponse = await request("/api/admin/dispatch-alerts", { headers: bearer(dispatcher) });
  assert.equal(failedAlertsResponse.status, 200);
  assert.equal(
    (failedAlertsResponse.body as Array<{ deliveryId: string; type: string }>).some(
      (alert) => alert.deliveryId === failed.id && alert.type === "delivery_failed",
    ),
    true,
  );

  const refundableCheckout = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(refundableCheckout.status, 201);
  const refundable = refundableCheckout.body as { id: string; payment: { paymentIntentId: string } };
  const [refundableRecord] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, refundable.id))
    .limit(1);
  assert.ok(refundableRecord);
  fixtureDeliveryIds.push(refundableRecord.id);
  assert.deepEqual(
    await processVerifiedStripeEvent({
      id: `evt_${randomUUID().replaceAll("-", "")}`,
      type: "payment_intent.succeeded",
      data: { object: { id: refundable.payment.paymentIntentId, status: "succeeded" } },
    } as any),
    { disposition: "processed", action: "succeeded" },
  );
  assert.deepEqual(
    await processVerifiedStripeEvent({
      id: `evt_${randomUUID().replaceAll("-", "")}`,
      type: "charge.refunded",
      data: { object: { id: `ch_${randomUUID().replaceAll("-", "")}`, payment_intent: refundable.payment.paymentIntentId, status: "succeeded", refunded: true, amount: 1000, amount_refunded: 1000 } },
    } as any),
    { disposition: "processed", action: "refunded" },
  );
  const [refundedStatus] = await db
    .select({ paymentStatus: deliveriesTable.paymentStatus, deliveryStatus: deliveriesTable.deliveryStatus })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, refundableRecord.id))
    .limit(1);
  assert.deepEqual(refundedStatus, { paymentStatus: "refunded", deliveryStatus: "refunded" });
  const [refundedPayment] = await db
    .select({ id: paymentsTable.id })
    .from(paymentsTable)
    .where(eq(paymentsTable.providerPaymentId, refundable.payment.paymentIntentId))
    .limit(1);
  const refundedAudits = await db
    .select({ action: adminAuditLogsTable.action })
    .from(adminAuditLogsTable)
    .where(eq(adminAuditLogsTable.entityId, refundedPayment!.id));
  assert.equal(refundedAudits.some((audit) => audit.action === "payment.refunded"), true);
});

test("creates actionable dispatch alerts for failed routes and retains acknowledgement audit history", async () => {
  const checkout = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(checkout.status, 201);
  const delivery = checkout.body as { id: string; orderNumber: string };
  const [record] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, delivery.id))
    .limit(1);
  assert.ok(record);
  fixtureDeliveryIds.push(record.id);

  await db
    .update(deliveriesTable)
    .set({ deliveryStatus: "in_transit", assignedAt: new Date() })
    .where(eq(deliveriesTable.id, record.id));

  const failed = await request(`/api/admin/deliveries/${delivery.id}/status`, {
    method: "POST",
    headers: bearer(dispatcher),
    body: JSON.stringify({ status: "failed", reason: "Driver reported a route issue." }),
  });
  assert.equal(failed.status, 200);
  assert.equal(typeof (failed.body as { updatedAt: unknown }).updatedAt, "string");

  const alertsResponse = await request("/api/admin/dispatch-alerts", { headers: bearer(dispatcher) });
  assert.equal(alertsResponse.status, 200);
  const alert = (alertsResponse.body as Array<{
    id: string;
    deliveryId: string;
    orderNumber: string;
    type: string;
    message: string;
    recommendedAction: string;
    acknowledgedAt: string | null;
  }>).find((item) => item.deliveryId === delivery.id);
  assert.ok(alert);
  assert.equal(alert.type, "delivery_failed");
  assert.equal(alert.orderNumber, delivery.orderNumber);
  assert.match(alert.message, new RegExp(delivery.orderNumber));
  assert.match(alert.recommendedAction, /contact the driver and customer/i);
  assert.equal(alert.acknowledgedAt, null);

  const [firstAcknowledgement, secondAcknowledgement] = await Promise.all([
    request(`/api/admin/dispatch-alerts/${alert.id}/acknowledge`, {
      method: "POST",
      headers: bearer(dispatcher),
    }),
    request(`/api/admin/dispatch-alerts/${alert.id}/acknowledge`, {
      method: "POST",
      headers: bearer(dispatcher),
    }),
  ]);
  assert.equal(firstAcknowledgement.status, 200);
  assert.equal(secondAcknowledgement.status, 200);
  assert.equal((firstAcknowledgement.body as { acknowledgedAt: string | null }).acknowledgedAt !== null, true);
  assert.equal((secondAcknowledgement.body as { acknowledgedAt: string | null }).acknowledgedAt !== null, true);

  const remainingAlerts = await request("/api/admin/dispatch-alerts", { headers: bearer(dispatcher) });
  assert.equal(remainingAlerts.status, 200);
  assert.equal((remainingAlerts.body as Array<{ id: string }>).some((item) => item.id === alert.id), false);

  const auditResponse = await request("/api/admin/audit-logs", {
    headers: bearer(dispatcher),
  });
  assert.equal(auditResponse.status, 200);
  const acknowledgementAudits = (auditResponse.body as Array<{ action: string; entityId: string | null }>).filter(
    (item) => item.action === "dispatch.alert_acknowledged" && item.entityId === delivery.id,
  );
  assert.equal(acknowledgementAudits.length, 1);
});

test("creates one cancellation alert and limits dispatch alerts to staff", async () => {
  const checkout = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(checkout.status, 201);
  const delivery = checkout.body as { id: string };
  const [record] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, delivery.id))
    .limit(1);
  assert.ok(record);
  fixtureDeliveryIds.push(record.id);

  await db
    .update(deliveriesTable)
    .set({ deliveryStatus: "searching_driver" })
    .where(eq(deliveriesTable.id, record.id));

  const cancellationResults = await Promise.all([
    request(`/api/admin/deliveries/${delivery.id}/status`, {
      method: "POST",
      headers: bearer(dispatcher),
      body: JSON.stringify({ status: "cancelled", reason: "Customer requested cancellation." }),
    }),
    request(`/api/admin/deliveries/${delivery.id}/status`, {
      method: "POST",
      headers: bearer(dispatcher),
      body: JSON.stringify({ status: "cancelled", reason: "Customer requested cancellation." }),
    }),
  ]);
  assert.deepEqual(
    cancellationResults.map((result) => result.status).sort(),
    [200, 200],
  );
  const successfulCancellation = cancellationResults.find((result) => result.status === 200);
  assert.ok(successfulCancellation);
  assert.equal("total" in (successfulCancellation.body as Record<string, unknown>), false);
  assert.equal("pickupContactPhone" in (successfulCancellation.body as Record<string, unknown>), false);

  const alertsResponse = await request("/api/admin/dispatch-alerts", { headers: bearer(dispatcher) });
  assert.equal(alertsResponse.status, 200);
  const cancellationAlerts = (alertsResponse.body as Array<{ id: string; deliveryId: string; type: string }>).filter(
    (alert) => alert.deliveryId === delivery.id && alert.type === "delivery_cancelled",
  );
  assert.equal(cancellationAlerts.length, 1);

  const customerList = await request("/api/admin/dispatch-alerts", { headers: bearer(customer) });
  assert.equal(customerList.status, 403);
  const customerAcknowledgement = await request(`/api/admin/dispatch-alerts/${cancellationAlerts[0].id}/acknowledge`, {
    method: "POST",
    headers: bearer(customer),
  });
  assert.equal(customerAcknowledgement.status, 403);
});

test("materializes only one alert per dispatcher when delayed routes are checked concurrently", async () => {
  const checkout = await request("/api/deliveries", {
    method: "POST",
    headers: bearer(customer),
    body: JSON.stringify(deliveryBody),
  });
  assert.equal(checkout.status, 201);
  const delivery = checkout.body as { id: string };
  const [record] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, delivery.id))
    .limit(1);
  assert.ok(record);
  fixtureDeliveryIds.push(record.id);

  await db
    .update(deliveriesTable)
    .set({
      deliveryStatus: "in_transit",
      assignedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      estimatedDurationMinutes: "30",
    })
    .where(eq(deliveriesTable.id, record.id));

  await Promise.all([
    request("/api/admin/dispatch-alerts", { headers: bearer(dispatcher) }),
    request("/api/admin/dispatch-alerts", { headers: bearer(dispatcher) }),
  ]);

  const alertsResponse = await request("/api/admin/dispatch-alerts", { headers: bearer(dispatcher) });
  assert.equal(alertsResponse.status, 200);
  const delayedAlerts = (alertsResponse.body as Array<{ deliveryId: string; type: string }>).filter(
    (alert) => alert.deliveryId === delivery.id && alert.type === "delivery_delayed",
  );
  assert.equal(delayedAlerts.length, 1);

  const notifications = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.deliveryId, record.id),
      eq(notificationsTable.profileId, dispatcher.id),
      eq(notificationsTable.type, "delivery_delayed"),
    ));
  assert.equal(notifications.length, 1);
});

test("assigns an approved driver and blocks every other driver from the delivery", async () => {
  await seedCurrentComplianceDocuments(assignedDriverId, unassignedDriverId);
  await db
    .update(deliveriesTable)
    .set({ deliveryStatus: "delivered", deliveredAt: new Date() })
    .where(and(eq(deliveriesTable.driverId, assignedDriverId), ne(deliveriesTable.publicDeliveryId, createdDeliveryId)));
  await db
    .update(driversTable)
    .set({ availabilityStatus: "offline" })
    .where(eq(driversTable.id, unassignedDriverId));
  const unavailableAssignment = await request(`/api/admin/deliveries/${createdDeliveryId}/assign`, {
    method: "POST",
    headers: bearer(dispatcher),
    body: JSON.stringify({ driverId: unassignedDriverId }),
  });
  assert.equal(unavailableAssignment.status, 400);
  assert.match((unavailableAssignment.body as { error: string }).error, /not currently available/i);

  const assignResponse = await request(`/api/admin/deliveries/${createdDeliveryId}/assign`, {
    method: "POST",
    headers: bearer(dispatcher),
    body: JSON.stringify({ driverId: assignedDriverId }),
  });
  assert.equal(assignResponse.status, 200, JSON.stringify(assignResponse.body));
  assert.equal((assignResponse.body as { status: string }).status, "driver_assigned");
  assert.equal(typeof (assignResponse.body as { updatedAt: unknown }).updatedAt, "string");
  assert.equal("total" in (assignResponse.body as Record<string, unknown>), false);
  assert.equal("recipientPhone" in (assignResponse.body as Record<string, unknown>), false);
  assert.equal("driverRating" in (assignResponse.body as Record<string, unknown>), false);

  const otherDriverList = await request("/api/driver/deliveries", {
    headers: bearer(unassignedDriver),
  });
  assert.equal(otherDriverList.status, 200);
  assert.equal(
    (otherDriverList.body as Array<{ id: string }>).some((delivery) => delivery.id === createdDeliveryId),
    false,
  );

  const otherDriverUpdate = await request(`/api/driver/deliveries/${createdDeliveryId}/status`, {
    method: "POST",
    headers: bearer(unassignedDriver),
    body: JSON.stringify({ status: "driver_en_route_pickup" }),
  });
  assert.equal(otherDriverUpdate.status, 404);

  const assignedDriverUpdate = await request(`/api/driver/deliveries/${createdDeliveryId}/status`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ status: "driver_en_route_pickup", reason: "heading to pickup" }),
  });
  assert.equal(assignedDriverUpdate.status, 200);
  assert.equal((assignedDriverUpdate.body as { status: string }).status, "driver_en_route_pickup");
});

test("shows dispatchers active routes, approved drivers, current assigned locations, and audit context", async () => {
  await seedCurrentComplianceDocuments(assignedDriverId);
  const locationResponse = await request(`/api/driver/deliveries/${createdDeliveryId}/location`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ latitude: 35.7796, longitude: -78.6382, accuracyMeters: 12 }),
  });
  assert.equal(locationResponse.status, 201);

  const deliveriesResponse = await request("/api/admin/deliveries", {
    headers: bearer(dispatcher),
  });
  assert.equal(deliveriesResponse.status, 200);
  const delivery = (deliveriesResponse.body as Array<{
    id: string;
    orderNumber: string;
    pickupAddress: string;
    driverId: string | null;
    driverLocation: { latitude: number; longitude: number } | null;
    priority: "asap" | "scheduled";
    updatedAt: string;
    isDelayed: boolean;
  }>).find((item) => item.id === createdDeliveryId);
  assert.equal(delivery?.driverId, assignedDriverId);
  assert.equal(delivery?.driverLocation?.latitude, 35.7796);
  assert.equal(delivery?.driverLocation?.longitude, -78.6382);
  assert.equal(delivery?.priority, "asap");
  assert.equal(typeof delivery?.updatedAt, "string");
  assert.equal(delivery?.isDelayed, false);

  const [supportQueue, supportDrivers, supportRoute, supportPhotos] = await Promise.all([
    request("/api/admin/deliveries", { headers: bearer(support) }),
    request("/api/admin/drivers", { headers: bearer(support) }),
    request(`/api/deliveries/${createdDeliveryId}/route`, { headers: bearer(support) }),
    request(`/api/deliveries/${createdDeliveryId}/photos`, { headers: bearer(support) }),
  ]);
  assert.equal(supportQueue.status, 403);
  assert.equal(supportDrivers.status, 403);
  assert.equal(supportRoute.status, 403);
  assert.equal(supportPhotos.status, 403);

  const matchingRoutesResponse = await request(
    `/api/admin/deliveries?search=${encodeURIComponent(delivery!.orderNumber)}&filter=in_progress&sort=recently_changed`,
    { headers: bearer(dispatcher) },
  );
  assert.equal(matchingRoutesResponse.status, 200);
  assert.deepEqual(
    (matchingRoutesResponse.body as Array<{ id: string }>).map((item) => item.id),
    [createdDeliveryId],
  );

  const addressSearchResponse = await request(
    `/api/admin/deliveries?search=${encodeURIComponent(delivery!.pickupAddress)}&filter=all&sort=recently_changed`,
    { headers: bearer(dispatcher) },
  );
  assert.equal(addressSearchResponse.status, 200);
  assert.equal(
    (addressSearchResponse.body as Array<{ id: string }>).some((item) => item.id === createdDeliveryId),
    true,
  );

  const driverSearchResponse = await request(
    "/api/admin/deliveries?search=Test%20driver%20Delivery&filter=in_progress&sort=recently_changed",
    { headers: bearer(dispatcher) },
  );
  assert.equal(driverSearchResponse.status, 200);
  assert.equal(
    (driverSearchResponse.body as Array<{ id: string }>).some((item) => item.id === createdDeliveryId),
    true,
  );

  const excludedQueueResponse = await request(
    `/api/admin/deliveries?search=${encodeURIComponent(delivery!.orderNumber)}&filter=unassigned&sort=urgent`,
    { headers: bearer(dispatcher) },
  );
  assert.equal(excludedQueueResponse.status, 200);
  assert.deepEqual(excludedQueueResponse.body, []);

  await db
    .update(deliveriesTable)
    .set({ assignedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
    .where(eq(deliveriesTable.publicDeliveryId, createdDeliveryId));
  const delayedRoutesResponse = await request(
    `/api/admin/deliveries?search=${encodeURIComponent(delivery!.pickupAddress)}&filter=delayed&sort=urgent`,
    { headers: bearer(dispatcher) },
  );
  assert.equal(delayedRoutesResponse.status, 200);
  const delayedRoutes = delayedRoutesResponse.body as Array<{ id: string; isDelayed: boolean }>;
  const delayedRoute = delayedRoutes.find((route) => route.id === createdDeliveryId);
  assert.ok(delayedRoute);
  assert.equal(delayedRoute.isDelayed, true);

  const driversResponse = await request("/api/admin/drivers", {
    headers: bearer(dispatcher),
  });
  assert.equal(driversResponse.status, 200);
  assert.equal(
    (driversResponse.body as Array<{ id: string }>).some((driver) => driver.id === assignedDriverId),
    true,
  );

  const auditResponse = await request("/api/admin/audit-logs", {
    headers: bearer(dispatcher),
  });
  assert.equal(auditResponse.status, 200);
  const dispatchAudit = (auditResponse.body as Array<{
    entityId: string | null;
    actorName: string | null;
    entityLabel: string | null;
    driverName: string | null;
  }>).find((audit) => audit.entityId === createdDeliveryId);
  assert.equal(dispatchAudit?.actorName, "Test dispatcher Delivery");
  assert.match(dispatchAudit?.entityLabel ?? "", /^Order AA-/);
  assert.equal(dispatchAudit?.driverName, "Test driver Delivery");

  const customerResponse = await request("/api/admin/deliveries", {
    headers: bearer(customer),
  });
  assert.equal(customerResponse.status, 403);

  await db
    .update(deliveriesTable)
    .set({ deliveryStatus: "delivered" })
    .where(eq(deliveriesTable.publicDeliveryId, createdDeliveryId));
  const terminalLocationResponse = await request(`/api/driver/deliveries/${createdDeliveryId}/location`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ latitude: 35.78, longitude: -78.64 }),
  });
  assert.equal(terminalLocationResponse.status, 409);
});

test("creates one hash-only recipient code and completes with the customer-owned code", async () => {
  const delivery = await createAssignedDeliveryFixture("driver_arrived_delivery");
  const transition = await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/status`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ status: "delivery_verification_pending" }),
  });
  assert.equal(transition.status, 200);
  assert.equal(JSON.stringify(transition.body).includes("code"), false);
  assert.equal(JSON.stringify(transition.body).includes("otp"), false);

  const [verification] = await db
    .select()
    .from(deliveryVerificationsTable)
    .where(eq(deliveryVerificationsTable.deliveryId, delivery.id))
    .limit(1);
  assert.ok(verification);
  assert.equal(verification.attempts, "0");
  assert.equal(verification.expiresAt.getTime() > Date.now(), true);
  assert.match(verification.otpHash, /^[a-f0-9]{64}$/);

  const repeatTransition = await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/status`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ status: "delivery_verification_pending" }),
  });
  assert.equal(repeatTransition.status, 200);
  const verificationRows = await db
    .select()
    .from(deliveryVerificationsTable)
    .where(eq(deliveryVerificationsTable.deliveryId, delivery.id));
  assert.equal(verificationRows.length, 1);
  assert.equal(verificationRows[0]?.otpHash, verification.otpHash);
  assert.equal(verificationRows[0]?.expiresAt.getTime(), verification.expiresAt.getTime());

  const driverRead = await request(`/api/deliveries/${delivery.publicDeliveryId}/recipient-verification`, {
    headers: bearer(assignedDriver),
  });
  assert.equal(driverRead.status, 403);

  const customerRead = await request(`/api/deliveries/${delivery.publicDeliveryId}/recipient-verification`, {
    headers: bearer(customer),
  });
  assert.equal(customerRead.status, 200);
  const correctCode = (customerRead.body as { code: string }).code;
  assert.match(correctCode, /^\d{6}$/);
  assert.notEqual(verification.otpHash, correctCode);
  assert.equal(
    verification.otpHash,
    createHash("sha256").update(`${delivery.id}:${correctCode}`).digest("hex"),
  );

  const completed = await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/verify-recipient`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ otp: correctCode }),
  });
  assert.equal(completed.status, 200);
  assert.equal((completed.body as { status: string }).status, "delivered");

  const codeAfterCompletion = await request(`/api/deliveries/${delivery.publicDeliveryId}/recipient-verification`, {
    headers: bearer(customer),
  });
  assert.equal(codeAfterCompletion.status, 404);
});

test("locks recipient verification after five persisted incorrect code attempts", async () => {
  const delivery = await createAssignedDeliveryFixture("driver_arrived_delivery");
  await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/status`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ status: "delivery_verification_pending" }),
  });
  const customerRead = await request(`/api/deliveries/${delivery.publicDeliveryId}/recipient-verification`, {
    headers: bearer(customer),
  });
  assert.equal(customerRead.status, 200);
  const correctCode = (customerRead.body as { code: string }).code;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/verify-recipient`, {
      method: "POST",
      headers: bearer(assignedDriver),
      body: JSON.stringify({ otp: "000000" }),
    });
    assert.equal(response.status, 400);
    if (attempt === 5) {
      assert.match((response.body as { error: string }).error, /too many incorrect/i);
    }
  }

  const [verification] = await db
    .select({
      attempts: deliveryVerificationsTable.attempts,
      lockedAt: deliveryVerificationsTable.lockedAt,
      verifiedAt: deliveryVerificationsTable.verifiedAt,
    })
    .from(deliveryVerificationsTable)
    .where(eq(deliveryVerificationsTable.deliveryId, delivery.id))
    .limit(1);
  assert.deepEqual(verification && {
    attempts: verification.attempts,
    locked: verification.lockedAt !== null,
    verifiedAt: verification.verifiedAt,
  }, { attempts: "5", locked: true, verifiedAt: null });

  const correctAfterLock = await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/verify-recipient`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ otp: correctCode }),
  });
  assert.equal(correctAfterLock.status, 400);
  assert.match((correctAfterLock.body as { error: string }).error, /valid recipient code is not available/i);
});

test("rejects expired recipient verification codes", async () => {
  const delivery = await createAssignedDeliveryFixture("driver_arrived_delivery");
  await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/status`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ status: "delivery_verification_pending" }),
  });
  const customerRead = await request(`/api/deliveries/${delivery.publicDeliveryId}/recipient-verification`, {
    headers: bearer(customer),
  });
  assert.equal(customerRead.status, 200);
  const expiredCode = (customerRead.body as { code: string }).code;
  await db
    .update(deliveryVerificationsTable)
    .set({ expiresAt: new Date(Date.now() - 1_000) })
    .where(eq(deliveryVerificationsTable.deliveryId, delivery.id));

  const expiredRead = await request(`/api/deliveries/${delivery.publicDeliveryId}/recipient-verification`, {
    headers: bearer(customer),
  });
  assert.equal(expiredRead.status, 404);
  const expiredVerification = await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/verify-recipient`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({ otp: expiredCode }),
  });
  assert.equal(expiredVerification.status, 400);
  assert.match((expiredVerification.body as { error: string }).error, /valid recipient code is not available/i);
});

test("rejects a stale first location sample and accepts a current location sample", async () => {
  const delivery = await createAssignedDeliveryFixture();
  const stale = await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/location`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({
      latitude: 35.7796,
      longitude: -78.6382,
      capturedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
    }),
  });
  assert.equal(stale.status, 400);
  assert.match((stale.body as { error: string }).error, /timestamps must be recent/i);

  const locationsAfterStaleSample = await db
    .select({ id: driverLocationsTable.id })
    .from(driverLocationsTable)
    .where(eq(driverLocationsTable.deliveryId, delivery.id));
  assert.equal(locationsAfterStaleSample.length, 0);

  const currentCapturedAt = new Date().toISOString();
  const current = await request(`/api/driver/deliveries/${delivery.publicDeliveryId}/location`, {
    method: "POST",
    headers: bearer(assignedDriver),
    body: JSON.stringify({
      latitude: 35.78,
      longitude: -78.64,
      accuracyMeters: 10,
      capturedAt: currentCapturedAt,
    }),
  });
  assert.equal(current.status, 201);
  assert.equal((current.body as { deliveryId: string }).deliveryId, delivery.publicDeliveryId);
  const events = await listDeliveryEventsAfter({
    cursor: 0,
    customerId: customer.id,
    driverId: null,
    isStaff: false,
  });
  const locationEvent = events.find((event) => event.type === "driver.location_updated" && event.deliveryId === delivery.publicDeliveryId);
  assert.deepEqual(locationEvent?.payload, {
    id: (current.body as { id: string }).id,
    latitude: 35.78,
    longitude: -78.64,
    accuracyMeters: 10,
    capturedAt: currentCapturedAt,
  });

  await db.update(deliveriesTable).set({ deliveryStatus: "delivered" }).where(eq(deliveriesTable.id, delivery.id));
  const terminalRoute = await request(`/api/deliveries/${delivery.publicDeliveryId}/route`, { headers: bearer(customer) });
  assert.equal(terminalRoute.status, 200);
  assert.equal((terminalRoute.body as { driverLocation: unknown }).driverLocation, null);
  const terminalEvents = await listDeliveryEventsAfter({
    cursor: 0,
    customerId: customer.id,
    driverId: null,
    isStaff: false,
  });
  assert.equal(terminalEvents.some((event) => event.type === "driver.location_updated" && event.deliveryId === delivery.publicDeliveryId), false);
});

test("replays the live public event identity and atomically queues customer and driver notifications", async () => {
  const delivery = await createAssignedDeliveryFixture();
  let liveEvent: {
    type: string;
    cursor: number;
    deliveryId: string;
    createdAt: string;
  } | null = null;
  const unsubscribe = subscribeToDeliveryEvents((event) => {
    if (event.deliveryId === delivery.publicDeliveryId) {
      liveEvent = {
        type: event.type,
        cursor: event.cursor,
        deliveryId: event.deliveryId,
        createdAt: event.createdAt,
      };
    }
  });

  try {
    await transitionDelivery(delivery.id, assignedDriver.id, "driver_en_route_pickup", "Coordination regression test.");
  } finally {
    unsubscribe();
  }

  assert.ok(liveEvent);
  const replayed = await listDeliveryEventsAfter({
    cursor: liveEvent.cursor - 1,
    customerId: customer.id,
    driverId: null,
    isStaff: false,
  });
  const replayedEvent = replayed.find((event) => event.cursor === liveEvent!.cursor);
  assert.deepEqual(replayedEvent && {
    type: replayedEvent.type,
    cursor: replayedEvent.cursor,
    deliveryId: replayedEvent.deliveryId,
    createdAt: replayedEvent.createdAt,
  }, liveEvent);

  const [transitioned] = await db
    .select({ deliveryStatus: deliveriesTable.deliveryStatus })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, delivery.id))
    .limit(1);
  assert.equal(transitioned?.deliveryStatus, "driver_en_route_pickup");

  const outbox = await db
    .select({
      profileId: notificationAttemptsTable.profileId,
      status: notificationAttemptsTable.status,
    })
    .from(notificationAttemptsTable)
    .where(eq(notificationAttemptsTable.coordinationEventCursor, liveEvent.cursor));
  assert.deepEqual(
    outbox.map((entry) => entry.profileId).sort(),
    [customer.id, assignedDriver.id].sort(),
  );
  assert.equal(outbox.every((entry) => entry.status === "pending"), true);
});

test("delivers queued customer and driver updates through the in-app notification channel", async () => {
  const delivery = await createAssignedDeliveryFixture();
  await transitionDelivery(delivery.id, assignedDriver.id, "driver_en_route_pickup", "Deliver in-app update.");
  const [event] = await db
    .select({ cursor: database.deliveryCoordinationEventsTable.cursor })
    .from(database.deliveryCoordinationEventsTable)
    .where(eq(database.deliveryCoordinationEventsTable.deliveryId, delivery.id))
    .orderBy(database.deliveryCoordinationEventsTable.cursor)
    .limit(1);
  assert.ok(event);

  await runNotificationDeliveryWorker({ batchSize: 100 });

  const deliveredAttempts = await db
    .select({
      profileId: notificationAttemptsTable.profileId,
      status: notificationAttemptsTable.status,
      attempts: notificationAttemptsTable.attempts,
    })
    .from(notificationAttemptsTable)
    .where(eq(notificationAttemptsTable.coordinationEventCursor, event.cursor));
  assert.deepEqual(deliveredAttempts.map((attempt) => attempt.profileId).sort(), [customer.id, assignedDriver.id].sort());
  assert.equal(deliveredAttempts.every((attempt) => attempt.status === "delivered" && attempt.attempts === "1"), true);

  const deliveredNotifications = await db
    .select({ profileId: notificationsTable.profileId, type: notificationsTable.type })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.deliveryId, delivery.id),
      eq(notificationsTable.type, "delivery_updated"),
      inArray(notificationsTable.profileId, [customer.id, assignedDriver.id]),
    ));
  assert.deepEqual(deliveredNotifications.map((notification) => notification.profileId).sort(), [customer.id, assignedDriver.id].sort());
});

test("does not let duplicate workers deliver the same notification attempt concurrently", async () => {
  const delivery = await createAssignedDeliveryFixture();
  await transitionDelivery(delivery.id, assignedDriver.id, "driver_en_route_pickup", "Exercise worker claim.");
  const [event] = await db
    .select({ cursor: database.deliveryCoordinationEventsTable.cursor })
    .from(database.deliveryCoordinationEventsTable)
    .where(eq(database.deliveryCoordinationEventsTable.deliveryId, delivery.id))
    .orderBy(database.deliveryCoordinationEventsTable.cursor)
    .limit(1);
  assert.ok(event);
  const outbox = await db
    .select({ id: notificationAttemptsTable.id, profileId: notificationAttemptsTable.profileId })
    .from(notificationAttemptsTable)
    .where(eq(notificationAttemptsTable.coordinationEventCursor, event.cursor));
  const driverAttempt = outbox.find((attempt) => attempt.profileId === assignedDriver.id);
  assert.ok(driverAttempt);
  await db
    .update(notificationAttemptsTable)
    .set({ channel: "test_transport", status: "delivered" })
    .where(eq(notificationAttemptsTable.id, driverAttempt.id));
  await db
    .update(notificationAttemptsTable)
    .set({ channel: "test_transport" })
    .where(eq(notificationAttemptsTable.coordinationEventCursor, event.cursor));

  const deliveredAttemptIds: string[] = [];
  let startDelivery!: () => void;
  const deliveryStarted = new Promise<void>((resolve) => { startDelivery = resolve; });
  let releaseDelivery!: () => void;
  const deliveryGate = new Promise<void>((resolve) => { releaseDelivery = resolve; });
  const transport = {
    async deliver(notification: { attemptId: string }) {
      deliveredAttemptIds.push(notification.attemptId);
      startDelivery();
      await deliveryGate;
    },
  };
  const firstWorker = runNotificationDeliveryWorker({
    batchSize: 1,
    channel: "test_transport",
    leaseDurationMs: 100,
    transports: { test_transport: transport },
  });
  await deliveryStarted;
  await new Promise((resolve) => setTimeout(resolve, 175));
  const second = await runNotificationDeliveryWorker({
    batchSize: 1,
    channel: "test_transport",
    leaseDurationMs: 100,
    transports: { test_transport: transport },
  });
  releaseDelivery();
  const first = await firstWorker;

  assert.equal(first.delivered + second.delivered, 1);
  assert.equal(second.claimed, 0);
  assert.equal(deliveredAttemptIds.length, 1);
  assert.equal(new Set(deliveredAttemptIds).size, 1);
  const attempts = await db
    .select({ status: notificationAttemptsTable.status, profileId: notificationAttemptsTable.profileId })
    .from(notificationAttemptsTable)
    .where(eq(notificationAttemptsTable.coordinationEventCursor, event.cursor));
  assert.equal(attempts.every((attempt) => attempt.status === "delivered"), true);
});

test("requeues a transport failure with bounded backoff without replaying the delivery event", async () => {
  const delivery = await createAssignedDeliveryFixture();
  await transitionDelivery(delivery.id, assignedDriver.id, "driver_en_route_pickup", "Exercise notification retry.");
  const [event] = await db
    .select({ cursor: database.deliveryCoordinationEventsTable.cursor })
    .from(database.deliveryCoordinationEventsTable)
    .where(eq(database.deliveryCoordinationEventsTable.deliveryId, delivery.id))
    .orderBy(database.deliveryCoordinationEventsTable.cursor)
    .limit(1);
  assert.ok(event);
  await db
    .update(notificationAttemptsTable)
    .set({ channel: "retry_test" })
    .where(eq(notificationAttemptsTable.coordinationEventCursor, event.cursor));

  const startedAt = Date.now();
  const failed = await runNotificationDeliveryWorker({
    batchSize: 100,
    transports: {
      retry_test: {
        async deliver() {
          throw new Error("Temporary transport outage.");
        },
      },
    },
  });
  assert.equal(failed.retried, 2);

  const retries = await db
    .select({
      attempts: notificationAttemptsTable.attempts,
      status: notificationAttemptsTable.status,
      lastError: notificationAttemptsTable.lastError,
      nextAttemptAt: notificationAttemptsTable.nextAttemptAt,
    })
    .from(notificationAttemptsTable)
    .where(eq(notificationAttemptsTable.coordinationEventCursor, event.cursor));
  assert.equal(retries.every((retry) =>
    retry.status === "pending"
    && retry.attempts === "1"
    && retry.lastError === "Temporary transport outage."
    && retry.nextAttemptAt.getTime() >= startedAt
    && retry.nextAttemptAt.getTime() <= startedAt + 5 * 60_000,
  ), true);

  await db
    .update(notificationAttemptsTable)
    .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
    .where(eq(notificationAttemptsTable.coordinationEventCursor, event.cursor));
  const recovered = await runNotificationDeliveryWorker({
    batchSize: 100,
    transports: { retry_test: { async deliver() {} } },
  });
  assert.equal(recovered.delivered, 2);

  const events = await db
    .select({ cursor: database.deliveryCoordinationEventsTable.cursor })
    .from(database.deliveryCoordinationEventsTable)
    .where(eq(database.deliveryCoordinationEventsTable.deliveryId, delivery.id));
  assert.equal(events.length, 1);
});

test("requires a live persisted offer before acceptance and preserves terminal offer outcomes", async () => {
  setPickupRouteProviderForTests(async () => ({ distanceMiles: 1, minutes: 5, source: "road" }));
  const profile = await createProfile("driver");
  const [driver] = await db.insert(driversTable).values({
    profileId: profile.id,
    onboardingStatus: "complete",
    availabilityStatus: "available",
    approvalStatus: "approved",
  }).returning();
  await seedCurrentComplianceDocuments(driver.id);
  await db.update(driversTable).set({
    currentLatitude: 35.7796, currentLongitude: -78.6382, lastLocationUpdate: new Date(),
  }).where(eq(driversTable.id, driver.id));

  const declinedId = await createAvailableOffer();
  const directAccept = await request(`/api/driver/deliveries/${declinedId}/accept`, {
    method: "POST",
    headers: bearer(profile),
  });
  assert.equal(directAccept.status, 409, "an unoffered delivery cannot be assigned");
  const initialOffers = await request("/api/driver/offers", { headers: bearer(profile) });
  assert.equal(initialOffers.status, 200);
  assert.equal((initialOffers.body as Array<{ id: string }>).some((offer) => offer.id === declinedId), true);
  const declined = await request(`/api/driver/deliveries/${declinedId}/decline`, {
    method: "POST",
    headers: bearer(profile),
  });
  assert.equal(declined.status, 200);
  const afterDecline = await request("/api/driver/offers", { headers: bearer(profile) });
  assert.equal((afterDecline.body as Array<{ id: string }>).some((offer) => offer.id === declinedId), false);
  assert.equal((await request(`/api/driver/deliveries/${declinedId}/accept`, {
    method: "POST",
    headers: bearer(profile),
  })).status, 409);
  const [declinedDelivery] = await db.select().from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, declinedId));
  assert.equal(declinedDelivery.driverId, null);
  assert.equal(declinedDelivery.deliveryStatus, "searching_driver");

  const expiredId = await createAvailableOffer();
  const offered = await request("/api/driver/offers", { headers: bearer(profile) });
  assert.equal((offered.body as Array<{ id: string }>).some((offer) => offer.id === expiredId), true);
  const [expiredDelivery] = await db.select({
    id: deliveriesTable.id, offerExpiresAt: deliveriesTable.offerExpiresAt, dispatchStartedAt: deliveriesTable.dispatchStartedAt, createdAt: deliveriesTable.createdAt,
  }).from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, expiredId));
  const [offeredAttempt] = await db.select().from(driverDeliveryOfferAttemptsTable).where(and(
    eq(driverDeliveryOfferAttemptsTable.deliveryId, expiredDelivery.id),
    eq(driverDeliveryOfferAttemptsTable.driverId, driver.id),
  ));
  const [dispatch] = await db.select({ totalExpirationSeconds: dispatchSettingsTable.totalExpirationSeconds })
    .from(dispatchSettingsTable).where(eq(dispatchSettingsTable.id, "dispatch"));
  assert.equal(
    offeredAttempt.offerExpiresAt.getTime(),
    (expiredDelivery.dispatchStartedAt ?? expiredDelivery.createdAt).getTime() + dispatch.totalExpirationSeconds * 1_000,
    "persisted offer lifetime follows the staged dispatch total expiration, not the legacy delivery window",
  );
  const expiredAt = new Date(Date.now() - 1_000);
  await db.update(driverDeliveryOfferAttemptsTable).set({ offerExpiresAt: expiredAt }).where(eq(
    driverDeliveryOfferAttemptsTable.id,
    offeredAttempt.id,
  ));
  await db.update(deliveriesTable).set({
    offerExpiresAt: expiredAt,
    dispatchStartedAt: new Date(Date.now() - (dispatch.totalExpirationSeconds + 1) * 1_000),
  }).where(eq(deliveriesTable.id, expiredDelivery.id));
  const afterExpiry = await request("/api/driver/offers", { headers: bearer(profile) });
  assert.equal((afterExpiry.body as Array<{ id: string }>).some((offer) => offer.id === expiredId), false);
  const [persistedExpiry] = await db.select().from(driverDeliveryOfferAttemptsTable)
    .where(eq(driverDeliveryOfferAttemptsTable.id, offeredAttempt.id));
  assert.equal(persistedExpiry.response, "expired");
  assert.ok(persistedExpiry.respondedAt);
  assert.equal((await request(`/api/driver/deliveries/${expiredId}/accept`, {
    method: "POST",
    headers: bearer(profile),
  })).status, 409);
  await db.update(deliveriesTable).set({
    dispatchStartedAt: new Date(),
    offerExpiresAt: new Date(Date.now() + 60_000),
  }).where(eq(deliveriesTable.id, expiredDelivery.id));
  const otherProfile = await createProfile("driver");
  const [otherDriver] = await db.insert(driversTable).values({
    profileId: otherProfile.id,
    onboardingStatus: "complete",
    availabilityStatus: "available",
    approvalStatus: "approved",
  }).returning();
  await seedCurrentComplianceDocuments(otherDriver.id);
  await db.update(driversTable).set({
    currentLatitude: 35.7796, currentLongitude: -78.6382, lastLocationUpdate: new Date(),
  }).where(eq(driversTable.id, otherDriver.id));
  const otherDriverOffers = await request("/api/driver/offers", { headers: bearer(otherProfile) });
  assert.equal(
    (otherDriverOffers.body as Array<{ id: string }>).some((offer) => offer.id === expiredId),
    true,
    "a refreshed delivery window may be offered to a different driver",
  );
  const [otherAttempt] = await db.select().from(driverDeliveryOfferAttemptsTable).where(and(
    eq(driverDeliveryOfferAttemptsTable.deliveryId, expiredDelivery.id),
    eq(driverDeliveryOfferAttemptsTable.driverId, otherDriver.id),
  ));
  assert.equal(otherAttempt.response, "offered");
  assert.ok(otherAttempt.offerExpiresAt > expiredAt);

  const staleAcceptId = await createAvailableOffer();
  const staleOffers = await request("/api/driver/offers", { headers: bearer(profile) });
  assert.equal((staleOffers.body as Array<{ id: string }>).some((offer) => offer.id === staleAcceptId), true);
  const [staleDelivery] = await db.select({ id: deliveriesTable.id }).from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, staleAcceptId));
  await db.update(driverDeliveryOfferAttemptsTable).set({ offerExpiresAt: expiredAt }).where(and(
    eq(driverDeliveryOfferAttemptsTable.deliveryId, staleDelivery.id),
    eq(driverDeliveryOfferAttemptsTable.driverId, driver.id),
  ));
  assert.equal((await request(`/api/driver/deliveries/${staleAcceptId}/accept`, {
    method: "POST",
    headers: bearer(profile),
  })).status, 409);
  const [staleAttempt] = await db.select().from(driverDeliveryOfferAttemptsTable).where(and(
    eq(driverDeliveryOfferAttemptsTable.deliveryId, staleDelivery.id),
    eq(driverDeliveryOfferAttemptsTable.driverId, driver.id),
  ));
  assert.equal(staleAttempt.response, "expired");
  assert.ok(staleAttempt.respondedAt, "stale acceptance persists the expiry outcome");
  const afterStaleAccept = await request("/api/driver/offers", { headers: bearer(profile) });
  assert.equal((afterStaleAccept.body as Array<{ id: string }>).some((offer) => offer.id === staleAcceptId), false);

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const concurrentId = await createAvailableOffer();
    const primaryOffers = await request("/api/driver/offers", { headers: bearer(profile) });
    assert.equal((primaryOffers.body as Array<{ id: string }>).some((offer) => offer.id === concurrentId), true);
    const [concurrentDelivery] = await db.select({ id: deliveriesTable.id }).from(deliveriesTable)
      .where(eq(deliveriesTable.publicDeliveryId, concurrentId));
    const concurrentExpiredAt = new Date(Date.now() - 1_000);
    await db.update(driverDeliveryOfferAttemptsTable).set({ offerExpiresAt: concurrentExpiredAt }).where(and(
      eq(driverDeliveryOfferAttemptsTable.deliveryId, concurrentDelivery.id),
      eq(driverDeliveryOfferAttemptsTable.driverId, driver.id),
    ));
    await db.update(deliveriesTable).set({ offerExpiresAt: concurrentExpiredAt })
      .where(eq(deliveriesTable.id, concurrentDelivery.id));

    const action = iteration % 2 === 0 ? "accept" : "decline";
    const [refresh, response] = await Promise.all([
      request("/api/driver/offers", { headers: bearer(otherProfile) }),
      request(`/api/driver/deliveries/${concurrentId}/${action}`, {
        method: "POST",
        headers: bearer(profile),
      }),
    ]);
    assert.ok([200, 409].includes(refresh.status), "refresh must succeed or return a safe retry response");
    assert.equal(response.status, 409, "stale accept and decline attempts must return a conflict");
    const [finalDelivery] = await db.select({
      driverId: deliveriesTable.driverId,
      deliveryStatus: deliveriesTable.deliveryStatus,
    }).from(deliveriesTable).where(eq(deliveriesTable.id, concurrentDelivery.id));
    const [finalAttempt] = await db.select().from(driverDeliveryOfferAttemptsTable).where(and(
      eq(driverDeliveryOfferAttemptsTable.deliveryId, concurrentDelivery.id),
      eq(driverDeliveryOfferAttemptsTable.driverId, driver.id),
    ));
    assert.equal(finalDelivery.driverId, null);
    assert.equal(finalDelivery.deliveryStatus, "searching_driver");
    assert.equal(finalAttempt.response, "expired");
    assert.ok(finalAttempt.respondedAt);
    if (action === "decline") {
      assert.equal((await request(`/api/driver/deliveries/${concurrentId}/decline`, {
        method: "POST",
        headers: bearer(profile),
      })).status, 409, "an already-expired attempt must remain a conflict");
    }
  }

  const acceptedId = await createAvailableOffer();
  const acceptedOffers = await request("/api/driver/offers", { headers: bearer(profile) });
  assert.equal((acceptedOffers.body as Array<{ id: string }>).some((offer) => offer.id === acceptedId), true);
  assert.equal((await request(`/api/driver/deliveries/${acceptedId}/accept`, {
    method: "POST",
    headers: bearer(profile),
  })).status, 200);
  const [acceptedDelivery] = await db.select({ id: deliveriesTable.id, driverId: deliveriesTable.driverId })
    .from(deliveriesTable).where(eq(deliveriesTable.publicDeliveryId, acceptedId));
  const [acceptedAttempt] = await db.select().from(driverDeliveryOfferAttemptsTable).where(and(
    eq(driverDeliveryOfferAttemptsTable.deliveryId, acceptedDelivery.id),
    eq(driverDeliveryOfferAttemptsTable.driverId, driver.id),
  ));
  assert.equal(acceptedDelivery.driverId, driver.id);
  assert.equal(acceptedAttempt.response, "accepted");
  assert.ok(acceptedAttempt.respondedAt);
  const performance = await request(
    `/api/admin/driver-performance/detail?driverId=${driver.id}&from=2020-01-01&to=2035-01-01`,
    { headers: bearer(admin) },
  );
  assert.equal(performance.status, 200);
  const acceptance = (performance.body as {
    performance: { acceptanceAccepted: number; acceptanceDeclined: number; acceptanceRate: number | null };
  }).performance;
  assert.equal(acceptance.acceptanceAccepted, 1);
  assert.equal(acceptance.acceptanceDeclined, 1);
  assert.equal(acceptance.acceptanceRate, 0.5, "expired race outcomes must not enter the acceptance denominator");
  setPickupRouteProviderForTests();
});

test("persists driver settings defaults and rejects invalid working-hour ranges", async () => {
  const profile = await createProfile("driver");
  await db.insert(driversTable).values({
    profileId: profile.id, onboardingStatus: "complete", availabilityStatus: "offline", approvalStatus: "approved",
  });

  const defaults = await request("/api/driver/settings", { headers: bearer(profile) });
  assert.equal(defaults.status, 200);
  assert.deepEqual((defaults.body as Record<string, unknown>).notificationSound, true);
  assert.deepEqual((defaults.body as Record<string, unknown>).vibration, true);
  assert.deepEqual((defaults.body as Record<string, unknown>).workingHoursEnabled, false);
  assert.deepEqual((defaults.body as Record<string, unknown>).navigationApp, "system");
  assert.deepEqual((defaults.body as Record<string, unknown>).preferredMaxRangeMiles, 12);
  assert.deepEqual((defaults.body as Record<string, unknown>).workingHours, {});

  const patch = {
    notificationSound: false, vibration: false, workingHoursEnabled: true,
    navigationApp: "waze", preferredMaxRangeMiles: 5,
    workingHours: { monday: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] },
  };
  const updated = await request("/api/driver/settings", {
    method: "PATCH", headers: bearer(profile), body: JSON.stringify(patch),
  });
  assert.equal(updated.status, 200);
  for (const [key, value] of Object.entries(patch)) {
    assert.deepEqual((updated.body as Record<string, unknown>)[key], value, `PATCH returns ${key}`);
  }
  const roundTrip = await request("/api/driver/settings", { headers: bearer(profile) });
  assert.equal(roundTrip.status, 200);
  assert.deepEqual(
    Object.fromEntries(Object.keys(patch).map((key) => [key, (roundTrip.body as Record<string, unknown>)[key]])),
    patch,
    "settings remain persisted across a subsequent GET",
  );
  for (const workingHours of [
    { monday: [{ start: "12:00", end: "12:00" }] },
    { monday: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }] },
    { someday: [{ start: "09:00", end: "10:00" }] },
  ]) {
    const invalid = await request("/api/driver/settings", {
      method: "PATCH", headers: bearer(profile), body: JSON.stringify({ workingHours }),
    });
    assert.equal(invalid.status, 400);
  }
});

test("dispatches staged, privacy-safe offers only to eligible live drivers", async () => {
  const priorDispatch = await db.select().from(dispatchSettingsTable).where(eq(dispatchSettingsTable.id, "dispatch")).limit(1);
  const makeDriver = async (availabilityStatus: "online" | "offline" = "online") => {
    const profile = await createProfile("driver");
    const [driver] = await db.insert(driversTable).values({
      profileId: profile.id, onboardingStatus: "complete", approvalStatus: "approved", availabilityStatus,
    }).returning();
    await seedCurrentComplianceDocuments(driver.id);
    return { profile, driver };
  };
  const makeOffer = async (elapsedSeconds: number) => {
    const id = await createAvailableOffer();
    const [delivery] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.publicDeliveryId, id));
    await db.update(deliveriesTable).set({
      dispatchStartedAt: new Date(Date.now() - elapsedSeconds * 1_000),
      offerExpiresAt: new Date(Date.now() + 60_000),
    }).where(eq(deliveriesTable.id, delivery.id));
    return { id, delivery };
  };
  try {
    await db.insert(dispatchSettingsTable).values({
      id: "dispatch", initialRadiusMiles: 3, maximumRadiusMiles: 12, initialDurationSeconds: 30,
      expansionStages: [{ radiusMiles: 5, durationSeconds: 30 }, { radiusMiles: 8, durationSeconds: 60 }, { radiusMiles: 12, durationSeconds: 480 }],
      maximumPickupEtaMinutes: 15, totalExpirationSeconds: 600,
    }).onConflictDoUpdate({
      target: dispatchSettingsTable.id,
      set: { initialRadiusMiles: 3, maximumRadiusMiles: 12, initialDurationSeconds: 30, expansionStages: [{ radiusMiles: 5, durationSeconds: 30 }, { radiusMiles: 8, durationSeconds: 60 }, { radiusMiles: 12, durationSeconds: 480 }], maximumPickupEtaMinutes: 15, totalExpirationSeconds: 600 },
    });
    setPickupRouteProviderForTests(async (origin) => ({
      distanceMiles: origin.latitude, minutes: origin.longitude, source: "road",
    }));
    const primary = await makeDriver();
    const heartbeat = await request("/api/driver/location", {
      method: "PATCH", headers: bearer(primary.profile),
      body: JSON.stringify({ latitude: 3, longitude: 10, capturedAt: new Date().toISOString() }),
    });
    assert.equal(heartbeat.status, 200, "a current approved online driver heartbeat is accepted");
    for (const [elapsed, radius] of [[0, 3], [30, 5], [60, 8], [120, 12]] as const) {
      const offer = await makeOffer(elapsed);
      await db.update(driversTable).set({ currentLatitude: radius, currentLongitude: 10, lastLocationUpdate: new Date() })
        .where(eq(driversTable.id, primary.driver.id));
      const listed = await request("/api/driver/offers", { headers: bearer(primary.profile) });
      assert.equal(listed.status, 200);
      const item = (listed.body as Array<Record<string, unknown>>).find((candidate) => candidate.id === offer.id);
      assert.ok(item, `the ${elapsed}s stage includes its exact ${radius}-mile boundary`);
      const serialized = JSON.stringify(item);
      assert.equal(serialized.includes(deliveryBody.pickupAddress), false);
      assert.equal(serialized.includes(deliveryBody.dropoffAddress), false);
      assert.equal(serialized.includes(customer.email), false, "offers omit customer identity");
    }

    const capOffer = await makeOffer(120);
    await db.update(driversTable).set({ currentLatitude: 8, currentLongitude: 10, lastLocationUpdate: new Date() })
      .where(eq(driversTable.id, primary.driver.id));
    await request("/api/driver/settings", { method: "PATCH", headers: bearer(primary.profile), body: JSON.stringify({ preferredMaxRangeMiles: 5 }) });
    assert.equal(((await request("/api/driver/offers", { headers: bearer(primary.profile) })).body as Array<{ id: string }>)
      .some((offer: { id: string }) => offer.id === capOffer.id), false, "driver preference caps the staged radius");
    await request("/api/driver/settings", { method: "PATCH", headers: bearer(primary.profile), body: JSON.stringify({ preferredMaxRangeMiles: 12 }) });
    const etaOffer = await makeOffer(120);
    await db.update(driversTable).set({ currentLatitude: 3, currentLongitude: 16, lastLocationUpdate: new Date() })
      .where(eq(driversTable.id, primary.driver.id));
    assert.equal(((await request("/api/driver/offers", { headers: bearer(primary.profile) })).body as Array<{ id: string }>)
      .some((offer: { id: string }) => offer.id === etaOffer.id), false, "pickup ETA maximum excludes slow routes");

    await db.update(driversTable).set({ currentLatitude: 3, currentLongitude: 10, lastLocationUpdate: new Date(Date.now() - 6 * 60_000) })
      .where(eq(driversTable.id, primary.driver.id));
    assert.deepEqual((await request("/api/driver/offers", { headers: bearer(primary.profile) })).body, [], "stale locations receive no offers");
    const staleHeartbeat = await request("/api/driver/location", {
      method: "PATCH", headers: bearer(primary.profile),
      body: JSON.stringify({ latitude: 3, longitude: 10, capturedAt: new Date(Date.now() - 16 * 60_000).toISOString() }),
    });
    assert.equal(staleHeartbeat.status, 400);
    await db.update(driversTable).set({ availabilityStatus: "offline" }).where(eq(driversTable.id, primary.driver.id));
    assert.equal((await request("/api/driver/location", { method: "PATCH", headers: bearer(primary.profile), body: JSON.stringify({ latitude: 3, longitude: 10 }) })).status, 403);
    assert.equal((await request("/api/driver/offers", { headers: bearer(primary.profile) })).status, 403, "offline drivers are excluded");
    const unapproved = await makeDriver();
    await db.update(driversTable).set({ approvalStatus: "pending" }).where(eq(driversTable.id, unapproved.driver.id));
    assert.equal((await request("/api/driver/location", { method: "PATCH", headers: bearer(unapproved.profile), body: JSON.stringify({ latitude: 3, longitude: 10 }) })).status, 403);
    assert.equal((await request("/api/driver/offers", { headers: bearer(unapproved.profile) })).status, 403, "unapproved drivers are excluded");
    const nonCompliant = await makeDriver();
    await db.delete(driverDocumentsTable).where(eq(driverDocumentsTable.driverId, nonCompliant.driver.id));
    assert.equal((await request("/api/driver/offers", { headers: bearer(nonCompliant.profile) })).status, 403, "drivers without current compliance are excluded");

    await db.update(driversTable).set({ availabilityStatus: "online", currentLatitude: 3, currentLongitude: 10, lastLocationUpdate: new Date() }).where(eq(driversTable.id, primary.driver.id));
    await request("/api/driver/settings", { method: "PATCH", headers: bearer(primary.profile), body: JSON.stringify({ workingHoursEnabled: true, workingHours: {} }) });
    assert.deepEqual((await request("/api/driver/offers", { headers: bearer(primary.profile) })).body, [], "an enabled empty schedule excludes the driver");
    await request("/api/driver/settings", { method: "PATCH", headers: bearer(primary.profile), body: JSON.stringify({ workingHoursEnabled: false }) });
    await db.update(profilesTable).set({ status: "suspended" }).where(eq(profilesTable.id, primary.profile.id));
    assert.equal(
      (await request("/api/driver/offers", { headers: bearer(primary.profile) })).status,
      401,
      "suspension revokes the driver's authenticated session before offer eligibility is evaluated",
    );

    const expired = await makeOffer(0);
    const visibleA = await makeDriver();
    const visibleB = await makeDriver();
    for (const fixture of [visibleA, visibleB]) {
      await request("/api/driver/location", { method: "PATCH", headers: bearer(fixture.profile), body: JSON.stringify({ latitude: 3, longitude: 10 }) });
    }
    assert.equal(((await request("/api/driver/offers", { headers: bearer(visibleA.profile) })).body as Array<{ id: string }>)
      .some((offer) => offer.id === expired.id), true);
    await db.update(deliveriesTable).set({ dispatchStartedAt: new Date(Date.now() - 601_000) })
      .where(eq(deliveriesTable.id, expired.delivery.id));
    assert.equal(((await request("/api/driver/offers", { headers: bearer(visibleA.profile) })).body as Array<{ id: string }>)
      .some((offer) => offer.id === expired.id), false);
    const [expiredRow] = await db.select({ deliveryStatus: deliveriesTable.deliveryStatus }).from(deliveriesTable).where(eq(deliveriesTable.id, expired.delivery.id));
    assert.equal(expiredRow.deliveryStatus, "searching_driver", "terminal expiry leaves the unassigned search record intact");
    const [expiredAttempt] = await db.select({ response: driverDeliveryOfferAttemptsTable.response, respondedAt: driverDeliveryOfferAttemptsTable.respondedAt })
      .from(driverDeliveryOfferAttemptsTable).where(and(eq(driverDeliveryOfferAttemptsTable.deliveryId, expired.delivery.id), eq(driverDeliveryOfferAttemptsTable.driverId, visibleA.driver.id)));
    assert.deepEqual({ response: expiredAttempt.response, terminal: expiredAttempt.respondedAt !== null }, { response: "expired", terminal: true });

    const contested = await makeOffer(0);
    const visibility = await Promise.all([visibleA, visibleB].map((fixture) => request("/api/driver/offers", { headers: bearer(fixture.profile) })));
    assert.equal(visibility.every((response) => (response.body as Array<{ id: string }>).some((offer) => offer.id === contested.id)), true);
    const accepted = await Promise.all([visibleA, visibleB].map((fixture) => request(`/api/driver/deliveries/${contested.id}/accept`, { method: "POST", headers: bearer(fixture.profile) })));
    assert.deepEqual(accepted.map((response) => response.status).sort(), [200, 409]);
    const attempts = await db.select({ response: driverDeliveryOfferAttemptsTable.response, respondedAt: driverDeliveryOfferAttemptsTable.respondedAt })
      .from(driverDeliveryOfferAttemptsTable).where(eq(driverDeliveryOfferAttemptsTable.deliveryId, contested.delivery.id));
    assert.equal(attempts.length, 2);
    assert.equal(attempts.filter((attempt) => attempt.response === "accepted").length, 1);
    assert.equal(attempts.every((attempt) => attempt.response !== "offered" && attempt.respondedAt !== null), true, "all losing simultaneous offers become terminal");
    const winner = accepted.findIndex((response) => response.status === 200);
    assert.deepEqual(
      (await request("/api/driver/offers", { headers: bearer([visibleA, visibleB][winner]!.profile) })).body,
      [],
      "a driver with an active assignment is at capacity",
    );
  } finally {
    setPickupRouteProviderForTests();
    if (priorDispatch[0]) await db.update(dispatchSettingsTable).set(priorDispatch[0]).where(eq(dispatchSettingsTable.id, "dispatch"));
    else await db.delete(dispatchSettingsTable).where(eq(dispatchSettingsTable.id, "dispatch"));
  }
});

test("driver rewards award, transition, wallet, summary, and performance regressions", async () => {
  const performanceSearch = `RewardsPage${runId.replaceAll("-", "").slice(0, 10)}`;
  const acceptedProfile = await createProfile("driver");
  const noResponseProfile = await createProfile("driver");
  await db.update(profilesTable).set({ firstName: performanceSearch, lastName: "Alpha" }).where(eq(profilesTable.id, acceptedProfile.id));
  await db.update(profilesTable).set({ firstName: performanceSearch, lastName: "Beta" }).where(eq(profilesTable.id, noResponseProfile.id));
  const [acceptedDriver, noResponseDriver] = await db.insert(driversTable).values([
    { profileId: acceptedProfile.id, onboardingStatus: "complete", availabilityStatus: "offline", approvalStatus: "approved" },
    { profileId: noResponseProfile.id, onboardingStatus: "complete", availabilityStatus: "offline", approvalStatus: "approved" },
  ]).returning();
  const offeredDeliveries = await Promise.all([createAvailableOffer(), createAvailableOffer(), createAvailableOffer(), createAvailableOffer()]);
  const offeredDeliveryRows = await db.select({ id: deliveriesTable.id, publicDeliveryId: deliveriesTable.publicDeliveryId })
    .from(deliveriesTable).where(inArray(deliveriesTable.publicDeliveryId, offeredDeliveries));
  const deliveryIdByPublicId = new Map(offeredDeliveryRows.map((delivery) => [delivery.publicDeliveryId, delivery.id]));
  await db.insert(driverDeliveryOfferAttemptsTable).values([
    { deliveryId: deliveryIdByPublicId.get(offeredDeliveries[0])!, driverId: acceptedDriver.id, response: "accepted", respondedAt: new Date(), offerExpiresAt: new Date("2035-01-01T00:00:00.000Z") },
    { deliveryId: deliveryIdByPublicId.get(offeredDeliveries[1])!, driverId: acceptedDriver.id, response: "declined", respondedAt: new Date(), offerExpiresAt: new Date("2035-01-01T00:00:00.000Z") },
    { deliveryId: deliveryIdByPublicId.get(offeredDeliveries[2])!, driverId: acceptedDriver.id, response: "expired", respondedAt: new Date(), offerExpiresAt: new Date() },
    { deliveryId: deliveryIdByPublicId.get(offeredDeliveries[3])!, driverId: acceptedDriver.id, response: "accepted", respondedAt: new Date("2019-12-31T23:59:59.000Z"), offeredAt: new Date("2019-12-31T23:59:59.000Z"), offerExpiresAt: new Date("2020-01-01T00:01:59.000Z") },
  ]);

  const award = { driverId: assignedDriverId, amountCents: 725, type: "on_time", reason: "Reliable completed delivery" };
  const key = `reward-${randomUUID()}`;
  const paymentsBefore = await db.select({ id: paymentsTable.id, amount: paymentsTable.amount, status: paymentsTable.status }).from(paymentsTable).where(eq(paymentsTable.customerId, customer.id));
  for (const actor of [customer, assignedDriver, support, dispatcher]) {
    assert.equal((await request("/api/admin/driver-bonuses", { method: "POST", headers: { ...bearer(actor), "idempotency-key": randomUUID() }, body: JSON.stringify(award) })).status, 403);
  }
  assert.equal((await request("/api/admin/driver-bonuses", { method: "POST", headers: bearer(admin), body: JSON.stringify(award) })).status, 400);
  for (const invalid of [{ ...award, amountCents: 0 }, { ...award, amountCents: -1 }, { ...award, amountCents: 100000001 }, { ...award, type: "invalid" }, { ...award, reason: "x" }, { ...award, performancePeriodStart: "2027-01-02T00:00:00.000Z", performancePeriodEnd: "2027-01-01T00:00:00.000Z" }]) {
    assert.equal((await request("/api/admin/driver-bonuses", { method: "POST", headers: { ...bearer(admin), "idempotency-key": randomUUID() }, body: JSON.stringify(invalid) })).status, 400);
  }
  assert.equal((await request("/api/admin/driver-bonuses", { method: "POST", headers: { ...bearer(admin), "idempotency-key": randomUUID() }, body: JSON.stringify({ ...award, driverId: randomUUID() }) })).status, 422);
  const create = await request("/api/admin/driver-bonuses", { method: "POST", headers: { ...bearer(admin), "idempotency-key": key }, body: JSON.stringify(award) });
  assert.equal(create.status, 201);
  const bonus = create.body as { id: string; status: string };
  assert.equal(bonus.status, "pending");
  for (const malformedId of ["undefined", "not-a-uuid"]) {
    const detail = await request(`/api/admin/driver-bonuses/${malformedId}`, { headers: bearer(admin) });
    assert.equal(detail.status, 400);
    assert.deepEqual(detail.body, { error: "Invalid driver bonus identifier." });

    const transition = await request(`/api/admin/driver-bonuses/${malformedId}/status`, {
      method: "POST",
      headers: { ...bearer(admin), "idempotency-key": randomUUID() },
      body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(transition.status, 400);
    assert.deepEqual(transition.body, { error: "Invalid driver bonus identifier." });
  }
  const replay = await request("/api/admin/driver-bonuses", { method: "POST", headers: { ...bearer(admin), "idempotency-key": key }, body: JSON.stringify(award) });
  assert.equal(replay.status, 200); assert.equal((replay.body as { id: string }).id, bonus.id);
  assert.equal((await request("/api/admin/driver-bonuses", { method: "POST", headers: { ...bearer(admin), "idempotency-key": key }, body: JSON.stringify({ ...award, amountCents: 726 }) })).status, 409);
  const concurrentKey = `concurrent-${randomUUID()}`;
  const concurrent = await Promise.all([0, 1].map(() => request("/api/admin/driver-bonuses", { method: "POST", headers: { ...bearer(admin), "idempotency-key": concurrentKey }, body: JSON.stringify({ ...award, amountCents: 726, reason: "Concurrent exact reward" }) })));
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 201]);
  assert.equal((concurrent[0].body as { id: string }).id, (concurrent[1].body as { id: string }).id);
  assert.equal((await request("/api/admin/driver-bonuses?search=Test%20driver", { headers: bearer(dispatcher) })).status, 200);
  const wallet = await request("/api/driver/bonuses", { headers: bearer(assignedDriver) });
  assert.ok((wallet.body as { transactions: Array<{ id: string; label: string }> }).transactions.some((row) => row.id === bonus.id && row.label === "Bonus"));
  assert.equal((await request("/api/driver/bonuses", { headers: bearer(unassignedDriver) }).then((result) => (result.body as { transactions: Array<{ id: string }> }).transactions.some((row) => row.id === bonus.id))), false);
  const status = (next: string, transitionKey: string, reason?: string) => request(`/api/admin/driver-bonuses/${bonus.id}/status`, { method: "POST", headers: { ...bearer(admin), "idempotency-key": transitionKey }, body: JSON.stringify({ status: next, ...(reason ? { reason } : {}) }) });
  assert.equal((await status("paid", randomUUID())).status, 409);
  const approveKey = `approve-${randomUUID()}`;
  assert.equal((await status("approved", approveKey)).status, 200);
  assert.equal((await status("approved", approveKey)).status, 200);
  assert.equal((await status("paid", `paid-${randomUUID()}`)).status, 200);
  assert.equal((await status("paid", approveKey)).status, 409);
  assert.equal((await status("reversed", `reverse-${randomUUID()}`)).status, 400);
  assert.equal((await status("reversed", `reverse-${randomUUID()}`, "Payout correction")).status, 200);
  assert.equal((await status("approved", randomUUID())).status, 409);
  const detail = await request(`/api/admin/driver-bonuses/${bonus.id}`, { headers: bearer(admin) });
  assert.deepEqual((detail.body as { events: Array<{ type: string }> }).events.map((event) => event.type), ["created", "approved", "paid", "reversed"]);
  assert.equal((await db.select().from(driverBonusesTable).where(eq(driverBonusesTable.id, bonus.id)))[0]?.status, "reversed");
  assert.equal((await db.select().from(adminAuditLogsTable).where(eq(adminAuditLogsTable.entityId, bonus.id))).filter((audit) => audit.entityType === "driver_bonus").length, 4);
  assert.ok((await request("/api/admin/driver-bonuses/summary", { headers: bearer(admin) })).body as { reversedCents: number });
  const paymentsAfter = await db.select({ id: paymentsTable.id, amount: paymentsTable.amount, status: paymentsTable.status }).from(paymentsTable).where(eq(paymentsTable.customerId, customer.id));
  assert.deepEqual(paymentsAfter, paymentsBefore, "bonus actions never alter customer payments or tips");
  for (const invalidQuery of ["page=0", "pageSize=0", "pageSize=101"]) {
    assert.equal((await request(`/api/admin/driver-performance?${invalidQuery}`, { headers: bearer(dispatcher) })).status, 400);
  }
  assert.equal((await request(`/api/admin/driver-performance?search=${performanceSearch}&from=2030-01-01&to=2020-01-01`, { headers: bearer(dispatcher) })).status, 400);
  const performancePath = `/api/admin/driver-performance?search=${performanceSearch}&from=2020-01-01&to=2030-01-01`;
  const fullPerformance = await request(performancePath, { headers: bearer(dispatcher) });
  assert.equal(fullPerformance.status, 200);
  const performanceRows = fullPerformance.body as Array<{
    driverId: string;
    acceptanceRate: number | null;
    acceptanceAccepted: number;
    acceptanceDeclined: number;
    acceptanceDefinition: string;
    onTimeDefinition: string;
  }>;
  assert.deepEqual(performanceRows.map((row) => row.driverId), [acceptedDriver.id, noResponseDriver.id]);
  assert.equal(performanceRows[0].acceptanceAccepted, 1);
  assert.equal(performanceRows[0].acceptanceDeclined, 1);
  assert.equal(performanceRows[0].acceptanceRate, 0.5, "expired offers must not enter the accepted plus declined denominator");
  assert.equal(performanceRows[1].acceptanceRate, null);
  assert.equal(performanceRows[1].acceptanceAccepted, 0);
  assert.equal(performanceRows[1].acceptanceDeclined, 0);
  assert.ok(performanceRows[0].acceptanceDefinition.includes("persisted") && performanceRows[0].onTimeDefinition.includes("assignedAt"));
  const broadPerformance = await request(`/api/admin/driver-performance?search=${performanceSearch}&from=2010-01-01&to=2030-01-01`, { headers: bearer(dispatcher) });
  assert.equal(((broadPerformance.body as Array<{ acceptanceAccepted: number }>)[0]?.acceptanceAccepted), 2);
  const narrowDetail = await request(`/api/admin/driver-performance/detail?driverId=${acceptedDriver.id}&from=2020-01-01&to=2030-01-01`, { headers: bearer(admin) });
  assert.equal(narrowDetail.status, 200);
  assert.equal((narrowDetail.body as { performance: { acceptanceAccepted: number } }).performance.acceptanceAccepted, 1);
  const firstPage = await request(`${performancePath}&page=1&pageSize=1`, { headers: bearer(dispatcher) });
  const secondPage = await request(`${performancePath}&page=2&pageSize=1`, { headers: bearer(dispatcher) });
  const emptyPage = await request(`${performancePath}&page=3&pageSize=1`, { headers: bearer(dispatcher) });
  assert.equal(firstPage.status, 200);
  assert.equal(secondPage.status, 200);
  assert.equal(emptyPage.status, 200);
  assert.deepEqual((firstPage.body as Array<{ driverId: string }>).map((row) => row.driverId), [acceptedDriver.id]);
  assert.deepEqual((secondPage.body as Array<{ driverId: string }>).map((row) => row.driverId), [noResponseDriver.id]);
  assert.deepEqual(emptyPage.body, []);
  assert.equal((await request(`/api/admin/driver-performance/detail?driverId=${assignedDriverId}&from=2020-01-01&to=2030-01-01`, { headers: bearer(admin) })).status, 200);
});
