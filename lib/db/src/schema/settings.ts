import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { driversTable, profilesTable } from "./identity";

/** One row, keyed by "general", holds application-wide business presentation defaults. */
export const generalSettingsTable = pgTable("general_settings", {
  id: text("id").primaryKey().default("general"),
  businessName: text("business_name").notNull(),
  appName: text("app_name").notNull(),
  tagline: text("tagline").notNull().default(""),
  businessEmail: text("business_email").notNull(),
  supportEmail: text("support_email").notNull(),
  supportPhone: text("support_phone").notNull().default(""),
  businessAddress: text("business_address").notNull().default(""),
  website: text("website").notNull().default(""),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  country: text("country").notNull().default("US"),
  timeZone: text("time_zone").notNull().default("America/New_York"),
  dateFormat: text("date_format").notNull().default("MM/dd/yyyy"),
  distanceUnit: text("distance_unit").notNull().default("mi"),
  updatedByProfileId: uuid("updated_by_profile_id").references(() => profilesTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGeneralSettingsSchema = createInsertSchema(generalSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGeneralSettings = z.infer<typeof insertGeneralSettingsSchema>;
export type GeneralSettings = typeof generalSettingsTable.$inferSelect;

/** Non-secret, administrator-controlled policy. These singleton rows never contain connector credentials. */
export const securitySettingsTable = pgTable("security_settings", {
  id: text("id").primaryKey().default("security"),
  sessionTimeoutMinutes: text("session_timeout_minutes").notNull().default("60"),
  suspiciousLoginAlerts: text("suspicious_login_alerts").notNull().default("true"),
  updatedByProfileId: uuid("updated_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const paymentFeeSettingsTable = pgTable("payment_fee_settings", {
  id: text("id").primaryKey().default("payments"),
  currency: text("currency").notNull().default("USD"),
  customerServiceFeeCents: text("customer_service_fee_cents").notNull().default("0"),
  deliveryFeeCents: text("delivery_fee_cents").notNull().default("0"),
  smallOrderThresholdCents: text("small_order_threshold_cents").notNull().default("0"),
  smallOrderFeeCents: text("small_order_fee_cents").notNull().default("0"),
  taxRateBasisPoints: text("tax_rate_basis_points").notNull().default("0"),
  refundWindowDays: text("refund_window_days").notNull().default("30"),
  updatedByProfileId: uuid("updated_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const emailSettingsTable = pgTable("email_settings", {
  id: text("id").primaryKey().default("email"),
  senderDisplayName: text("sender_display_name").notNull().default("Anything Anywhere"),
  replyToEmail: text("reply_to_email"),
  supportEmail: text("support_email"),
  welcomeEnabled: text("welcome_enabled").notNull().default("true"),
  passwordResetEnabled: text("password_reset_enabled").notNull().default("true"),
  orderConfirmationEnabled: text("order_confirmation_enabled").notNull().default("true"),
  orderDeliveredEnabled: text("order_delivered_enabled").notNull().default("true"),
  updatedByProfileId: uuid("updated_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Server-owned operational preferences. Device notification permission is never stored here. */
export const driverPreferencesTable = pgTable("driver_preferences", {
  driverId: uuid("driver_id").primaryKey().references(() => driversTable.id, { onDelete: "cascade" }),
  notificationSound: boolean("notification_sound").notNull().default(true),
  vibration: boolean("vibration").notNull().default(true),
  workingHoursEnabled: boolean("working_hours_enabled").notNull().default(false),
  navigationApp: text("navigation_app").notNull().default("system"),
  preferredMaxRangeMiles: integer("preferred_max_range_miles").notNull().default(12),
  workingHours: jsonb("working_hours").$type<Record<string, Array<{ start: string; end: string }>>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Singleton dispatch policy. Timings are elapsed minutes from offer/search start. */
export const dispatchSettingsTable = pgTable("dispatch_settings", {
  id: text("id").primaryKey().default("dispatch"),
  initialRadiusMiles: integer("initial_radius_miles").notNull().default(3),
  maximumRadiusMiles: integer("maximum_radius_miles").notNull().default(12),
  initialDurationSeconds: integer("initial_duration_seconds").notNull().default(30),
  expansionStages: jsonb("expansion_stages").$type<Array<{ radiusMiles: number; durationSeconds: number }>>()
    .notNull().default([{ radiusMiles: 5, durationSeconds: 30 }, { radiusMiles: 8, durationSeconds: 60 }, { radiusMiles: 12, durationSeconds: 480 }]),
  maximumPickupEtaMinutes: integer("maximum_pickup_eta_minutes").notNull().default(15),
  totalExpirationSeconds: integer("total_expiration_seconds").notNull().default(600),
  updatedByProfileId: uuid("updated_by_profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});