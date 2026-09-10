import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  adminAuditLogsTable,
  customerAddressesTable,
  db,
  deliveryQuotesTable,
  deliveryStatusHistoryTable,
  deliveryVerificationsTable,
  deliveriesTable,
  driverLocationsTable,
  driversTable,
  notificationsTable,
  paymentsTable,
  paymentFeeSettingsTable,
  promoCodesTable,
  promotionRedemptionsTable,
  profilesTable,
  type DeliveryRecord,
} from "@workspace/db";
import {
  PROHIBITED_ITEMS_CONFIRMATION_ERROR,
  PROHIBITED_ITEMS_POLICY_VERSION,
} from "@workspace/api-zod";
import { publishDeliveryEvent, recordDeliveryEvent, type DeliveryEvent } from "./delivery-events";
import { hasCurrentDriverCompliance } from "./driver-compliance";
import { getUncachableStripeClient } from "./stripe-client";

export type DeliveryStatus =
  | "draft"
  | "quoted"
  | "payment_pending"
  | "paid"
  | "searching_driver"
  | "driver_assigned"
  | "driver_en_route_pickup"
  | "driver_arrived_pickup"
  | "pickup_verified"
  | "picked_up"
  | "in_transit"
  | "driver_arrived_delivery"
  | "delivery_verification_pending"
  | "delivered"
  | "cancelled"
  | "failed"
  | "refunded";

const recipientVerificationTtlMs = 15 * 60 * 1_000;

function recipientVerificationCode(deliveryId: string, expiresAt: Date): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("SESSION_SECRET is required for recipient verification.");
  const digest = createHmac("sha256", secret)
    .update(`${deliveryId}:${expiresAt.getTime()}`)
    .digest();
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
}

function recipientVerificationHash(deliveryId: string, code: string): string {
  return createHash("sha256").update(`${deliveryId}:${code}`).digest("hex");
}

type QuoteInput = {
  pickupAddress: string;
  dropoffAddress: string;
  category: string;
  size: "small" | "medium" | "large";
  weight: "under5" | "5to20" | "20to50";
  care: "standard" | "fragile" | "priority" | "temperature";
  priority: "asap" | "scheduled";
  scheduledPickupStartAt?: string | Date | null;
  scheduledPickupEndAt?: string | Date | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  dropoffLatitude?: number | null;
  dropoffLongitude?: number | null;
  mapMode?: "verified" | "demo";
};
export type QuoteFeePolicy = {
  deliveryFeeCents: number; customerServiceFeeCents: number; smallOrderThresholdCents: number;
  smallOrderFeeCents: number; taxRateBasisPoints: number; updatedAt: string;
};

type DeliveryInput = QuoteInput & {
  quoteId: string;
  pickupName: string;
  pickupPhone: string;
  pickupInstructions?: string;
  recipientName: string;
  recipientPhone: string;
  deliveryInstructions?: string;
  promotionCode?: string;
  prohibitedItemsConfirmed: boolean;
};

type ApiDelivery = {
  id: string;
  orderNumber: string;
  pickupAddress: string;
  dropoffAddress: string;
  category: string;
  care: string;
  total: number;
  status: string;
  eta: string;
  createdAt: string;
  recipientName: string;
  driverName: string | null;
  driverRating: number | null;
  vehicle: string | null;
  pickupContactName: string;
  pickupContactPhone: string;
  pickupInstructions: string | null;
  recipientPhone: string;
  deliveryInstructions: string | null;
  size: string;
  weight: string;
  deliveryDistanceMiles: number | null;
  expectedMinutes: number | null;
  scheduledPickupStartAt: string | null;
  scheduledPickupEndAt: string | null;
    pickupLatitude: number | null;
    pickupLongitude: number | null;
    dropoffLatitude: number | null;
    dropoffLongitude: number | null;
    mapMode: "verified" | "demo";
    driverLocation: {
      id: string;
      deliveryId: string;
      latitude: number;
      longitude: number;
      accuracyMeters: number | null;
      capturedAt: string;
    } | null;
  prohibitedItemsConfirmed: boolean;
  prohibitedItemsConfirmedAt: string | null;
  prohibitedItemsPolicyVersion: string | null;
  events: Array<{ label: string; completed: boolean; time: string | null }>;
};

export type StaffDelivery = Pick<ApiDelivery,
  | "id"
  | "orderNumber"
  | "pickupAddress"
  | "dropoffAddress"
  | "category"
  | "care"
  | "status"
  | "eta"
  | "createdAt"
  | "driverName"
  | "vehicle"
  | "size"
  | "weight"
  | "deliveryDistanceMiles"
  | "expectedMinutes"
   | "scheduledPickupStartAt"
   | "scheduledPickupEndAt"
  | "pickupLatitude"
  | "pickupLongitude"
  | "dropoffLatitude"
  | "dropoffLongitude"
  | "mapMode"
  | "events"
> & {
  driverId: string | null;
  priority: "asap" | "scheduled";
  updatedAt: string;
  isDelayed: boolean;
  driverLocation: {
    id: string;
    deliveryId: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
    capturedAt: string;
  } | null;
};

type DispatchAlertType = "delivery_failed" | "delivery_cancelled" | "delivery_delayed";
type DispatchAlert = {
  id: string;
  deliveryId: string;
  orderNumber: string;
  type: DispatchAlertType;
  title: string;
  message: string;
  recommendedAction: string;
  createdAt: string;
  acknowledgedAt: string | null;
};

const dispatchAlertDetails: Record<DispatchAlertType, {
  title: string;
  recommendedAction: string;
  message: (orderNumber: string) => string;
}> = {
  delivery_failed: {
    title: "Delivery failed",
    message: (orderNumber) => `Order ${orderNumber} could not be completed.`,
    recommendedAction: "Contact the driver and customer, then update the route plan.",
  },
  delivery_cancelled: {
    title: "Delivery cancelled",
    message: (orderNumber) => `Order ${orderNumber} was cancelled before completion.`,
    recommendedAction: "Review the cancellation reason and coordinate any return or refund.",
  },
  delivery_delayed: {
    title: "Route is delayed",
    message: (orderNumber) => `Order ${orderNumber} is taking longer than its expected delivery window.`,
    recommendedAction: "Check the driver’s progress and update the customer with a new ETA.",
  },
};

const dispatchAlertTypes = Object.keys(dispatchAlertDetails) as DispatchAlertType[];

type DispatchAlertWriter = Pick<typeof db, "select" | "insert">;

export async function createDispatchAlertsForDelivery(
  tx: DispatchAlertWriter,
  delivery: Pick<DeliveryRecord, "id" | "orderNumber">,
  type: Extract<DispatchAlertType, "delivery_failed" | "delivery_cancelled">,
): Promise<void> {
  const staff = await tx
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(inArray(profilesTable.role, ["admin", "dispatcher"]));
  const details = dispatchAlertDetails[type];
  const notifications = staff.map((profile) => ({
    profileId: profile.id,
    deliveryId: delivery.id,
    type,
    title: details.title,
    body: details.message(delivery.orderNumber),
  }));
  if (notifications.length) {
    await tx.insert(notificationsTable).values(notifications);
  }
}

const statusLabels: Array<{ status: DeliveryStatus; label: string }> = [
  { status: "driver_assigned", label: "Driver assigned" },
  { status: "driver_en_route_pickup", label: "Driver arriving" },
  { status: "picked_up", label: "Package picked up" },
  { status: "in_transit", label: "On the way" },
  { status: "driver_arrived_delivery", label: "Arriving" },
  { status: "delivered", label: "Delivered" },
];

const stateTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
  draft: ["quoted", "cancelled"],
  quoted: ["payment_pending", "cancelled"],
  payment_pending: ["paid", "failed", "cancelled"],
  paid: ["searching_driver", "refunded"],
  searching_driver: ["driver_assigned", "cancelled", "refunded"],
  driver_assigned: ["driver_en_route_pickup", "cancelled"],
  driver_en_route_pickup: ["driver_arrived_pickup", "cancelled"],
  driver_arrived_pickup: ["pickup_verified", "cancelled"],
  pickup_verified: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "failed"],
  in_transit: ["driver_arrived_delivery", "failed"],
  driver_arrived_delivery: ["delivery_verification_pending", "delivered", "failed"],
  delivery_verification_pending: ["delivered", "failed"],
  delivered: ["refunded"],
  cancelled: [],
  failed: ["refunded"],
  refunded: [],
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function generatedOrderNumber(): string {
  return `AA-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function estimatedDurationMinutesFor(priority: QuoteInput["priority"]): number {
  return priority === "asap" ? 60 : 90;
}

export function quoteFor(input: QuoteInput, policy?: QuoteFeePolicy) {
  const baseFare = input.priority === "asap" ? 10 : 8;
  const sizeFee = input.size === "large" ? 8 : input.size === "medium" ? 5.5 : 3.75;
  const weightFee = input.weight === "20to50" ? 6 : input.weight === "5to20" ? 2.5 : 0;
  const careFee =
    input.care === "temperature" ? 8 : input.care === "priority" ? 5 : input.care === "fragile" ? 3 : 0;
  const configured = policy ?? { deliveryFeeCents: 0, customerServiceFeeCents: 0, smallOrderThresholdCents: 0, smallOrderFeeCents: 0, taxRateBasisPoints: 725, updatedAt: "legacy" };
  const operationalSubtotal = baseFare + sizeFee + weightFee + careFee;
  const deliveryFee = configured.deliveryFeeCents / 100;
  const customerServiceFee = configured.customerServiceFeeCents / 100;
  const smallOrderFee = operationalSubtotal * 100 < configured.smallOrderThresholdCents ? configured.smallOrderFeeCents / 100 : 0;
  const subtotal = operationalSubtotal + deliveryFee + customerServiceFee + smallOrderFee;
  const tax = money(subtotal * (configured.taxRateBasisPoints / 10_000));
  return {
    baseFare: money(baseFare),
    distanceFee: money(sizeFee + weightFee),
    careFee: money(careFee),
    deliveryFee: money(deliveryFee),
    customerServiceFee: money(customerServiceFee),
    smallOrderFee: money(smallOrderFee),
    policyUpdatedAt: configured.updatedAt,
    tax,
    discount: 0,
    total: money(subtotal + tax),
    eta: input.priority === "asap" ? "Pickup in 25–35 min" : "Choose a time that works for you",
    paymentMode: process.env.PAYMENTS_TEST_MODE === "true" ? ("test" as const) : ("stripe" as const),
  };
}

export function validatePickupWindow(input: Pick<QuoteInput, "priority" | "scheduledPickupStartAt" | "scheduledPickupEndAt">): void {
  const startValue = input.scheduledPickupStartAt ?? null;
  const endValue = input.scheduledPickupEndAt ?? null;
  if (input.priority === "asap") {
    if (startValue !== null || endValue !== null) throw new DeliveryValidationError("ASAP deliveries must not include a pickup window.");
    return;
  }
  if (!startValue || !endValue) throw new DeliveryValidationError("Scheduled deliveries require both pickup window timestamps.");
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new DeliveryValidationError("Pickup window timestamps must be valid ISO date-times.");
  }
  const now = Date.now();
  if (start.getTime() < now) throw new DeliveryValidationError("Pickup window start cannot be in the past.");
  if (start >= end) throw new DeliveryValidationError("Pickup window start must be before its end.");
  // Prevent accidental dates years in the future while leaving ample planning room.
  if (end.getTime() > now + 90 * 24 * 60 * 60 * 1000) {
    throw new DeliveryValidationError("Pickup window must be within 90 days.");
  }
}

export type PromotionRedemptionInput = {
  promotionCode: string;
  savingsAmount: number;
  deliveryId: string;
  redeemedAt?: Date;
};
export async function persistQuote(customerId: string, input: QuoteInput, policy?: QuoteFeePolicy) {
  validatePickupWindow(input);
  const quote = quoteFor(input, policy);
  const [stored] = await db.insert(deliveryQuotesTable).values({
    customerId,
    request: Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ),
    response: quote,
    scheduledPickupStartAt: input.scheduledPickupStartAt ? new Date(input.scheduledPickupStartAt) : null,
    scheduledPickupEndAt: input.scheduledPickupEndAt ? new Date(input.scheduledPickupEndAt) : null,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  }).returning({ id: deliveryQuotesTable.id });
  return {
    id: stored.id,
    ...quote,
    scheduledPickupStartAt: input.scheduledPickupStartAt
      ? new Date(input.scheduledPickupStartAt).toISOString()
      : null,
    scheduledPickupEndAt: input.scheduledPickupEndAt
      ? new Date(input.scheduledPickupEndAt).toISOString()
      : null,
  };
}

async function deliveryEvents(deliveryId: string, currentStatus: DeliveryStatus) {
  const history = await db
    .select()
    .from(deliveryStatusHistoryTable)
    .where(eq(deliveryStatusHistoryTable.deliveryId, deliveryId))
    .orderBy(asc(deliveryStatusHistoryTable.createdAt));
  const seen = new Map(history.map((item) => [item.toStatus, item.createdAt.toISOString()]));
  return statusLabels.map(({ status, label }) => ({
    label,
    completed: seen.has(status) || currentStatus === status || isPast(currentStatus, status),
    time: seen.get(status) ?? null,
  }));
}

function isPast(current: DeliveryStatus, target: DeliveryStatus): boolean {
  const currentIndex = statusLabels.findIndex((item) => item.status === current);
  const targetIndex = statusLabels.findIndex((item) => item.status === target);
  return currentIndex > targetIndex && currentIndex !== -1 && targetIndex !== -1;
}

export async function mapDelivery(delivery: DeliveryRecord): Promise<ApiDelivery> {
  let driverName: string | null = null;
  let driverRating: number | null = null;
  let vehicle: string | null = null;
  if (delivery.driverId) {
    const [driver] = await db
      .select({
        firstName: profilesTable.firstName,
        lastName: profilesTable.lastName,
        rating: driversTable.rating,
        vehicleMake: driversTable.vehicleMake,
        vehicleModel: driversTable.vehicleModel,
        vehicleColor: driversTable.vehicleColor,
      })
      .from(driversTable)
      .innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
      .where(eq(driversTable.id, delivery.driverId))
      .limit(1);
    if (driver) {
      driverName = `${driver.firstName} ${driver.lastName.charAt(0)}.`;
      driverRating = driver.rating;
      vehicle = [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(" ") || null;
    }
  }
  const [latestLocation] = isTerminalDeliveryStatus(delivery.deliveryStatus)
    ? [undefined]
    : await db
      .select()
      .from(driverLocationsTable)
      .where(eq(driverLocationsTable.deliveryId, delivery.id))
      .orderBy(desc(driverLocationsTable.capturedAt))
      .limit(1);
  return {
    id: delivery.publicDeliveryId,
    orderNumber: delivery.orderNumber,
    pickupAddress: delivery.pickupAddress,
    dropoffAddress: delivery.dropoffAddress,
    category: delivery.packageCategory,
    care: delivery.careLevel,
    total: Number(delivery.totalPrice),
    status: delivery.deliveryStatus,
    eta: delivery.deliveryStatus === "delivered" ? "Delivered" : "45–60 min",
    createdAt: delivery.createdAt.toISOString(),
    recipientName: delivery.recipientName,
    driverName,
    driverRating,
    vehicle,
    pickupContactName: delivery.pickupContactName,
    pickupContactPhone: delivery.pickupContactPhone,
    pickupInstructions: delivery.pickupInstructions,
    recipientPhone: delivery.recipientPhone,
    deliveryInstructions: delivery.deliveryInstructions,
    size: delivery.sizeCategory,
    weight: delivery.weightCategory,
    deliveryDistanceMiles: delivery.distanceMiles === null ? null : Number(delivery.distanceMiles),
    expectedMinutes: delivery.estimatedDurationMinutes === null ? null : Number(delivery.estimatedDurationMinutes),
    scheduledPickupStartAt: delivery.scheduledPickupStartAt?.toISOString() ?? null,
    scheduledPickupEndAt: delivery.scheduledPickupEndAt?.toISOString() ?? null,
    pickupLatitude: delivery.mapMode === "verified" ? delivery.pickupLatitude : null,
    pickupLongitude: delivery.mapMode === "verified" ? delivery.pickupLongitude : null,
    dropoffLatitude: delivery.mapMode === "verified" ? delivery.deliveryLatitude : null,
    dropoffLongitude: delivery.mapMode === "verified" ? delivery.deliveryLongitude : null,
    mapMode: delivery.mapMode === "verified" ? "verified" : "demo",
    prohibitedItemsConfirmed: delivery.prohibitedItemsConfirmed,
    prohibitedItemsConfirmedAt: delivery.prohibitedItemsConfirmedAt?.toISOString() ?? null,
    prohibitedItemsPolicyVersion: delivery.prohibitedItemsPolicyVersion,
    driverLocation: latestLocation
      ? {
          id: latestLocation.id,
          deliveryId: delivery.publicDeliveryId,
          latitude: latestLocation.latitude,
          longitude: latestLocation.longitude,
          accuracyMeters: latestLocation.accuracyMeters,
          capturedAt: latestLocation.capturedAt.toISOString(),
        }
      : null,
    events: await deliveryEvents(delivery.id, delivery.deliveryStatus),
  };
}

export async function listCustomerDeliveries(customerId: string): Promise<ApiDelivery[]> {
  const records = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.customerId, customerId))
    .orderBy(desc(deliveriesTable.createdAt));
  return Promise.all(records.map(mapDelivery));
}

export async function customerDelivery(customerId: string, publicDeliveryId: string): Promise<ApiDelivery | null> {
  const [record] = await db
    .select()
    .from(deliveriesTable)
    .where(
      and(
        eq(deliveriesTable.customerId, customerId),
        eq(deliveriesTable.publicDeliveryId, publicDeliveryId),
      ),
    )
    .limit(1);
  return record ? mapDelivery(record) : null;
}

export async function customerRecipientVerification(
  customerId: string,
  publicDeliveryId: string,
): Promise<{ code: string; expiresAt: string } | null> {
  const [verification] = await db
    .select({
      deliveryId: deliveriesTable.id,
      expiresAt: deliveryVerificationsTable.expiresAt,
    })
    .from(deliveriesTable)
    .innerJoin(
      deliveryVerificationsTable,
      eq(deliveryVerificationsTable.deliveryId, deliveriesTable.id),
    )
    .where(
      and(
        eq(deliveriesTable.customerId, customerId),
        eq(deliveriesTable.publicDeliveryId, publicDeliveryId),
        eq(deliveriesTable.deliveryStatus, "delivery_verification_pending"),
        gt(deliveryVerificationsTable.expiresAt, new Date()),
        isNull(deliveryVerificationsTable.lockedAt),
        isNull(deliveryVerificationsTable.verifiedAt),
      ),
    )
    .limit(1);
  if (!verification) return null;
  return {
    code: recipientVerificationCode(verification.deliveryId, verification.expiresAt),
    expiresAt: verification.expiresAt.toISOString(),
  };
}

export type DeliveryCheckout = {
  delivery: ApiDelivery;
  payment: {
    provider: "stripe";
    paymentIntentId: string;
    clientSecret: string;
  };
};

async function markPaymentInitializationFailed(deliveryId: string, customerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, deliveryId))
      .for("update")
      .limit(1);
    if (!delivery || delivery.deliveryStatus !== "payment_pending") return;
    await tx
      .update(paymentsTable)
      .set({ status: "pending", metadata: { paymentSetup: "failed", recoverable: true } })
      .where(eq(paymentsTable.deliveryId, delivery.id));
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId: customerId,
      action: "payment.intent_initialization_deferred",
      entityType: "delivery",
      entityId: delivery.id,
      metadata: { provider: "stripe", recoverable: true },
    });
  });
}

async function checkoutFromExistingDelivery(customerId: string, checkoutRequestKey: string): Promise<DeliveryCheckout | null> {
  const paymentTestMode = process.env.PAYMENTS_TEST_MODE === "true";
  const prepared = await db.transaction(async (tx) => {
    // Keep the provider initialization behind the same lock as delivery
    // creation. Otherwise a concurrent retry can observe the payment row
    // before the first request has stored its provider payment id.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`delivery-checkout:${customerId}:${checkoutRequestKey}`}))`);
    const [delivery] = await tx
      .select()
      .from(deliveriesTable)
      .where(and(eq(deliveriesTable.customerId, customerId), eq(deliveriesTable.checkoutRequestKey, checkoutRequestKey)))
      .for("update")
      .limit(1);
    if (!delivery) return null;
    const [payment] = await tx
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.deliveryId, delivery.id))
      .for("update")
      .limit(1);
    if (!payment) return null;
    if (payment.providerPaymentId) {
      return { delivery, paymentIntentId: payment.providerPaymentId, clientSecret: null };
    }

    const paymentIntent = paymentTestMode
      ? { id: `pi_test_${delivery.id.replaceAll("-", "")}`, client_secret: `pi_test_${delivery.id.replaceAll("-", "")}_secret_mock` }
      : await (async () => {
          const [profile] = await tx
            .select({ email: profilesTable.email })
            .from(profilesTable)
            .where(eq(profilesTable.id, customerId))
            .limit(1);
          return (await getUncachableStripeClient()).paymentIntents.create({
            amount: Math.round(Number(delivery.totalPrice) * 100),
            currency: "usd",
            automatic_payment_methods: { enabled: true },
            receipt_email: profile?.email,
            description: `Anything Anywhere delivery ${delivery.orderNumber}`,
            metadata: { deliveryId: delivery.id, publicDeliveryId: delivery.publicDeliveryId, orderNumber: delivery.orderNumber, customerId },
          }, { idempotencyKey: `delivery-checkout:${customerId}:${checkoutRequestKey}` });
        })();
    if (!paymentIntent.client_secret) throw new Error("Stripe did not return a payment client secret.");
    await tx
      .update(paymentsTable)
      .set({
        providerPaymentId: paymentIntent.id,
        status: "pending",
        metadata: {
          mode: paymentTestMode ? "test" : "stripe",
          safe: true,
          paymentIntentStatus: "requires_payment_method",
        },
      })
      .where(eq(paymentsTable.id, payment.id));
    await tx
      .update(deliveriesTable)
      .set({ paymentStatus: "pending", deliveryStatus: "payment_pending" })
      .where(eq(deliveriesTable.id, delivery.id));
    if (delivery.deliveryStatus !== "payment_pending") {
      await tx.insert(deliveryStatusHistoryTable).values({
        deliveryId: delivery.id,
        fromStatus: delivery.deliveryStatus,
        toStatus: "payment_pending",
        changedByProfileId: customerId,
        reason: "Secure checkout recovered after initialization retry.",
        metadata: { provider: "stripe" },
      });
    }
    return { delivery: { ...delivery, paymentStatus: "pending" as const, deliveryStatus: "payment_pending" as const }, paymentIntentId: paymentIntent.id, clientSecret: paymentIntent.client_secret };
  });
  if (!prepared) return null;
  const clientSecret = prepared.clientSecret
    ?? (paymentTestMode
      ? `${prepared.paymentIntentId}_secret_mock`
      : (await (await getUncachableStripeClient()).paymentIntents.retrieve(prepared.paymentIntentId)).client_secret);
  if (!clientSecret) throw new Error("The existing Stripe checkout cannot be resumed.");
  return { delivery: await mapDelivery(prepared.delivery), payment: { provider: "stripe", paymentIntentId: prepared.paymentIntentId, clientSecret } };
}

function quoteValue(record: Record<string, string>, key: keyof QuoteInput): string | null {
  return record[key] ?? null;
}

function quoteMatchesCheckout(quoteRequest: Record<string, string>, input: DeliveryInput): boolean {
  return (["pickupAddress", "dropoffAddress", "category", "size", "weight", "care", "priority"] as const)
    .every((key) => quoteValue(quoteRequest, key) === String(input[key]))
    && (quoteValue(quoteRequest, "scheduledPickupStartAt") === (input.scheduledPickupStartAt ?? null)?.toString()
      || (quoteValue(quoteRequest, "scheduledPickupStartAt") === null && input.scheduledPickupStartAt == null))
    && (quoteValue(quoteRequest, "scheduledPickupEndAt") === (input.scheduledPickupEndAt ?? null)?.toString()
      || (quoteValue(quoteRequest, "scheduledPickupEndAt") === null && input.scheduledPickupEndAt == null));
}

function quoteCoordinates(quoteRequest: Record<string, string>) {
  const coordinate = (name: "pickupLatitude" | "pickupLongitude" | "dropoffLatitude" | "dropoffLongitude") => {
    const value = quoteRequest[name];
    return value === undefined ? null : Number(value);
  };
  return {
    pickupLatitude: coordinate("pickupLatitude"),
    pickupLongitude: coordinate("pickupLongitude"),
    dropoffLatitude: coordinate("dropoffLatitude"),
    dropoffLongitude: coordinate("dropoffLongitude"),
    mapMode: quoteRequest.mapMode === "verified" ? "verified" as const : "demo" as const,
  };
}

export async function createCustomerDelivery(customerId: string, input: DeliveryInput, checkoutRequestKey: string): Promise<DeliveryCheckout> {
  if (input.prohibitedItemsConfirmed !== true) {
    throw new DeliveryValidationError(PROHIBITED_ITEMS_CONFIRMATION_ERROR);
  }
  const paymentTestMode = process.env.PAYMENTS_TEST_MODE === "true";
  const coordination = await db.transaction(async (tx) => {
    // Serialize all uses of a customer idempotency key. This makes a retried
    // request observe the first durable payment record instead of racing it.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`delivery-checkout:${customerId}:${checkoutRequestKey}`}))`);
    const [existing] = await tx
      .select()
      .from(deliveriesTable)
      .where(and(eq(deliveriesTable.customerId, customerId), eq(deliveriesTable.checkoutRequestKey, checkoutRequestKey)))
      .limit(1);
    if (existing) return { delivery: existing, created: false };

    const [storedQuote] = await tx
      .select()
      .from(deliveryQuotesTable)
      .where(and(
        eq(deliveryQuotesTable.id, input.quoteId),
        eq(deliveryQuotesTable.customerId, customerId),
        gt(deliveryQuotesTable.expiresAt, new Date()),
      ))
      .for("update")
      .limit(1);
    if (!storedQuote || !quoteMatchesCheckout(storedQuote.request, input)) {
      throw new Error("Your delivery quote has expired or no longer matches these details. Please refresh it before checkout.");
    }
    const quote = storedQuote.response;
    validatePickupWindow({
      priority: input.priority,
      scheduledPickupStartAt: storedQuote.scheduledPickupStartAt?.toISOString() ?? null,
      scheduledPickupEndAt: storedQuote.scheduledPickupEndAt?.toISOString() ?? null,
    });
    const quotedCoordinates = quoteCoordinates(storedQuote.request);
    const quoteTotal = Number(quote.total);
    if (!Number.isFinite(quoteTotal) || quoteTotal < 0) {
      throw new Error("The stored delivery quote has invalid pricing. Please refresh it before checkout.");
    }
    const redeemedAt = new Date();
    const promotionCode = input.promotionCode?.trim();
    const redemption = promotionCode
      ? await promotionForRedemption(tx, promotionCode, redeemedAt)
      : null;
    const discount = redemption ? promotionSavings(redemption.promotion, quoteTotal) : 0;
    const totalPrice = money(quoteTotal - discount);
    const [created] = await tx
      .insert(deliveriesTable)
      .values({
        customerId,
        checkoutRequestKey,
        quoteId: storedQuote.id,
        orderNumber: generatedOrderNumber(),
        pickupAddress: input.pickupAddress,
        pickupContactName: input.pickupName,
        pickupContactPhone: input.pickupPhone,
        pickupInstructions: input.pickupInstructions || null,
        pickupLatitude: quotedCoordinates.pickupLatitude,
        pickupLongitude: quotedCoordinates.pickupLongitude,
        mapMode: quotedCoordinates.mapMode,
        dropoffAddress: input.dropoffAddress,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        deliveryInstructions: input.deliveryInstructions || null,
        deliveryLatitude: quotedCoordinates.dropoffLatitude,
        deliveryLongitude: quotedCoordinates.dropoffLongitude,
        prohibitedItemsConfirmed: true,
        prohibitedItemsConfirmedAt: new Date(),
        prohibitedItemsPolicyVersion: PROHIBITED_ITEMS_POLICY_VERSION,
        packageCategory: input.category,
        weightCategory: input.weight,
        sizeCategory: input.size,
        careLevel: input.care,
        priority: input.priority,
         scheduledAt: storedQuote.scheduledPickupStartAt,
         scheduledPickupStartAt: storedQuote.scheduledPickupStartAt,
         scheduledPickupEndAt: storedQuote.scheduledPickupEndAt,
        estimatedDurationMinutes: String(estimatedDurationMinutesFor(input.priority)),
        basePrice: String(quote.baseFare),
        distanceFee: String(quote.distanceFee),
        careFee: String(quote.careFee),
        serviceFee: "0",
        tax: String(quote.tax),
        discount: String(discount),
        totalPrice: String(totalPrice),
        paymentStatus: "pending",
        deliveryStatus: "payment_pending",
      })
      .returning();
    if (redemption) {
      await persistPromotionRedemption(tx, redemption.promotion, redemption.redemptionCount, {
        promotionCode: redemption.promotion.code,
        savingsAmount: discount,
        deliveryId: created.id,
        redeemedAt,
      });
    }
    await tx.insert(deliveryStatusHistoryTable).values({
      deliveryId: created.id,
      toStatus: "payment_pending",
      changedByProfileId: customerId,
      reason: "Awaiting Stripe payment confirmation.",
      metadata: { paymentMode: paymentTestMode ? "test" : "stripe" },
    });
    await tx.insert(paymentsTable).values({
      deliveryId: created.id,
      customerId,
      provider: "stripe",
      providerPaymentId: paymentTestMode ? `pi_test_${created.id.replaceAll("-", "")}` : null,
      status: "pending",
      amount: String(totalPrice),
      currency: "usd",
      metadata: { mode: paymentTestMode ? "test" : "stripe", safe: true },
    });
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId: customerId,
      action: "delivery.created",
      entityType: "delivery",
      entityId: created.id,
      metadata: { orderNumber: created.orderNumber, paymentMode: paymentTestMode ? "test" : "stripe" },
    });
    return { delivery: created, created: true };
  });
  const delivery = coordination.delivery;
  try {
    const checkout = await checkoutFromExistingDelivery(customerId, checkoutRequestKey);
    if (checkout) return checkout;
    throw new Error("The delivery checkout could not be prepared. Please retry with the same checkout request.");
  } catch (error) {
    await markPaymentInitializationFailed(delivery.id, customerId);
    throw error;
  }
}

export function assertValidTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  if (!stateTransitions[from].includes(to)) {
    throw new Error(`A delivery cannot move from ${from} to ${to}.`);
  }
}

export async function transitionDelivery(
  deliveryId: string,
  actorProfileId: string,
  toStatus: DeliveryStatus,
  reason?: string,
): Promise<DeliveryRecord> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, deliveryId))
      .for("update")
      .limit(1);
    if (!current) throw new Error("Delivery not found.");
    const ensureRecipientVerification = async (): Promise<void> => {
      const expiresAt = new Date(Date.now() + recipientVerificationTtlMs);
      const code = recipientVerificationCode(current.id, expiresAt);
      await tx
        .insert(deliveryVerificationsTable)
        .values({
          deliveryId: current.id,
          otpHash: recipientVerificationHash(current.id, code),
          expiresAt,
        })
        .onConflictDoNothing({ target: deliveryVerificationsTable.deliveryId });
    };
    if (current.deliveryStatus === toStatus) {
      if (toStatus === "delivery_verification_pending") {
        await ensureRecipientVerification();
      }
      return { updated: current, event: null };
    }
    if (toStatus === "delivered") {
      throw new Error("Recipient verification is required before a delivery can be completed.");
    }
    assertValidTransition(current.deliveryStatus, toStatus);
    if (toStatus === "driver_assigned" && !current.driverId) {
      throw new Error("Assign a driver before moving a delivery to driver_assigned.");
    }
    const now = new Date();
    const timestampUpdates =
      toStatus === "picked_up"
        ? { pickedUpAt: now }
        : toStatus === "cancelled"
          ? { cancelledAt: now }
          : {};
    const [updated] = await tx
      .update(deliveriesTable)
      .set({ deliveryStatus: toStatus, ...timestampUpdates })
      .where(
        and(
          eq(deliveriesTable.id, deliveryId),
          eq(deliveriesTable.deliveryStatus, current.deliveryStatus),
        ),
      )
      .returning();
    if (!updated) throw new DeliveryConflictError("Delivery changed concurrently; refresh the route and retry the transition.");
    if (toStatus === "delivery_verification_pending") {
      await ensureRecipientVerification();
    }
    await tx.insert(deliveryStatusHistoryTable).values({
      deliveryId,
      fromStatus: current.deliveryStatus,
      toStatus,
      changedByProfileId: actorProfileId,
      reason: reason || null,
    });
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId,
      action: "delivery.status_changed",
      entityType: "delivery",
      entityId: deliveryId,
      metadata: { from: current.deliveryStatus, to: toStatus },
    });
    const attentionType = toStatus === "failed"
      ? "delivery_failed"
      : toStatus === "cancelled"
        ? "delivery_cancelled"
        : null;
    if (attentionType) {
      await createDispatchAlertsForDelivery(tx, current, attentionType);
    }
    const event = await recordDeliveryEvent(tx, {
      type: "delivery.updated",
      deliveryId: updated.id,
      customerId: updated.customerId,
      driverId: updated.driverId,
      payload: { status: updated.deliveryStatus },
    });
    return { updated, event };
  });
  if (result.event) publishDeliveryEvent({ ...result.event, deliveryId: result.updated.publicDeliveryId });
  return result.updated;
}

export async function assignDelivery(
  publicDeliveryId: string,
  driverId: string,
  actorProfileId: string,
): Promise<DeliveryRecord | null> {
  const result = await db.transaction(async (tx) => {
    const [driver] = await tx
      .select()
      .from(driversTable)
      .where(eq(driversTable.id, driverId))
      .for("update")
      .limit(1);
    if (!driver || driver.approvalStatus !== "approved") {
      throw new Error("Only an approved driver can be assigned.");
    }
    if (!(await hasCurrentDriverCompliance(driver.id))) {
      throw new Error("This driver does not have current approved compliance documents.");
    }
    if (!["available", "online"].includes(driver.availabilityStatus)) {
      throw new Error("This approved driver is not currently available. Choose another driver.");
    }
    const [capacity] = await tx
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(deliveriesTable)
      .where(and(
        eq(deliveriesTable.driverId, driver.id),
        notInArray(deliveriesTable.deliveryStatus, terminalStatuses),
      ));
    if ((capacity?.activeCount ?? 0) > 0) {
      throw new Error("This driver already has an active delivery. Choose another driver.");
    }
    const [current] = await tx
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.publicDeliveryId, publicDeliveryId))
      .for("update")
      .limit(1);
    if (!current) return { assigned: null, event: null };
    if (current.deliveryStatus !== "searching_driver" || current.driverId) {
      throw new Error("Only an unassigned searching delivery can be assigned.");
    }
    assertValidTransition(current.deliveryStatus, "driver_assigned");
    const [updated] = await tx
      .update(deliveriesTable)
      .set({
        driverId,
        assignedAt: new Date(),
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
          eq(deliveriesTable.deliveryStatus, current.deliveryStatus),
          isNull(deliveriesTable.driverId),
        ),
      )
      .returning();
    if (!updated) throw new DeliveryConflictError("Delivery changed concurrently; refresh the route and retry the assignment.");
    await tx.insert(deliveryStatusHistoryTable).values({
      deliveryId: current.id,
      fromStatus: "searching_driver",
      toStatus: "driver_assigned",
      changedByProfileId: actorProfileId,
      reason: "Assigned by dispatch.",
    });
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId,
      action: "delivery.driver_assigned",
      entityType: "delivery",
      entityId: current.id,
      metadata: { driverId },
    });
    const event = await recordDeliveryEvent(tx, {
      type: "delivery.updated",
      deliveryId: updated.id,
      customerId: updated.customerId,
      driverId: updated.driverId,
      payload: { status: updated.deliveryStatus, assignment: "dispatch" },
    });
    return { assigned: updated, event };
  });
  if (result.event && result.assigned) publishDeliveryEvent({ ...result.event, deliveryId: result.assigned.publicDeliveryId });
  return result.assigned;
}

export async function driverDeliveries(driverId: string): Promise<ApiDelivery[]> {
  const records = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.driverId, driverId))
    .orderBy(desc(deliveriesTable.createdAt));
  return Promise.all(records.map(mapDelivery));
}

export async function listStaffDeliveries(options: StaffDeliveryListOptions = {}): Promise<StaffDelivery[]> {
  const records = await db
    .select()
    .from(deliveriesTable)
    .where(notInArray(deliveriesTable.deliveryStatus, terminalStatuses))
    .orderBy(desc(deliveriesTable.updatedAt), desc(deliveriesTable.createdAt));

  const deliveries = await Promise.all(records.map(async (record) => {
    const fullDelivery = await mapDelivery(record);
    const delivery: Omit<StaffDelivery, "driverId" | "priority" | "updatedAt" | "isDelayed" | "driverLocation"> = {
      id: fullDelivery.id,
      orderNumber: fullDelivery.orderNumber,
      pickupAddress: fullDelivery.pickupAddress,
      dropoffAddress: fullDelivery.dropoffAddress,
      category: fullDelivery.category,
      care: fullDelivery.care,
      status: fullDelivery.status,
      eta: fullDelivery.eta,
      createdAt: fullDelivery.createdAt,
      driverName: fullDelivery.driverName,
      vehicle: fullDelivery.vehicle,
      size: fullDelivery.size,
      weight: fullDelivery.weight,
      deliveryDistanceMiles: fullDelivery.deliveryDistanceMiles,
      expectedMinutes: fullDelivery.expectedMinutes,
      scheduledPickupStartAt: fullDelivery.scheduledPickupStartAt,
      scheduledPickupEndAt: fullDelivery.scheduledPickupEndAt,
      pickupLatitude: fullDelivery.pickupLatitude,
      pickupLongitude: fullDelivery.pickupLongitude,
      dropoffLatitude: fullDelivery.dropoffLatitude,
      dropoffLongitude: fullDelivery.dropoffLongitude,
      mapMode: fullDelivery.mapMode,
      events: fullDelivery.events,
    };
    const staffFields = {
      priority: record.priority === "asap" ? "asap" as const : "scheduled" as const,
      updatedAt: record.updatedAt.toISOString(),
      isDelayed: isDeliveryDelayed(record),
    };
    if (!record.driverId) {
      return {
        delivery: { ...delivery, ...staffFields, driverId: null, driverLocation: null },
        driverSearchName: null,
      };
    }

    const [driver] = await db
      .select({
        id: driversTable.id,
        latitude: driversTable.currentLatitude,
        longitude: driversTable.currentLongitude,
        capturedAt: driversTable.lastLocationUpdate,
        firstName: profilesTable.firstName,
        lastName: profilesTable.lastName,
      })
      .from(driversTable)
      .innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
      .where(eq(driversTable.id, record.driverId))
      .limit(1);

    const driverSearchName = driver ? `${driver.firstName} ${driver.lastName}` : null;
    if (
      !driver
      || driver.latitude == null
      || driver.longitude == null
      || !driver.capturedAt
    ) {
      return {
        delivery: { ...delivery, ...staffFields, driverId: record.driverId, driverLocation: null },
        driverSearchName,
      };
    }

    return {
      delivery: {
        ...delivery,
        ...staffFields,
        driverId: record.driverId,
        driverLocation: {
          id: driver.id,
          deliveryId: record.publicDeliveryId,
          latitude: driver.latitude,
          longitude: driver.longitude,
          accuracyMeters: null,
          capturedAt: driver.capturedAt.toISOString(),
        },
      },
      driverSearchName,
    };
  }));

  const normalizedSearch = options.search?.trim().toLocaleLowerCase();
  const filtered = deliveries.filter(({ delivery, driverSearchName }) => {
    if (normalizedSearch) {
      const searchableText = [
        delivery.orderNumber,
        delivery.pickupAddress,
        delivery.dropoffAddress,
        delivery.driverName,
        driverSearchName,
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      if (!searchableText.includes(normalizedSearch)) return false;
    }
    if (options.filter === "unassigned" && delivery.driverId !== null) return false;
    if (options.filter === "delayed" && !delivery.isDelayed) return false;
    if (options.filter === "in_progress" && !inProgressStatuses.includes(delivery.status as DeliveryStatus)) return false;
    return true;
  }).map(({ delivery }) => delivery);

  return filtered.sort((a, b) => {
    if (options.sort === "recently_changed") {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
    const urgency = (delivery: StaffDelivery) =>
      (delivery.isDelayed ? 8 : 0)
      + (delivery.driverId === null ? 4 : 0)
      + (delivery.priority === "asap" ? 2 : 0)
      + (inProgressStatuses.includes(delivery.status as DeliveryStatus) ? 1 : 0);
    return urgency(b) - urgency(a)
      || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

async function materializeDelayedDispatchAlerts(): Promise<void> {
  const delayedDeliveries = await db
    .select({
      id: deliveriesTable.id,
      orderNumber: deliveriesTable.orderNumber,
      deliveryStatus: deliveriesTable.deliveryStatus,
      pickedUpAt: deliveriesTable.pickedUpAt,
      assignedAt: deliveriesTable.assignedAt,
      createdAt: deliveriesTable.createdAt,
      estimatedDurationMinutes: deliveriesTable.estimatedDurationMinutes,
      priority: deliveriesTable.priority,
    })
    .from(deliveriesTable)
    .where(notInArray(deliveriesTable.deliveryStatus, terminalStatuses));
  const delayed = delayedDeliveries.filter((delivery) => isDeliveryDelayed(delivery));
  if (!delayed.length) return;

  await db.transaction(async (tx) => {
    const staff = await tx
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(inArray(profilesTable.role, ["admin", "dispatcher"]));
    if (!staff.length) return;
    const details = dispatchAlertDetails.delivery_delayed;
    for (const delivery of delayed) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`dispatch-alert:${delivery.id}:delivery_delayed`}))`);
      const existing = await tx
        .select({ profileId: notificationsTable.profileId })
        .from(notificationsTable)
        .where(and(
          eq(notificationsTable.deliveryId, delivery.id),
          eq(notificationsTable.type, "delivery_delayed"),
          inArray(notificationsTable.profileId, staff.map((profile) => profile.id)),
        ));
      const notifiedProfileIds = new Set(existing.map((notification) => notification.profileId));
      const notifications = staff
        .filter((profile) => !notifiedProfileIds.has(profile.id))
        .map((profile) => ({
          profileId: profile.id,
          deliveryId: delivery.id,
          type: "delivery_delayed",
          title: details.title,
          body: details.message(delivery.orderNumber),
        }));
      if (notifications.length) {
        await tx.insert(notificationsTable).values(notifications);
      }
    }
  });
}

function dispatchAlertFromRecord(record: {
  id: string;
  publicDeliveryId: string;
  orderNumber: string;
  type: string;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}): DispatchAlert {
  const type = record.type as DispatchAlertType;
  return {
    id: record.id,
    deliveryId: record.publicDeliveryId,
    orderNumber: record.orderNumber,
    type,
    title: record.title,
    message: record.body,
    recommendedAction: dispatchAlertDetails[type].recommendedAction,
    createdAt: record.createdAt.toISOString(),
    acknowledgedAt: record.readAt?.toISOString() ?? null,
  };
}

export async function listDispatchAlerts(profileId: string): Promise<DispatchAlert[]> {
  await materializeDelayedDispatchAlerts();
  const records = await db
    .select({
      id: notificationsTable.id,
      publicDeliveryId: deliveriesTable.publicDeliveryId,
      orderNumber: deliveriesTable.orderNumber,
      type: notificationsTable.type,
      title: notificationsTable.title,
      body: notificationsTable.body,
      readAt: notificationsTable.readAt,
      createdAt: notificationsTable.createdAt,
    })
    .from(notificationsTable)
    .innerJoin(deliveriesTable, eq(notificationsTable.deliveryId, deliveriesTable.id))
    .where(and(
      eq(notificationsTable.profileId, profileId),
      inArray(notificationsTable.type, dispatchAlertTypes),
      isNull(notificationsTable.readAt),
    ))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  return records.map(dispatchAlertFromRecord);
}

export async function acknowledgeDispatchAlert(profileId: string, alertId: string): Promise<DispatchAlert | null> {
  const record = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: notificationsTable.id,
        deliveryId: notificationsTable.deliveryId,
        publicDeliveryId: deliveriesTable.publicDeliveryId,
        orderNumber: deliveriesTable.orderNumber,
        type: notificationsTable.type,
        title: notificationsTable.title,
        body: notificationsTable.body,
        readAt: notificationsTable.readAt,
        createdAt: notificationsTable.createdAt,
      })
      .from(notificationsTable)
      .innerJoin(deliveriesTable, eq(notificationsTable.deliveryId, deliveriesTable.id))
      .where(and(
        eq(notificationsTable.id, alertId),
        eq(notificationsTable.profileId, profileId),
        inArray(notificationsTable.type, dispatchAlertTypes),
      ))
      .limit(1);
    if (!current) return null;
    if (current.readAt) return current;

    const [updated] = await tx
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(and(eq(notificationsTable.id, alertId), isNull(notificationsTable.readAt)))
      .returning({ readAt: notificationsTable.readAt });
    if (!updated) {
      const [acknowledged] = await tx
        .select({ readAt: notificationsTable.readAt })
        .from(notificationsTable)
        .where(eq(notificationsTable.id, alertId))
        .limit(1);
      return { ...current, readAt: acknowledged?.readAt ?? current.readAt };
    }
    await tx.insert(adminAuditLogsTable).values({
      actorProfileId: profileId,
      action: "dispatch.alert_acknowledged",
      entityType: "delivery",
      entityId: current.deliveryId,
      metadata: { alertId: current.id, alertType: current.type },
    });
    return { ...current, readAt: updated.readAt };
  });
  return record ? dispatchAlertFromRecord(record) : null;
}
export async function driverAssignedDelivery(driverId: string, publicDeliveryId: string): Promise<DeliveryRecord | null> {
  const [record] = await db
    .select()
    .from(deliveriesTable)
    .where(
      and(
        eq(deliveriesTable.driverId, driverId),
        eq(deliveriesTable.publicDeliveryId, publicDeliveryId),
      ),
    )
    .limit(1);
  return record ?? null;
}

export async function staffDelivery(publicDeliveryId: string): Promise<ApiDelivery | null> {
  const [record] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.publicDeliveryId, publicDeliveryId))
    .limit(1);
  return record ? mapDelivery(record) : null;
}

export async function customerSummary(customerId: string) {
  const [profile] = await db
    .select({ firstName: profilesTable.firstName, lastName: profilesTable.lastName })
    .from(profilesTable)
    .where(eq(profilesTable.id, customerId))
    .limit(1);
  const deliveries = await listCustomerDeliveries(customerId);
  const places = await db
    .select({ id: customerAddressesTable.id, label: customerAddressesTable.label, address: customerAddressesTable.fullAddress })
    .from(customerAddressesTable)
    .where(eq(customerAddressesTable.customerId, customerId))
    .orderBy(desc(customerAddressesTable.isDefault), asc(customerAddressesTable.label));
  return {
    customerName: profile ? `${profile.firstName} ${profile.lastName}` : "Customer",
    activeCount: deliveries.filter((delivery) => !["delivered", "cancelled", "failed", "refunded"].includes(delivery.status)).length,
    pastCount: deliveries.filter((delivery) => delivery.status === "delivered").length,
    savedPlaces: places.map((place) => ({ id: place.id, label: place.label, address: place.address })),
  };
}

export type ApprovedDriver = {
  id: string;
  name: string;
  vehicle: string | null;
  availabilityStatus: string;
  totalDeliveries: number;
};

const terminalStatuses: DeliveryStatus[] = ["delivered", "cancelled", "failed", "refunded"];
const inProgressStatuses: DeliveryStatus[] = [
  "driver_assigned",
  "driver_en_route_pickup",
  "driver_arrived_pickup",
  "pickup_verified",
  "picked_up",
  "in_transit",
  "driver_arrived_delivery",
  "delivery_verification_pending",
];

export type StaffDeliveryFilter = "all" | "unassigned" | "delayed" | "in_progress";
export type StaffDeliverySort = "urgent" | "recently_changed";

type StaffDeliveryListOptions = {
  search?: string;
  filter?: StaffDeliveryFilter;
  sort?: StaffDeliverySort;
};

function isDeliveryDelayed(record: Pick<DeliveryRecord, "deliveryStatus" | "pickedUpAt" | "assignedAt" | "estimatedDurationMinutes" | "priority">): boolean {
  const startedAt = record.pickedUpAt ?? record.assignedAt;
  if (!inProgressStatuses.includes(record.deliveryStatus) || !startedAt) {
    return false;
  }
  const expectedMinutes = Number(record.estimatedDurationMinutes ?? estimatedDurationMinutesFor(
    record.priority === "asap" ? "asap" : "scheduled",
  ));
  if (!Number.isFinite(expectedMinutes) || expectedMinutes <= 0) return false;
  return Date.now() - startedAt.getTime() > expectedMinutes * 60_000;
}

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return terminalStatuses.includes(status);
}

export async function listApprovedDrivers(): Promise<ApprovedDriver[]> {
  const rows = await db
    .select({
      id: driversTable.id,
      firstName: profilesTable.firstName,
      lastName: profilesTable.lastName,
      vehicleMake: driversTable.vehicleMake,
      vehicleModel: driversTable.vehicleModel,
      vehicleColor: driversTable.vehicleColor,
      availabilityStatus: driversTable.availabilityStatus,
      totalDeliveries: driversTable.totalDeliveries,
    })
    .from(driversTable)
    .innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
    .where(eq(driversTable.approvalStatus, "approved"))
    .orderBy(asc(profilesTable.firstName), asc(profilesTable.lastName));

  const eligible = await Promise.all(rows.map(async (driver) => ({
    driver,
    eligible: await hasCurrentDriverCompliance(driver.id),
  })));
  return eligible.filter(({ eligible }) => eligible).map(({ driver }) => ({
    id: driver.id,
    name: `${driver.firstName} ${driver.lastName}`,
    vehicle: [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(" ") || null,
    availabilityStatus: driver.availabilityStatus,
    totalDeliveries: Number(driver.totalDeliveries),
  }));
}

export class DeliveryConflictError extends Error {}

export class DeliveryValidationError extends Error {}

function promotionSavings(promotion: typeof promoCodesTable.$inferSelect, total: number): number {
  const discountValue = Number(promotion.discountValue);
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw new Error("Promotion discount configuration is invalid.");
  }
  const discount = promotion.discountType === "percent"
    ? total * (discountValue / 100)
    : discountValue;
  return Math.min(total, money(discount));
}

async function promotionForRedemption(
  tx: PromotionRedemptionWriter,
  promotionCode: string,
  redeemedAt: Date,
) {
  const [promotion] = await tx
    .select()
    .from(promoCodesTable)
    .where(eq(promoCodesTable.code, promotionCode))
    .for("update")
    .limit(1);
  if (!promotion) throw new Error("Promotion code not found.");
  if (promotion.active !== "true") throw new Error("Promotion code is inactive.");
  if (promotion.startsAt && redeemedAt < promotion.startsAt) throw new Error("Promotion code is not active yet.");
  if (promotion.expiresAt && redeemedAt >= promotion.expiresAt) throw new Error("Promotion code has expired.");

  const redemptionCount = Number(promotion.redemptionCount);
  const maxRedemptions = promotion.maxRedemptions === null ? null : Number(promotion.maxRedemptions);
  if (!Number.isSafeInteger(redemptionCount) || redemptionCount < 0) {
    throw new Error("Promotion redemption count is invalid.");
  }
  if (maxRedemptions !== null && (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 0)) {
    throw new Error("Promotion maximum redemptions is invalid.");
  }
  if (maxRedemptions !== null && redemptionCount >= maxRedemptions) {
    throw new Error("Promotion redemption limit has been reached.");
  }
  return { promotion, redemptionCount };
}

async function persistPromotionRedemption(
  tx: PromotionRedemptionWriter,
  promotion: typeof promoCodesTable.$inferSelect,
  redemptionCount: number,
  input: PromotionRedemptionInput,
) {
  const savingsAmount = money(input.savingsAmount);
  if (!Number.isFinite(savingsAmount) || savingsAmount < 0) {
    throw new Error("Promotion savings must be a non-negative amount.");
  }

  const [existing] = await tx
    .select()
    .from(promotionRedemptionsTable)
    .where(eq(promotionRedemptionsTable.deliveryId, input.deliveryId))
    .limit(1);
  if (existing) {
    if (existing.promotionCode !== promotion.code) {
      throw new Error("A different promotion has already been redeemed for this delivery.");
    }
    return existing;
  }

  const [redemption] = await tx
    .insert(promotionRedemptionsTable)
    .values({
      promotionId: promotion.id,
      deliveryId: input.deliveryId,
      promotionCode: promotion.code,
      savingsAmount: String(savingsAmount),
      redeemedAt: input.redeemedAt,
    })
    .returning();
  await tx
    .update(promoCodesTable)
    .set({ redemptionCount: String(redemptionCount + 1) })
    .where(eq(promoCodesTable.id, promotion.id));
  return redemption;
}

export async function recordPromotionRedemption(input: PromotionRedemptionInput) {
  const promotionCode = input.promotionCode.trim();
  if (!promotionCode) throw new Error("A promotion code is required to record a redemption.");
  return db.transaction(async (tx) => {
    const { promotion, redemptionCount } = await promotionForRedemption(tx, promotionCode, input.redeemedAt ?? new Date());
    return persistPromotionRedemption(tx, promotion, redemptionCount, {
      ...input,
      promotionCode,
    });
  });
}

type PromotionRedemptionWriter = Pick<typeof db, "select" | "insert" | "update">;
