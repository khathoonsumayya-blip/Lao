import { relations } from "drizzle-orm";
import {
  doublePrecision,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { driversTable, profilesTable } from "./identity";

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "draft",
  "quoted",
  "payment_pending",
  "paid",
  "searching_driver",
  "driver_assigned",
  "driver_en_route_pickup",
  "driver_arrived_pickup",
  "pickup_verified",
  "picked_up",
  "in_transit",
  "driver_arrived_delivery",
  "delivery_verification_pending",
  "delivered",
  "cancelled",
  "failed",
  "refunded",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "test_pending",
  "test_paid",
  "pending",
  "authorized",
  "paid",
  "failed",
  "refunded",
]);

export const deliveriesTable = pgTable(
  "deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicDeliveryId: uuid("public_delivery_id").defaultRandom().notNull().unique(),
    orderNumber: text("order_number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "restrict" }),
    checkoutRequestKey: text("checkout_request_key").unique(),
    quoteId: uuid("quote_id").references(() => deliveryQuotesTable.id, { onDelete: "restrict" }),
    driverId: uuid("driver_id").references(() => driversTable.id, { onDelete: "set null" }),
    // Captured once at assignment so later approved profile changes cannot
    // rewrite the vehicle information associated with an active delivery.
    driverVehicleSnapshot: jsonb("driver_vehicle_snapshot").$type<{
      vehicleType: string | null;
      vehicleMake: string | null;
      vehicleModel: string | null;
      vehicleColor: string | null;
      licensePlate: string | null;
      vehicleYear: string | null;
    }>(),
    pickupAddress: text("pickup_address").notNull(),
    pickupContactName: text("pickup_contact_name").notNull(),
    pickupContactPhone: text("pickup_contact_phone").notNull(),
    pickupInstructions: text("pickup_instructions"),
    pickupLatitude: doublePrecision("pickup_latitude"),
    pickupLongitude: doublePrecision("pickup_longitude"),
    mapMode: text("map_mode").notNull().default("demo"),
    dropoffAddress: text("dropoff_address").notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    deliveryInstructions: text("delivery_instructions"),
    deliveryLatitude: doublePrecision("delivery_latitude"),
    deliveryLongitude: doublePrecision("delivery_longitude"),
    prohibitedItemsConfirmed: boolean("prohibited_items_confirmed").notNull().default(false),
    prohibitedItemsConfirmedAt: timestamp("prohibited_items_confirmed_at", { withTimezone: true }),
    prohibitedItemsPolicyVersion: text("prohibited_items_policy_version"),
    packageCategory: text("package_category").notNull(),
    packageDescription: text("package_description"),
    weightCategory: text("weight_category").notNull(),
    sizeCategory: text("size_category").notNull(),
    careLevel: text("care_level").notNull(),
    priority: text("priority").notNull(),
    distanceMiles: doublePrecision("distance_miles"),
    estimatedDurationMinutes: text("estimated_duration_minutes"),
    basePrice: numeric("base_price", { precision: 10, scale: 2 }).notNull(),
    distanceFee: numeric("distance_fee", { precision: 10, scale: 2 }).notNull(),
    careFee: numeric("care_fee", { precision: 10, scale: 2 }).notNull(),
    serviceFee: numeric("service_fee", { precision: 10, scale: 2 }).notNull().default("0"),
    tax: numeric("tax", { precision: 10, scale: 2 }).notNull(),
    discount: numeric("discount", { precision: 10, scale: 2 }).notNull().default("0"),
    totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("test_paid"),
    deliveryStatus: deliveryStatusEnum("delivery_status").notNull().default("searching_driver"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    /** Immutable quoted pickup window. scheduledAt is retained as the legacy start alias. */
    scheduledPickupStartAt: timestamp("scheduled_pickup_start_at", { withTimezone: true }),
    scheduledPickupEndAt: timestamp("scheduled_pickup_end_at", { withTimezone: true }),
    /** Immutable start of automatic driver search; dispatch stages never reset. */
    dispatchStartedAt: timestamp("dispatch_started_at", { withTimezone: true }),
    offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("deliveries_customer_created_idx").on(table.customerId, table.createdAt),
    index("deliveries_driver_status_idx").on(table.driverId, table.deliveryStatus),
    index("deliveries_status_created_idx").on(table.deliveryStatus, table.createdAt),
  ],
);

export const deliveryStatusHistoryTable = pgTable(
  "delivery_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    fromStatus: deliveryStatusEnum("from_status"),
    toStatus: deliveryStatusEnum("to_status").notNull(),
    changedByProfileId: uuid("changed_by_profile_id").references(() => profilesTable.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("delivery_status_history_delivery_created_idx").on(table.deliveryId, table.createdAt),
  ],
);

export const driverLocationsTable = pgTable(
  "driver_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id").references(() => deliveriesTable.id, {
      onDelete: "set null",
    }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => driversTable.id, { onDelete: "cascade" }),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyMeters: doublePrecision("accuracy_meters"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("driver_locations_driver_captured_idx").on(table.driverId, table.capturedAt),
    index("driver_locations_delivery_captured_idx").on(table.deliveryId, table.capturedAt),
  ],
);

export const deliveryPhotosTable = pgTable(
  "delivery_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    uploadedByProfileId: uuid("uploaded_by_profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "restrict" }),
    storagePath: text("storage_path").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: numeric("size_bytes", { precision: 12, scale: 0 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("delivery_photos_delivery_created_idx").on(table.deliveryId, table.createdAt),
    index("delivery_photos_uploaded_by_idx").on(table.uploadedByProfileId),
  ],
);

export const deliveryPhotoUploadsTable = pgTable(
  "delivery_photo_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    uploaderProfileId: uuid("uploader_profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: numeric("size_bytes", { precision: 12, scale: 0 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("delivery_photo_uploads_expiry_idx").on(table.expiresAt),
    index("delivery_photo_uploads_owner_idx").on(table.deliveryId, table.uploaderProfileId, table.expiresAt),
  ],
);

export const deliveryQuotesTable = pgTable(
  "delivery_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    request: jsonb("request").$type<Record<string, string>>().notNull(),
    response: jsonb("response").$type<Record<string, string | number>>().notNull(),
    /** Immutable quote snapshot of the requested pickup window. */
    scheduledPickupStartAt: timestamp("scheduled_pickup_start_at", { withTimezone: true }),
    scheduledPickupEndAt: timestamp("scheduled_pickup_end_at", { withTimezone: true }),
    pricingVersion: text("pricing_version").notNull().default("v1"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("delivery_quotes_customer_created_idx").on(table.customerId, table.createdAt)],
);

export const deliveriesRelations = relations(deliveriesTable, ({ one, many }) => ({
  customer: one(profilesTable, {
    fields: [deliveriesTable.customerId],
    references: [profilesTable.id],
    relationName: "deliveryCustomer",
  }),
  driver: one(driversTable, {
    fields: [deliveriesTable.driverId],
    references: [driversTable.id],
  }),
  statusHistory: many(deliveryStatusHistoryTable),
  locations: many(driverLocationsTable),
  photos: many(deliveryPhotosTable),
  pendingPhotoUploads: many(deliveryPhotoUploadsTable),
}));

export const insertDeliverySchema = createInsertSchema(deliveriesTable).omit({
  id: true,
  publicDeliveryId: true,
  orderNumber: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDelivery = z.infer<typeof insertDeliverySchema>;
export type DeliveryRecord = typeof deliveriesTable.$inferSelect;