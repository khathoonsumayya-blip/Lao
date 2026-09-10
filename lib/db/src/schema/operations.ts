import {
  bigint,
  bigserial,
  check,
  integer,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { deliveriesTable } from "./deliveries";
import { driversTable, profilesTable } from "./identity";

export const driverApplicationsTable = pgTable(
  "driver_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .unique()
      .references(() => driversTable.id, { onDelete: "cascade" }),
    avatarPath: text("avatar_path"),
    licenseState: text("license_state"),
    licenseLastFour: text("license_last_four"),
    insuranceProvider: text("insurance_provider"),
    insuranceExpiresAt: timestamp("insurance_expires_at", { withTimezone: true }),
    backgroundCheckStatus: text("background_check_status").notNull().default("not_started"),
    backgroundCheckedAt: timestamp("background_checked_at", { withTimezone: true }),
    backgroundCheckReference: text("background_check_reference"),
    backgroundCheckReason: text("background_check_reason"),
    mvrCheckStatus: text("mvr_check_status").notNull().default("not_started"),
    mvrCheckedAt: timestamp("mvr_checked_at", { withTimezone: true }),
    mvrCheckReference: text("mvr_check_reference"),
    mvrCheckReason: text("mvr_check_reason"),
    safetyAcknowledgedAt: timestamp("safety_acknowledged_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // Approved onboarding values remain authoritative while a post-approval
    // profile change is being reviewed. This is intentionally part of the
    // existing application record rather than a second approval workflow.
    pendingProfileChanges: jsonb("pending_profile_changes").$type<Record<string, string | number>>(),
    pendingProfileReviewStatus: text("pending_profile_review_status").notNull().default("none"),
    pendingProfileReviewReason: text("pending_profile_review_reason"),
    pendingProfileSubmittedAt: timestamp("pending_profile_submitted_at", { withTimezone: true }),
    pendingProfileReviewedAt: timestamp("pending_profile_reviewed_at", { withTimezone: true }),
    pendingProfileReviewedBy: uuid("pending_profile_reviewed_by").references(() => profilesTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("driver_applications_driver_idx").on(table.driverId)],
);

export const deliveryVerificationsTable = pgTable(
  "delivery_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .unique()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    otpHash: text("otp_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: text("attempts").notNull().default("0"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("delivery_verifications_delivery_idx").on(table.deliveryId)],
);

/**
 * Authoritative delivery changes are appended here in the same transaction as
 * the state change.  API instances can replay this ledger after a restart,
 * instead of trusting process-local event delivery.
 */
export const deliveryCoordinationEventsTable = pgTable(
  "delivery_coordination_events",
  {
    cursor: bigserial("cursor", { mode: "number" }).primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").references(() => driversTable.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("delivery_coordination_events_delivery_cursor_idx").on(table.deliveryId, table.cursor),
    index("delivery_coordination_events_customer_cursor_idx").on(table.customerId, table.cursor),
    index("delivery_coordination_events_driver_cursor_idx").on(table.driverId, table.cursor),
  ],
);

/**
 * Transport attempts are deliberately independent from the authoritative
 * transition. Workers may retry these records without re-running a delivery
 * action when a future email, SMS, or push transport is unavailable.
 */
export const notificationAttemptsTable = pgTable(
  "notification_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    coordinationEventCursor: bigint("coordination_event_cursor", { mode: "number" })
      .notNull()
      .references(() => deliveryCoordinationEventsTable.cursor, { onDelete: "cascade" }),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("in_app"),
    status: text("status").notNull().default("pending"),
    attempts: text("attempts").notNull().default("0"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    claimToken: text("claim_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("notification_attempts_retry_idx").on(table.status, table.nextAttemptAt),
    index("notification_attempts_delivery_idx").on(table.deliveryId, table.createdAt),
  ],
);

export const driverIncidentsTable = pgTable(
  "driver_incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => driversTable.id, { onDelete: "restrict" }),
    deliveryId: uuid("delivery_id").references(() => deliveriesTable.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    message: text("message").notNull(),
    // Staff may prioritize a driver-created issue without changing the
    // driver's reporting flow or the source-union support queue.
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    assignedProfileId: uuid("assigned_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByProfileId: uuid("resolved_by_profile_id").references(() => profilesTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("driver_incidents_driver_created_idx").on(table.driverId, table.createdAt),
    index("driver_incidents_delivery_idx").on(table.deliveryId),
    index("driver_incidents_resolved_by_idx").on(table.resolvedByProfileId),
  ],
);

export const paymentsTable = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id"),
    providerCustomerId: text("provider_customer_id"),
    status: text("status").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("usd"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("payments_delivery_id_idx").on(table.deliveryId),
    index("payments_customer_id_idx").on(table.customerId),
    uniqueIndex("payments_provider_payment_id_unique").on(table.providerPaymentId),
  ],
);

export const paymentWebhookEventsTable = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    paymentIntentId: text("payment_intent_id").notNull(),
    paymentId: uuid("payment_id").references(() => paymentsTable.id, { onDelete: "set null" }),
    deliveryId: uuid("delivery_id").references(() => deliveriesTable.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_webhook_events_provider_event_unique").on(table.provider, table.providerEventId),
    index("payment_webhook_events_payment_created_idx").on(table.paymentId, table.createdAt),
    index("payment_webhook_events_delivery_created_idx").on(table.deliveryId, table.createdAt),
  ],
);

export const refundOperationsTable = pgTable(
  "refund_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .unique()
      .references(() => paymentsTable.id, { onDelete: "restrict" }),
    actorProfileId: uuid("actor_profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("requested"),
    providerRefundId: text("provider_refund_id"),
    providerError: text("provider_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("refund_operations_actor_created_idx").on(table.actorProfileId, table.createdAt),
  ],
);

export const ratingsTable = pgTable(
  "ratings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .unique()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "restrict" }),
    driverId: uuid("driver_id").references(() => driversTable.id, { onDelete: "set null" }),
    score: text("score").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ratings_driver_id_idx").on(table.driverId),
  ],
);

export const supportTicketsTable = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "restrict" }),
    deliveryId: uuid("delivery_id").references(() => deliveriesTable.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    message: text("message").notNull(),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    assignedProfileId: uuid("assigned_profile_id").references(() => profilesTable.id, {
      onDelete: "set null",
    }),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByProfileId: uuid("resolved_by_profile_id").references(() => profilesTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("support_tickets_customer_created_idx").on(table.customerId, table.createdAt),
    index("support_tickets_status_created_idx").on(table.status, table.createdAt),
    index("support_tickets_resolved_by_idx").on(table.resolvedByProfileId),
  ],
);

export const supportTicketCommentsTable = pgTable(
  "support_ticket_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTicketsTable.id, { onDelete: "cascade" }),
    authorProfileId: uuid("author_profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("support_ticket_comments_ticket_created_idx").on(table.ticketId, table.createdAt),
  ],
);

/** A requester-visible staff conversation for either source in the support queue. */
export const supportConversationEntriesTable = pgTable(
  "support_conversation_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supportTicketId: uuid("support_ticket_id").references(() => supportTicketsTable.id, { onDelete: "cascade" }),
    driverIncidentId: uuid("driver_incident_id").references(() => driverIncidentsTable.id, { onDelete: "cascade" }),
    authorProfileId: uuid("author_profile_id").notNull().references(() => profilesTable.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    visibility: text("visibility").notNull().default("requester"),
    clientRequestId: text("client_request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("support_conversation_ticket_created_idx").on(table.supportTicketId, table.createdAt),
    index("support_conversation_incident_created_idx").on(table.driverIncidentId, table.createdAt),
    uniqueIndex("support_conversation_author_request_unique").on(table.authorProfileId, table.clientRequestId),
  ],
);

export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    deliveryId: uuid("delivery_id").references(() => deliveriesTable.id, { onDelete: "set null" }),
    // A notification can point at exactly one requester-visible support source.
    // Delivery notifications continue to use deliveryId independently.
    supportTicketId: uuid("support_ticket_id").references(() => supportTicketsTable.id, { onDelete: "cascade" }),
    driverIncidentId: uuid("driver_incident_id").references(() => driverIncidentsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notifications_profile_created_idx").on(table.profileId, table.createdAt),
    index("notifications_support_ticket_idx").on(table.supportTicketId),
    index("notifications_driver_incident_idx").on(table.driverIncidentId),
  ],
);

export const promoCodesTable = pgTable(
  "promo_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    description: text("description"),
    discountType: text("discount_type").notNull(),
    discountValue: numeric("discount_value", { precision: 10, scale: 2 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxRedemptions: text("max_redemptions"),
    redemptionCount: text("redemption_count").notNull().default("0"),
    active: text("active").notNull().default("true"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  () => [],
);

export const promotionRedemptionsTable = pgTable(
  "promotion_redemptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    promotionId: uuid("promotion_id").references(() => promoCodesTable.id, { onDelete: "set null" }),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    promotionCode: text("promotion_code").notNull(),
    savingsAmount: numeric("savings_amount", { precision: 10, scale: 2 }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("promotion_redemptions_redeemed_code_idx").on(table.redeemedAt, table.promotionCode),
    uniqueIndex("promotion_redemptions_delivery_unique").on(table.deliveryId),
  ],
);
export const driverEarningsTable = pgTable(
  "driver_earnings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => driversTable.id, { onDelete: "cascade" }),
    deliveryId: uuid("delivery_id")
      .notNull()
      .unique()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    grossAmount: numeric("gross_amount", { precision: 10, scale: 2 }).notNull(),
    adjustmentAmount: numeric("adjustment_amount", { precision: 10, scale: 2 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 10, scale: 2 }).notNull(),
    status: text("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("driver_earnings_driver_created_idx").on(table.driverId, table.createdAt),
  ],
);

/**
 * Administrative awards are deliberately separate from delivery earnings and
 * customer payments. Amounts are USD cents, so no monetary rounding can occur
 * while an award moves through approval and payout.
 */
export const driverBonusesTable = pgTable(
  "driver_bonuses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id").notNull().references(() => driversTable.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    type: text("type").notNull(),
    reason: text("reason").notNull(),
    note: text("note"),
    performancePeriodStart: timestamp("performance_period_start", { withTimezone: true }),
    performancePeriodEnd: timestamp("performance_period_end", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    issuedByProfileId: uuid("issued_by_profile_id").notNull().references(() => profilesTable.id, { onDelete: "restrict" }),
    approvedByProfileId: uuid("approved_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidByProfileId: uuid("paid_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    reversedByProfileId: uuid("reversed_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversalReason: text("reversal_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("driver_bonuses_idempotency_key_unique").on(table.idempotencyKey),
    index("driver_bonuses_driver_created_idx").on(table.driverId, table.createdAt),
    index("driver_bonuses_status_created_idx").on(table.status, table.createdAt),
    check("driver_bonuses_amount_bounds_check", sql`${table.amountCents} > 0 AND ${table.amountCents} <= 100000000`),
    check("driver_bonuses_currency_check", sql`${table.currency} = 'USD'`),
    check("driver_bonuses_type_check", sql`${table.type} IN ('on_time', 'weekend', 'streak', 'manual_performance')`),
    check("driver_bonuses_reason_check", sql`length(btrim(${table.reason})) BETWEEN 3 AND 1000`),
    check("driver_bonuses_note_check", sql`${table.note} IS NULL OR length(${table.note}) <= 2000`),
    check("driver_bonuses_status_check", sql`${table.status} IN ('pending', 'approved', 'paid', 'reversed')`),
    check("driver_bonuses_idempotency_key_length_check", sql`length(${table.idempotencyKey}) BETWEEN 1 AND 255`),
    check("driver_bonuses_period_check", sql`${table.performancePeriodStart} IS NULL OR ${table.performancePeriodEnd} IS NULL OR ${table.performancePeriodStart} <= ${table.performancePeriodEnd}`),
    check("driver_bonuses_approved_pair_check", sql`(${table.approvedAt} IS NULL) = (${table.approvedByProfileId} IS NULL)`),
    check("driver_bonuses_paid_pair_check", sql`(${table.paidAt} IS NULL) = (${table.paidByProfileId} IS NULL)`),
    check("driver_bonuses_reversed_pair_check", sql`(${table.reversedAt} IS NULL) = (${table.reversedByProfileId} IS NULL)`),
    check("driver_bonuses_lifecycle_check", sql`
      (${table.status} = 'pending' AND ${table.approvedAt} IS NULL AND ${table.paidAt} IS NULL AND ${table.reversedAt} IS NULL AND ${table.reversalReason} IS NULL)
      OR (${table.status} = 'approved' AND ${table.approvedAt} IS NOT NULL AND ${table.paidAt} IS NULL AND ${table.reversedAt} IS NULL AND ${table.reversalReason} IS NULL)
      OR (${table.status} = 'paid' AND ${table.approvedAt} IS NOT NULL AND ${table.paidAt} IS NOT NULL AND ${table.reversedAt} IS NULL AND ${table.reversalReason} IS NULL)
      OR (${table.status} = 'reversed' AND ${table.reversedAt} IS NOT NULL AND ${table.reversalReason} IS NOT NULL AND length(btrim(${table.reversalReason})) >= 3)
    `),
  ],
);

export const driverDeliveryOfferAttemptsTable = pgTable(
  "driver_delivery_offer_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id").notNull().references(() => deliveriesTable.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").notNull().references(() => driversTable.id, { onDelete: "cascade" }),
    offeredAt: timestamp("offered_at", { withTimezone: true }).notNull().defaultNow(),
    offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    response: text("response").notNull().default("offered"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("driver_offer_attempt_delivery_driver_unique").on(table.deliveryId, table.driverId),
    uniqueIndex("driver_offer_attempt_idempotency_unique").on(table.idempotencyKey),
    index("driver_offer_attempt_driver_offered_idx").on(table.driverId, table.offeredAt),
    check("driver_offer_attempt_response_check", sql`${table.response} IN ('offered', 'accepted', 'declined', 'expired')`),
    check("driver_offer_attempt_response_timestamp_check", sql`
      (${table.response} = 'offered' AND ${table.respondedAt} IS NULL)
      OR (${table.response} IN ('accepted', 'declined', 'expired') AND ${table.respondedAt} IS NOT NULL)
    `),
  ],
);

/** Immutable lifecycle evidence for every award and status transition. */
export const driverBonusEventsTable = pgTable(
  "driver_bonus_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bonusId: uuid("bonus_id").notNull().references(() => driverBonusesTable.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorProfileId: uuid("actor_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("driver_bonus_events_bonus_created_idx").on(table.bonusId, table.createdAt),
    uniqueIndex("driver_bonus_events_idempotency_key_unique").on(table.idempotencyKey),
    check("driver_bonus_events_type_check", sql`${table.type} IN ('created', 'approved', 'paid', 'reversed')`),
    check("driver_bonus_events_from_status_check", sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('pending', 'approved', 'paid', 'reversed')`),
    check("driver_bonus_events_to_status_check", sql`${table.toStatus} IS NULL OR ${table.toStatus} IN ('pending', 'approved', 'paid', 'reversed')`),
  ],
);

export const adminAuditLogsTable = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorProfileId: uuid("actor_profile_id").references(() => profilesTable.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("admin_audit_logs_actor_created_idx").on(table.actorProfileId, table.createdAt),
  ],
);

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
