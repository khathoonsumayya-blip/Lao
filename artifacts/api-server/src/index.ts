import app from "./app";
import { logger } from "./lib/logger";
import { startNotificationDeliveryWorker } from "./lib/notification-delivery-worker";
import { getStripeSync } from "./lib/stripe-client";
import { runMigrations } from "stripe-replit-sync";

async function initializeStripe(): Promise<void> {
  if (process.env.PAYMENTS_TEST_MODE === "true") {
    logger.warn("Stripe initialization skipped because PAYMENTS_TEST_MODE is enabled.");
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!databaseUrl || !domain) {
    throw new Error("DATABASE_URL and REPLIT_DOMAINS are required to initialize Stripe.");
  }

  await runMigrations({ databaseUrl });
  const stripeSync = await getStripeSync();
  await stripeSync.findOrCreateManagedWebhook(`https://${domain}/api/stripe/webhook`);
  await stripeSync.syncBackfill();
  logger.info({ webhookDomain: domain }, "Stripe synchronization initialized");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await initializeStripe();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startNotificationDeliveryWorker();
});
