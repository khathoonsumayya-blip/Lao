import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const supabaseTestDatabaseUrl = process.env.SUPABASE_TEST_DATABASE_URL;
if (!supabaseTestDatabaseUrl) {
  throw new Error(
    "SUPABASE_TEST_DATABASE_URL must point to an isolated Supabase test database before running test:rls.",
  );
}

// This process is dedicated to the isolated Supabase suite. @workspace/db reads
// DATABASE_URL while loading, so set it before dynamically importing the pool.
process.env.DATABASE_URL = supabaseTestDatabaseUrl;

const { pool } = await import("@workspace/db");
const runId = randomUUID();
const customerOneAuthUserId = randomUUID();
const customerTwoAuthUserId = randomUUID();
const driverAuthUserId = randomUUID();
const unrelatedDriverAuthUserId = randomUUID();
const dispatcherAuthUserId = randomUUID();
const adminAuthUserId = randomUUID();
const supportAuthUserId = randomUUID();
let customerOneProfileId = "";
let customerTwoProfileId = "";
let driverProfileId = "";
let unrelatedDriverProfileId = "";
let dispatcherProfileId = "";
let adminProfileId = "";
let supportProfileId = "";
let driverId = "";
let unrelatedDriverId = "";
let driverBonusId = "";
let driverOfferAttemptId = "";
let customerOneDeliveryId = "";
let customerTwoDeliveryId = "";
let customerOneTicketId = "";
let driverIncidentId = "";

const migrationPath = fileURLToPath(
  new URL("../../../lib/db/migrations/supabase_rls.sql", import.meta.url),
);

async function removeInterruptedRlsFixtures(): Promise<void> {
  const client = await pool.connect();
  try {
    const fixtureProfiles = `SELECT id FROM public.profiles WHERE email LIKE 'rls-%@example.test'`;
    const fixtureDeliveries = `SELECT id FROM public.deliveries WHERE customer_id IN (${fixtureProfiles})`;
    const fixtureDrivers = `SELECT id FROM public.drivers WHERE profile_id IN (${fixtureProfiles})`;

    await client.query(
      `DELETE FROM public.support_tickets
       WHERE customer_id IN (${fixtureProfiles}) OR delivery_id IN (${fixtureDeliveries})`,
    );
    await client.query(`DELETE FROM public.ratings WHERE delivery_id IN (${fixtureDeliveries})`);
    await client.query(`DELETE FROM public.driver_earnings WHERE delivery_id IN (${fixtureDeliveries})`);
    await client.query(`DELETE FROM public.driver_delivery_offer_attempts WHERE delivery_id IN (${fixtureDeliveries})`);
    await client.query(`DELETE FROM public.payments WHERE delivery_id IN (${fixtureDeliveries})`);
    await client.query(`DELETE FROM public.delivery_status_history WHERE delivery_id IN (${fixtureDeliveries})`);
    await client.query(`DELETE FROM public.delivery_photo_uploads WHERE delivery_id IN (${fixtureDeliveries})`);
    await client.query(`DELETE FROM public.driver_incidents WHERE driver_id IN (${fixtureDrivers})`);
    await client.query(`DELETE FROM public.deliveries WHERE id IN (${fixtureDeliveries})`);
    await client.query(`DELETE FROM public.driver_applications WHERE driver_id IN (${fixtureDrivers})`);
    await client.query(`DELETE FROM public.driver_documents WHERE driver_id IN (${fixtureDrivers})`);
    await client.query(`DELETE FROM public.drivers WHERE id IN (${fixtureDrivers})`);
    await client.query(`DELETE FROM public.profiles WHERE id IN (${fixtureProfiles})`);
  } finally {
    client.release();
  }
}

async function queryAsAuthenticated<T extends Record<string, unknown>>(
  authUserId: string,
  statement: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [authUserId]);
    const result = await client.query<T>(statement, values);
    await client.query("ROLLBACK");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function executeAsAuthenticated(
  authUserId: string,
  statement: string,
  values: unknown[] = [],
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [authUserId]);
    const result = await client.query(statement, values);
    await client.query("ROLLBACK");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

before(async () => {
  await removeInterruptedRlsFixtures();
  const client = await pool.connect();
  try {
    const profiles = await client.query<{
      id: string;
      auth_user_id: string;
    }>(
      `INSERT INTO public.profiles (auth_user_id, role, first_name, last_name, email)
       VALUES
         ($1, 'customer', 'RLS', 'Customer One', $2),
         ($3, 'customer', 'RLS', 'Customer Two', $4),
         ($5, 'driver', 'RLS', 'Driver', $6),
         ($7, 'driver', 'RLS', 'Unrelated Driver', $8),
         ($9, 'dispatcher', 'RLS', 'Dispatcher', $10),
         ($11, 'admin', 'RLS', 'Admin', $12),
         ($13, 'support', 'RLS', 'Support', $14)
       RETURNING id, auth_user_id`,
      [
        customerOneAuthUserId,
        `rls-customer-one-${runId}@example.test`,
        customerTwoAuthUserId,
        `rls-customer-two-${runId}@example.test`,
        driverAuthUserId,
        `rls-driver-${runId}@example.test`,
         unrelatedDriverAuthUserId,
         `rls-unrelated-driver-${runId}@example.test`,
        dispatcherAuthUserId,
        `rls-dispatcher-${runId}@example.test`,
        adminAuthUserId,
        `rls-admin-${runId}@example.test`,
        supportAuthUserId,
        `rls-support-${runId}@example.test`,
      ],
    );
    customerOneProfileId = profiles.rows.find((profile) => profile.auth_user_id === customerOneAuthUserId)?.id ?? "";
    customerTwoProfileId = profiles.rows.find((profile) => profile.auth_user_id === customerTwoAuthUserId)?.id ?? "";
    driverProfileId = profiles.rows.find((profile) => profile.auth_user_id === driverAuthUserId)?.id ?? "";
    unrelatedDriverProfileId = profiles.rows.find((profile) => profile.auth_user_id === unrelatedDriverAuthUserId)?.id ?? "";
    dispatcherProfileId = profiles.rows.find((profile) => profile.auth_user_id === dispatcherAuthUserId)?.id ?? "";
    adminProfileId = profiles.rows.find((profile) => profile.auth_user_id === adminAuthUserId)?.id ?? "";
    supportProfileId = profiles.rows.find((profile) => profile.auth_user_id === supportAuthUserId)?.id ?? "";
    assert.ok(
      customerOneProfileId &&
        customerTwoProfileId &&
        driverProfileId &&
        unrelatedDriverProfileId &&
        dispatcherProfileId &&
        adminProfileId &&
        supportProfileId,
    );

    const createdDrivers = await client.query<{ id: string; profile_id: string }>(
      `INSERT INTO public.drivers (profile_id, onboarding_status, availability_status, approval_status)
       VALUES
         ($1, 'complete', 'available', 'approved'),
         ($2, 'complete', 'available', 'approved')
       RETURNING id, profile_id`,
      [driverProfileId, unrelatedDriverProfileId],
    );
    driverId = createdDrivers.rows.find((driver) => driver.profile_id === driverProfileId)?.id ?? "";
    unrelatedDriverId = createdDrivers.rows.find((driver) => driver.profile_id === unrelatedDriverProfileId)?.id ?? "";
    assert.ok(driverId && unrelatedDriverId);

    const deliveries = await client.query<{ id: string; customer_id: string }>(
      `INSERT INTO public.deliveries (
         customer_id, driver_id, order_number, pickup_address, pickup_contact_name,
         pickup_contact_phone, dropoff_address, recipient_name, recipient_phone,
         package_category, weight_category, size_category, care_level, priority,
         base_price, distance_fee, care_fee, service_fee, tax, discount, total_price,
         payment_status, delivery_status
       )
       VALUES
         ($1, $2, $3, 'Pickup one', 'Pickup one', '9195550100', 'Dropoff one', 'Recipient one', '9195550101',
          'Documents', 'under5', 'small', 'standard', 'asap', 10, 0, 0, 0, 0, 0, 10, 'test_paid', 'driver_assigned'),
         ($4, NULL, $5, 'Pickup two', 'Pickup two', '9195550102', 'Dropoff two', 'Recipient two', '9195550103',
          'Documents', 'under5', 'small', 'standard', 'asap', 10, 0, 0, 0, 0, 0, 10, 'test_paid', 'searching_driver')
       RETURNING id, customer_id`,
      [
        customerOneProfileId,
        driverId,
        `RLS-${runId.slice(0, 8)}-ONE`,
        customerTwoProfileId,
        `RLS-${runId.slice(0, 8)}-TWO`,
      ],
    );
    customerOneDeliveryId = deliveries.rows.find((delivery) => delivery.customer_id === customerOneProfileId)?.id ?? "";
    customerTwoDeliveryId = deliveries.rows.find((delivery) => delivery.customer_id === customerTwoProfileId)?.id ?? "";
    assert.ok(customerOneDeliveryId && customerTwoDeliveryId);

    await client.query(
      `INSERT INTO public.delivery_status_history (delivery_id, to_status, changed_by_profile_id)
       VALUES ($1, 'driver_assigned', $2), ($3, 'searching_driver', $4)`,
      [customerOneDeliveryId, driverProfileId, customerTwoDeliveryId, customerTwoProfileId],
    );
    await client.query(
      `INSERT INTO public.payments (delivery_id, customer_id, provider, status, amount, currency, metadata)
       VALUES
         ($1, $2, 'test', 'paid', 10, 'usd', '{}'::jsonb),
         ($3, $4, 'test', 'paid', 10, 'usd', '{}'::jsonb)`,
      [customerOneDeliveryId, customerOneProfileId, customerTwoDeliveryId, customerTwoProfileId],
    );
    await client.query(
      `INSERT INTO public.ratings (delivery_id, customer_id, driver_id, score, comment)
       VALUES ($1, $2, $3, '5', 'RLS rating fixture')`,
      [customerOneDeliveryId, customerOneProfileId, driverId],
    );
    await client.query(
      `INSERT INTO public.driver_earnings (driver_id, delivery_id, gross_amount, net_amount)
       VALUES ($1, $2, 10, 10)`,
      [driverId, customerOneDeliveryId],
    );
    const bonus = await client.query<{ id: string }>(
      `INSERT INTO public.driver_bonuses (
         driver_id, amount_cents, currency, type, reason, issued_by_profile_id,
         idempotency_key, request_fingerprint
       )
       VALUES ($1, 500, 'USD', 'on_time', 'RLS bonus fixture', $2, $3, $4) RETURNING id`,
      [driverId, adminProfileId, `rls-bonus-${runId}`, `rls-fingerprint-${runId}`],
    );
    driverBonusId = bonus.rows[0]?.id ?? "";
    assert.ok(driverBonusId);
    await client.query(
      `INSERT INTO public.driver_bonus_events (bonus_id, type, to_status, actor_profile_id)
       VALUES ($1, 'created', 'pending', $2)`,
      [driverBonusId, adminProfileId],
    );
    const offerAttempt = await client.query<{ id: string }>(
      `INSERT INTO public.driver_delivery_offer_attempts (delivery_id, driver_id, response, offer_expires_at)
       VALUES ($1, $2, 'offered', '2035-01-01T00:00:00Z') RETURNING id`,
      [customerTwoDeliveryId, driverId],
    );
    driverOfferAttemptId = offerAttempt.rows[0]?.id ?? "";
    assert.ok(driverOfferAttemptId);
    await client.query(
      `INSERT INTO public.driver_documents (driver_id, document_type, storage_path)
       VALUES ($1, 'license', $2)`,
      [driverId, `/private/rls/${runId}/license.pdf`],
    );
    await client.query(
      `INSERT INTO public.driver_applications (driver_id, license_state, license_last_four)
       VALUES ($1, 'NC', '1234')`,
      [driverId],
    );
    const incident = await client.query<{ id: string }>(
      `INSERT INTO public.driver_incidents (driver_id, delivery_id, category, message)
       VALUES ($1, $2, 'safety', 'RLS incident fixture')
       RETURNING id`,
      [driverId, customerOneDeliveryId],
    );
    driverIncidentId = incident.rows[0]?.id ?? "";
    const ticket = await client.query<{ id: string }>(
      `INSERT INTO public.support_tickets (customer_id, delivery_id, category, message)
       VALUES ($1, $2, 'delivery_issue', 'RLS support fixture')
       RETURNING id`,
      [customerOneProfileId, customerOneDeliveryId],
    );
    customerOneTicketId = ticket.rows[0]?.id ?? "";
    assert.ok(driverIncidentId && customerOneTicketId);
    await client.query(
      `INSERT INTO public.support_conversation_entries (
        support_ticket_id, author_profile_id, body, visibility
      ) VALUES ($1, $2, 'Existing customer conversation', 'requester')`,
      [customerOneTicketId, customerOneProfileId],
    );
    await client.query(
      `INSERT INTO public.support_conversation_entries (
        driver_incident_id, author_profile_id, body, visibility
      ) VALUES ($1, $2, 'Existing staff conversation', 'requester')`,
      [driverIncidentId, supportProfileId],
    );
    await client.query(
      `INSERT INTO public.notifications (
        profile_id, type, title, body, support_ticket_id
      ) VALUES ($1, 'support_reply', 'Support replied', 'Ticket reply', $2)`,
      [customerOneProfileId, customerOneTicketId],
    );
    await client.query(
      `INSERT INTO public.notifications (
        profile_id, type, title, body, driver_incident_id
      ) VALUES ($1, 'support_reply', 'Support replied', 'Incident reply', $2)`,
      [driverProfileId, driverIncidentId],
    );
  } finally {
    client.release();
  }
});

after(async () => {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM public.support_tickets
       WHERE customer_id = ANY($1::uuid[]) OR delivery_id = ANY($2::uuid[])`,
      [
        [customerOneProfileId, customerTwoProfileId].filter(Boolean),
        [customerOneDeliveryId, customerTwoDeliveryId].filter(Boolean),
      ],
    );
    if (customerOneDeliveryId || customerTwoDeliveryId) {
      await client.query(
        "DELETE FROM public.ratings WHERE delivery_id = ANY($1::uuid[])",
        [[customerOneDeliveryId, customerTwoDeliveryId].filter(Boolean)],
      );
      await client.query(
        "DELETE FROM public.driver_earnings WHERE delivery_id = ANY($1::uuid[])",
        [[customerOneDeliveryId, customerTwoDeliveryId].filter(Boolean)],
      );
      await client.query(
        "DELETE FROM public.payments WHERE delivery_id = ANY($1::uuid[])",
        [[customerOneDeliveryId, customerTwoDeliveryId].filter(Boolean)],
      );
      await client.query(
        "DELETE FROM public.delivery_status_history WHERE delivery_id = ANY($1::uuid[])",
        [[customerOneDeliveryId, customerTwoDeliveryId].filter(Boolean)],
      );
      await client.query(
        "DELETE FROM public.driver_delivery_offer_attempts WHERE delivery_id = ANY($1::uuid[])",
        [[customerOneDeliveryId, customerTwoDeliveryId].filter(Boolean)],
      );
      await client.query(
        "DELETE FROM public.delivery_photo_uploads WHERE delivery_id = ANY($1::uuid[])",
        [[customerOneDeliveryId, customerTwoDeliveryId].filter(Boolean)],
      );
      await client.query(
        "DELETE FROM public.deliveries WHERE id = ANY($1::uuid[])",
        [[customerOneDeliveryId, customerTwoDeliveryId].filter(Boolean)],
      );
    }
    if (driverId || unrelatedDriverId) {
      const fixtureDriverIds = [driverId, unrelatedDriverId].filter(Boolean);
      // The production ledger trigger intentionally rejects deletes. Test
      // teardown uses the database-owner-only replication mode so fixtures do
      // not accumulate while application roles remain unable to mutate it.
      if (driverBonusId) await client.query("SET session_replication_role = replica");
      if (driverBonusId) await client.query("DELETE FROM public.driver_bonus_events WHERE bonus_id = $1", [driverBonusId]);
      if (driverBonusId) await client.query("DELETE FROM public.driver_bonuses WHERE id = $1", [driverBonusId]);
      if (driverBonusId) await client.query("SET session_replication_role = origin");
      await client.query("DELETE FROM public.driver_incidents WHERE driver_id = ANY($1::uuid[])", [fixtureDriverIds]);
      await client.query("DELETE FROM public.driver_applications WHERE driver_id = ANY($1::uuid[])", [fixtureDriverIds]);
      await client.query("DELETE FROM public.driver_documents WHERE driver_id = ANY($1::uuid[])", [fixtureDriverIds]);
      await client.query("DELETE FROM public.drivers WHERE id = ANY($1::uuid[])", [fixtureDriverIds]);
    }
    await client.query(
      "DELETE FROM public.profiles WHERE id = ANY($1::uuid[])",
      [[
        customerOneProfileId,
        customerTwoProfileId,
        driverProfileId,
        unrelatedDriverProfileId,
        dispatcherProfileId,
        adminProfileId,
        supportProfileId,
      ].filter(Boolean)],
    );
  } finally {
    client.release();
    await pool.end();
  }
});

test("deploys every policy declared by the Supabase RLS migration", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const expectedPolicyNames = [...migration.matchAll(/CREATE POLICY "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(expectedPolicyNames.length > 0, "The RLS migration must declare at least one policy.");

  const result = await pool.query<{ policyname: string }>(
    `SELECT policyname
     FROM pg_policies
     WHERE schemaname = 'public' AND policyname = ANY($1::text[])`,
    [expectedPolicyNames],
  );
  assert.deepEqual(
    new Set(result.rows.map((row) => row.policyname)),
    new Set(expectedPolicyNames),
    "The isolated Supabase database must have every policy from supabase_rls.sql applied.",
  );
});

test("keeps driver bonus rows and their append-only events private to the owning driver", async () => {
  const ownBonuses = await queryAsAuthenticated<{ id: string }>(driverAuthUserId, "SELECT id FROM public.driver_bonuses");
  assert.deepEqual(ownBonuses.map((row) => row.id), [driverBonusId]);
  const otherBonuses = await queryAsAuthenticated<{ id: string }>(unrelatedDriverAuthUserId, "SELECT id FROM public.driver_bonuses");
  assert.equal(otherBonuses.length, 0);
  const ownEvents = await queryAsAuthenticated<{ bonus_id: string }>(driverAuthUserId, "SELECT bonus_id FROM public.driver_bonus_events");
  assert.deepEqual(ownEvents.map((row) => row.bonus_id), [driverBonusId]);
  const otherEvents = await queryAsAuthenticated<{ bonus_id: string }>(unrelatedDriverAuthUserId, "SELECT bonus_id FROM public.driver_bonus_events");
  assert.equal(otherEvents.length, 0);
  const adminBonuses = await queryAsAuthenticated<{ id: string }>(adminAuthUserId, "SELECT id FROM public.driver_bonuses");
  assert.deepEqual(adminBonuses, [], "staff must use the elevated server API for bonus data");
  const adminEvents = await queryAsAuthenticated<{ id: string }>(adminAuthUserId, "SELECT id FROM public.driver_bonus_events");
  assert.deepEqual(adminEvents, [], "staff must use the elevated server API for bonus events");
  const mutations = await executeAsAuthenticated(
    driverAuthUserId,
    "UPDATE public.driver_bonus_events SET reason = 'tampered' WHERE bonus_id = $1",
    [driverBonusId],
  );
  assert.equal(mutations, 0, "drivers have no write policy for the immutable bonus event ledger");
});

test("keeps offer attempts visible only to their owning driver and denies direct mutations", async () => {
  const ownAttempts = await queryAsAuthenticated<{ id: string }>(
    driverAuthUserId,
    "SELECT id FROM public.driver_delivery_offer_attempts",
  );
  assert.deepEqual(ownAttempts.map((row) => row.id), [driverOfferAttemptId]);
  for (const authUserId of [unrelatedDriverAuthUserId, customerOneAuthUserId, adminAuthUserId]) {
    const attempts = await queryAsAuthenticated<{ id: string }>(
      authUserId,
      "SELECT id FROM public.driver_delivery_offer_attempts",
    );
    assert.deepEqual(attempts, []);
  }
  const updates = await executeAsAuthenticated(
    driverAuthUserId,
    "UPDATE public.driver_delivery_offer_attempts SET response = 'declined', responded_at = now() WHERE id = $1",
    [driverOfferAttemptId],
  );
  assert.equal(updates, 0, "drivers have no direct offer-attempt update policy");
  await assert.rejects(
    executeAsAuthenticated(
      driverAuthUserId,
      `INSERT INTO public.driver_delivery_offer_attempts (delivery_id, driver_id, response, offer_expires_at)
       VALUES ($1, $2, 'offered', '2035-01-01T00:00:00Z')`,
      [customerOneDeliveryId, driverId],
    ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "42501");
      return true;
    },
  );
});


test("enforces customer and assigned-driver delivery ownership through RLS", async () => {
  const customerOneDeliveries = await queryAsAuthenticated<{ id: string }>(
    customerOneAuthUserId,
    "SELECT id FROM public.deliveries ORDER BY id",
  );
  assert.deepEqual(customerOneDeliveries.map((delivery) => delivery.id), [customerOneDeliveryId]);

  const customerTwoPayments = await queryAsAuthenticated<{ delivery_id: string }>(
    customerTwoAuthUserId,
    "SELECT delivery_id FROM public.payments ORDER BY delivery_id",
  );
  assert.deepEqual(customerTwoPayments.map((payment) => payment.delivery_id), [customerTwoDeliveryId]);

  const assignedDriverDeliveries = await queryAsAuthenticated<{ id: string }>(
    driverAuthUserId,
    "SELECT id FROM public.deliveries ORDER BY id",
  );
  assert.deepEqual(assignedDriverDeliveries.map((delivery) => delivery.id), [customerOneDeliveryId]);

  const assignedDriverHistory = await queryAsAuthenticated<{ delivery_id: string }>(
    driverAuthUserId,
    "SELECT delivery_id FROM public.delivery_status_history ORDER BY delivery_id",
  );
  assert.deepEqual(assignedDriverHistory.map((history) => history.delivery_id), [customerOneDeliveryId]);
});

test("allows only an assigned driver to publish an active delivery location", async () => {
  const activeLocationCount = await executeAsAuthenticated(
    driverAuthUserId,
    `INSERT INTO public.driver_locations (
       delivery_id, driver_id, latitude, longitude, accuracy_meters, captured_at
     )
     VALUES ($1, $2, 35.7796, -78.6382, 8, '2026-08-22T12:00:00Z')`,
    [customerOneDeliveryId, driverId],
  );
  assert.equal(activeLocationCount, 1);

  const locationInsert = `INSERT INTO public.driver_locations (
    delivery_id, driver_id, latitude, longitude, accuracy_meters, captured_at
  ) VALUES ($1, $2, 35.7796, -78.6382, 8, '2026-08-22T12:00:00Z')`;
  const assertRlsRejected = async (
    authUserId: string,
    deliveryId: string,
    locationDriverId: string,
  ) => {
    await assert.rejects(
      executeAsAuthenticated(authUserId, locationInsert, [deliveryId, locationDriverId]),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "42501");
        return true;
      },
    );
  };

  await assertRlsRejected(customerOneAuthUserId, customerOneDeliveryId, driverId);
  await assertRlsRejected(unrelatedDriverAuthUserId, customerOneDeliveryId, unrelatedDriverId);
  await assertRlsRejected(driverAuthUserId, customerTwoDeliveryId, driverId);
});

test("allows only delivery participants to attach delivery photos", async () => {
  const photoInsert = `INSERT INTO public.delivery_photos (
    delivery_id, uploaded_by_profile_id, storage_path, content_type, size_bytes
  ) VALUES ($1, $2, $3, 'image/jpeg', 1024)
  RETURNING id, delivery_id, uploaded_by_profile_id`;

  const driverPhoto = await queryAsAuthenticated<{
    id: string;
    delivery_id: string;
    uploaded_by_profile_id: string;
  }>(
    driverAuthUserId,
    photoInsert,
    [customerOneDeliveryId, driverProfileId, `/private/rls/${runId}/driver.jpg`],
  );
  assert.equal(driverPhoto.length, 1);
  assert.equal(driverPhoto[0]?.delivery_id, customerOneDeliveryId);
  assert.equal(driverPhoto[0]?.uploaded_by_profile_id, driverProfileId);

  const customerPhoto = await queryAsAuthenticated<{
    id: string;
    delivery_id: string;
    uploaded_by_profile_id: string;
  }>(
    customerOneAuthUserId,
    photoInsert,
    [customerOneDeliveryId, customerOneProfileId, `/private/rls/${runId}/customer.jpg`],
  );
  assert.equal(customerPhoto.length, 1);
  assert.equal(customerPhoto[0]?.delivery_id, customerOneDeliveryId);
  assert.equal(customerPhoto[0]?.uploaded_by_profile_id, customerOneProfileId);

  const assertPhotoInsertRlsRejected = async (authUserId: string, profileId: string) => {
    await assert.rejects(
      queryAsAuthenticated(
        authUserId,
        photoInsert,
        [customerOneDeliveryId, profileId, `/private/rls/${runId}/${authUserId}.jpg`],
      ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "42501");
        return true;
      },
    );
  };

  await assertPhotoInsertRlsRejected(customerTwoAuthUserId, customerTwoProfileId);
  await assertPhotoInsertRlsRejected(unrelatedDriverAuthUserId, unrelatedDriverProfileId);
  await assertPhotoInsertRlsRejected(dispatcherAuthUserId, dispatcherProfileId);
});

test("allows only delivery participants to create their own temporary photo uploads", async () => {
  const uploadInsert = `INSERT INTO public.delivery_photo_uploads (
    delivery_id, uploader_profile_id, storage_path, content_type, size_bytes, expires_at
  ) VALUES ($1, $2, $3, 'image/jpeg', 1024, '2026-09-03T13:00:00Z')`;

  const authorizedUploadCount = await executeAsAuthenticated(
    driverAuthUserId,
    uploadInsert,
    [customerOneDeliveryId, driverProfileId, `/private/rls/${runId}/authorized-upload.jpg`],
  );
  assert.equal(authorizedUploadCount, 1);

  const assertUploadInsertRlsRejected = async (
    authUserId: string,
    deliveryId: string,
    uploaderProfileId: string,
    fixtureName: string,
  ) => {
    await assert.rejects(
      executeAsAuthenticated(
        authUserId,
        uploadInsert,
        [deliveryId, uploaderProfileId, `/private/rls/${runId}/${fixtureName}.jpg`],
      ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "42501");
        return true;
      },
    );
  };

  await assertUploadInsertRlsRejected(
    customerTwoAuthUserId,
    customerOneDeliveryId,
    customerTwoProfileId,
    "unrelated-customer",
  );
  await assertUploadInsertRlsRejected(
    unrelatedDriverAuthUserId,
    customerOneDeliveryId,
    unrelatedDriverProfileId,
    "unrelated-driver",
  );
  await assertUploadInsertRlsRejected(
    dispatcherAuthUserId,
    customerOneDeliveryId,
    dispatcherProfileId,
    "dispatcher",
  );
  await assertUploadInsertRlsRejected(
    driverAuthUserId,
    customerOneDeliveryId,
    customerOneProfileId,
    "spoofed-uploader",
  );
});

test("keeps private driver review data and ticket workflow scoped to authorized staff", async () => {
  const dispatcherDocuments = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.driver_documents");
  const dispatcherDrivers = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.drivers");
  const dispatcherProfiles = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.profiles");
  const dispatcherDeliveries = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.deliveries");
  const dispatcherApplications = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.driver_applications");
  const dispatcherIncidents = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.driver_incidents");
  const dispatcherRatings = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.ratings");
  const dispatcherEarnings = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.driver_earnings");
  const dispatcherTickets = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.support_tickets");
  const dispatcherPromos = await queryAsAuthenticated<{ id: string }>(dispatcherAuthUserId, "SELECT id FROM public.promo_codes");
  assert.deepEqual(dispatcherDocuments, []);
  assert.deepEqual(dispatcherDrivers, []);
  assert.deepEqual(dispatcherProfiles, [ { id: dispatcherProfileId } ]);
  assert.deepEqual(dispatcherDeliveries, []);
  assert.deepEqual(dispatcherApplications, []);
  assert.deepEqual(dispatcherIncidents, []);
  assert.deepEqual(dispatcherRatings, []);
  assert.deepEqual(dispatcherEarnings, []);
  assert.deepEqual(dispatcherTickets, []);
  assert.deepEqual(dispatcherPromos, []);

  const dispatcherTicketUpdate = await queryAsAuthenticated<{ id: string }>(
    dispatcherAuthUserId,
    "UPDATE public.support_tickets SET status = 'resolved' RETURNING id",
  );
  assert.deepEqual(dispatcherTicketUpdate, []);

  const adminDocuments = await queryAsAuthenticated<{ id: string }>(adminAuthUserId, "SELECT id FROM public.driver_documents");
  const adminApplications = await queryAsAuthenticated<{ id: string }>(adminAuthUserId, "SELECT id FROM public.driver_applications");
  const adminIncidents = await queryAsAuthenticated<{ id: string }>(adminAuthUserId, "SELECT id FROM public.driver_incidents");
  const adminRatings = await queryAsAuthenticated<{ id: string }>(adminAuthUserId, "SELECT id FROM public.ratings");
  const adminEarnings = await queryAsAuthenticated<{ id: string }>(adminAuthUserId, "SELECT id FROM public.driver_earnings");
  const adminPayments = await queryAsAuthenticated<{ id: string }>(adminAuthUserId, "SELECT id FROM public.payments");
  const supportTickets = await queryAsAuthenticated<{ id: string }>(supportAuthUserId, "SELECT id FROM public.support_tickets");
  assert.equal(adminDocuments.length, 1);
  assert.equal(adminApplications.length, 1);
  assert.equal(adminIncidents.length, 1);
  assert.equal(adminRatings.length, 1);
  assert.equal(adminEarnings.length, 1);
  assert.equal(adminPayments.length, 2);
  assert.equal(supportTickets.length, 1);
});

test("scopes requester conversations to their owning ticket or incident while allowing staff replies", async () => {
  const ticketReply = `INSERT INTO public.support_conversation_entries (
    support_ticket_id, author_profile_id, body, visibility
  ) VALUES ($1, $2, 'Customer follow-up', 'requester') RETURNING id`;
  const customerReply = await queryAsAuthenticated<{ id: string }>(
    customerOneAuthUserId, ticketReply, [customerOneTicketId, customerOneProfileId],
  );
  assert.equal(customerReply.length, 1);

  const staffReply = await queryAsAuthenticated<{ id: string }>(
    supportAuthUserId,
    `INSERT INTO public.support_conversation_entries (
      driver_incident_id, author_profile_id, body, visibility
    ) VALUES ($1, $2, 'Support follow-up', 'requester') RETURNING id`,
    [driverIncidentId, supportProfileId],
  );
  assert.equal(staffReply.length, 1);

  const ownTicketEntries = await queryAsAuthenticated<{ id: string }>(
    customerOneAuthUserId, "SELECT id FROM public.support_conversation_entries WHERE support_ticket_id = $1", [customerOneTicketId],
  );
  assert.equal(ownTicketEntries.length, 1);
  const ownIncidentEntries = await queryAsAuthenticated<{ id: string }>(
    driverAuthUserId, "SELECT id FROM public.support_conversation_entries WHERE driver_incident_id = $1", [driverIncidentId],
  );
  assert.equal(ownIncidentEntries.length, 1);

  const crossUserEntries = await queryAsAuthenticated<{ id: string }>(
    customerTwoAuthUserId, "SELECT id FROM public.support_conversation_entries WHERE support_ticket_id = $1", [customerOneTicketId],
  );
  assert.deepEqual(crossUserEntries, []);
  await assert.rejects(
    executeAsAuthenticated(customerTwoAuthUserId, ticketReply, [customerOneTicketId, customerTwoProfileId]),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "42501");
      return true;
    },
  );
});

test("scopes linked support notifications to the owning requester under RLS", async () => {
  const customerNotifications = await queryAsAuthenticated<{
    support_ticket_id: string | null;
    driver_incident_id: string | null;
  }>(
    customerOneAuthUserId,
    "SELECT support_ticket_id, driver_incident_id FROM public.notifications ORDER BY created_at",
  );
  assert.deepEqual(customerNotifications, [{ support_ticket_id: customerOneTicketId, driver_incident_id: null }]);

  const driverNotifications = await queryAsAuthenticated<{
    support_ticket_id: string | null;
    driver_incident_id: string | null;
  }>(
    driverAuthUserId,
    "SELECT support_ticket_id, driver_incident_id FROM public.notifications ORDER BY created_at",
  );
  assert.deepEqual(driverNotifications, [{ support_ticket_id: null, driver_incident_id: driverIncidentId }]);

  const crossUserNotifications = await queryAsAuthenticated<{ id: string }>(
    customerTwoAuthUserId,
    "SELECT id FROM public.notifications",
  );
  assert.deepEqual(crossUserNotifications, []);
});