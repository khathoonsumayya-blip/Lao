/**
 * DEVELOPMENT ONLY — this command intentionally never runs at application startup.
 * Run with: ALLOW_DEMO_SEED=true pnpm --filter @workspace/db run seed
 */
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_SEED !== "true") {
  throw new Error(
    "Refusing to seed. Set ALLOW_DEMO_SEED=true in a non-production environment.",
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before seeding.");
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ids = {
  customerProfile: "10000000-0000-4000-8000-000000000001",
  customerAuth: "10000000-0000-4000-8000-000000000011",
  driverProfile: "10000000-0000-4000-8000-000000000002",
  driverAuth: "10000000-0000-4000-8000-000000000012",
  adminProfile: "10000000-0000-4000-8000-000000000003",
  adminAuth: "10000000-0000-4000-8000-000000000013",
  driver: "10000000-0000-4000-8000-000000000021",
  activeDelivery: "10000000-0000-4000-8000-000000000031",
  activePublic: "10000000-0000-4000-8000-000000000041",
  completedDelivery: "10000000-0000-4000-8000-000000000032",
  completedPublic: "10000000-0000-4000-8000-000000000042",
};

const demoAdminPassword = "DemoAdmin2026!";

function passwordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO profiles (id, auth_user_id, role, first_name, last_name, email, phone)
       VALUES ($1, $2, 'customer', 'Demo', 'Customer', 'demo.customer@anything-anywhere.local', '+19195550101')
       ON CONFLICT (auth_user_id) DO UPDATE SET
         first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, status = 'active', updated_at = now()`,
      [ids.customerProfile, ids.customerAuth],
    );
    await client.query(
      `INSERT INTO profiles (id, auth_user_id, role, first_name, last_name, email, phone)
       VALUES ($1, $2, 'driver', 'Jordan', 'Miles', 'demo.driver@anything-anywhere.local', '+19195550102')
       ON CONFLICT (auth_user_id) DO UPDATE SET
         first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, status = 'active', updated_at = now()`,
      [ids.driverProfile, ids.driverAuth],
    );
    await client.query(
      `INSERT INTO profiles (id, auth_user_id, role, first_name, last_name, email, password_hash, email_verified_at)
       VALUES ($1, $2, 'admin', 'Demo', 'Admin', 'demo.admin@anything-anywhere.local', $3, now())
       ON CONFLICT (auth_user_id) DO UPDATE SET
         role = 'admin', first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
         password_hash = EXCLUDED.password_hash, email_verified_at = EXCLUDED.email_verified_at,
         status = 'active', updated_at = now()`,
      [ids.adminProfile, ids.adminAuth, passwordHash(demoAdminPassword)],
    );
    await client.query(
      `INSERT INTO drivers (id, profile_id, onboarding_status, availability_status, approval_status,
                           vehicle_type, vehicle_make, vehicle_model, vehicle_color, rating, total_deliveries)
       VALUES ($1, $2, 'complete', 'available', 'approved', 'car', 'Toyota', 'Camry', 'White', 4.98, '128')
       ON CONFLICT (profile_id) DO UPDATE SET
         availability_status = 'available', approval_status = 'approved', rating = EXCLUDED.rating, updated_at = now()`,
      [ids.driver, ids.driverProfile],
    );
    await client.query(
      `DELETE FROM customer_addresses WHERE customer_id = $1`,
      [ids.customerProfile],
    );
    await client.query(
      `INSERT INTO customer_addresses (customer_id, label, full_address, city, state, is_default)
       VALUES
         ($1, 'Home', '320 S Blount St, Raleigh, NC', 'Raleigh', 'NC', true),
         ($1, 'Work', '301 Hillsborough St, Raleigh, NC', 'Raleigh', 'NC', false)
       ON CONFLICT DO NOTHING`,
      [ids.customerProfile],
    );
    await client.query(
      `DELETE FROM delivery_status_history WHERE delivery_id IN ($1, $2)`,
      [ids.activeDelivery, ids.completedDelivery],
    );
    await client.query(
      `DELETE FROM payments WHERE delivery_id IN ($1, $2)`,
      [ids.activeDelivery, ids.completedDelivery],
    );
    await client.query(
      `DELETE FROM deliveries WHERE id IN ($1, $2)`,
      [ids.activeDelivery, ids.completedDelivery],
    );
    await client.query(
      `INSERT INTO deliveries (
        id, public_delivery_id, order_number, customer_id, driver_id,
        pickup_address, pickup_contact_name, pickup_contact_phone,
        dropoff_address, recipient_name, recipient_phone,
        package_category, weight_category, size_category, care_level, priority,
        base_price, distance_fee, care_fee, service_fee, tax, discount, total_price,
        payment_status, delivery_status, assigned_at
      ) VALUES (
        $1, $2, 'AA-10482', $3, $4,
        '410 Glenwood Ave, Raleigh, NC', 'Demo Customer', '+19195550101',
        '201 Fayetteville St, Raleigh, NC', 'Maya Johnson', '+19195550103',
        'Flowers', 'under5', 'small', 'standard', 'asap',
        '10.00', '7.50', '0.00', '0.00', '1.22', '0.00', '18.72',
        'test_paid', 'in_transit', now() - interval '30 minutes'
      ) ON CONFLICT (order_number) DO NOTHING`,
      [ids.activeDelivery, ids.activePublic, ids.customerProfile, ids.driver],
    );
    await client.query(
      `INSERT INTO deliveries (
        id, public_delivery_id, order_number, customer_id, driver_id,
        pickup_address, pickup_contact_name, pickup_contact_phone,
        dropoff_address, recipient_name, recipient_phone,
        package_category, weight_category, size_category, care_level, priority,
        base_price, distance_fee, care_fee, service_fee, tax, discount, total_price,
        payment_status, delivery_status, assigned_at, picked_up_at, delivered_at
      ) VALUES (
        $1, $2, 'AA-10461', $3, $4,
        '1201 Hillsborough St, Raleigh, NC', 'Demo Customer', '+19195550101',
        '702 Oberlin Rd, Raleigh, NC', 'Alex Rivera', '+19195550104',
        'Documents', 'under5', 'small', 'priority', 'asap',
        '10.00', '6.65', '5.00', '0.00', '1.50', '0.00', '23.15',
        'test_paid', 'delivered', now() - interval '24 hours', now() - interval '23 hours 45 minutes', now() - interval '23 hours 20 minutes'
      ) ON CONFLICT (order_number) DO NOTHING`,
      [ids.completedDelivery, ids.completedPublic, ids.customerProfile, ids.driver],
    );
    await client.query(
      `INSERT INTO delivery_status_history (delivery_id, to_status, changed_by_profile_id, reason)
       SELECT $1, status, $2, 'Development-only seeded timeline'
       FROM unnest(ARRAY['paid', 'searching_driver', 'driver_assigned', 'driver_en_route_pickup', 'picked_up', 'in_transit']::delivery_status[]) AS status
       ON CONFLICT DO NOTHING`,
      [ids.activeDelivery, ids.driverProfile],
    );
    await client.query(
      `INSERT INTO delivery_status_history (delivery_id, to_status, changed_by_profile_id, reason)
       SELECT $1, status, $2, 'Development-only seeded timeline'
       FROM unnest(ARRAY['paid', 'searching_driver', 'driver_assigned', 'driver_en_route_pickup', 'picked_up', 'in_transit', 'driver_arrived_delivery', 'delivered']::delivery_status[]) AS status
       ON CONFLICT DO NOTHING`,
      [ids.completedDelivery, ids.driverProfile],
    );
    await client.query("COMMIT");
    process.stdout.write("Development demo data seeded successfully.\n");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});