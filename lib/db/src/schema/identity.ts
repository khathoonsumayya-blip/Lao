import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const profileRoleEnum = pgEnum("profile_role", [
  "customer",
  "driver",
  "dispatcher",
  "support",
  "admin",
]);

export const profilesTable = pgTable(
  "profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authUserId: uuid("auth_user_id").notNull().unique(),
    role: profileRoleEnum("role").notNull().default("customer"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    phone: text("phone"),
    address: text("address"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    avatarUrl: text("avatar_url"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("profiles_role_idx").on(table.role),
  ],
);

export const sessionsTable = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sessions_profile_id_idx").on(table.profileId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("password_reset_tokens_profile_id_idx").on(table.profileId),
    index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

export const customerAddressesTable = pgTable(
  "customer_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    fullAddress: text("full_address").notNull(),
    street: text("street"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    instructions: text("instructions"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("customer_addresses_customer_id_idx").on(table.customerId)],
);

export const contactsTable = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    relationship: text("relationship"),
    addressId: uuid("address_id").references(() => customerAddressesTable.id, {
      onDelete: "set null",
    }),
    instructions: text("instructions"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("contacts_customer_id_idx").on(table.customerId),
    index("contacts_address_id_idx").on(table.addressId),
  ],
);

export const driversTable = pgTable(
  "drivers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .unique()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    onboardingStatus: text("onboarding_status").notNull().default("pending"),
    availabilityStatus: text("availability_status").notNull().default("offline"),
    approvalStatus: text("approval_status").notNull().default("pending"),
    vehicleType: text("vehicle_type"),
    vehicleMake: text("vehicle_make"),
    vehicleModel: text("vehicle_model"),
    vehicleColor: text("vehicle_color"),
    licensePlate: text("license_plate"),
    vehicleYear: text("vehicle_year"),
    rating: doublePrecision("rating").notNull().default(5),
    totalDeliveries: text("total_deliveries").notNull().default("0"),
    currentLatitude: doublePrecision("current_latitude"),
    currentLongitude: doublePrecision("current_longitude"),
    lastLocationUpdate: timestamp("last_location_update", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("drivers_availability_idx").on(table.availabilityStatus),
  ],
);

export const driverDocumentsTable = pgTable(
  "driver_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => driversTable.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    storagePath: text("storage_path").notNull(),
    verificationStatus: text("verification_status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    expiryDate: date("expiry_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("driver_documents_driver_id_idx").on(table.driverId)],
);

export const profilesRelations = relations(profilesTable, ({ many, one }) => ({
  addresses: many(customerAddressesTable),
  contacts: many(contactsTable),
  sessions: many(sessionsTable),
  passwordResetTokens: many(passwordResetTokensTable),
  driver: one(driversTable),
}));

export const customerAddressesRelations = relations(customerAddressesTable, ({ one, many }) => ({
  customer: one(profilesTable, {
    fields: [customerAddressesTable.customerId],
    references: [profilesTable.id],
  }),
  contacts: many(contactsTable),
}));

export const driversRelations = relations(driversTable, ({ one, many }) => ({
  profile: one(profilesTable, {
    fields: [driversTable.profileId],
    references: [profilesTable.id],
  }),
  documents: many(driverDocumentsTable),
}));

export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;