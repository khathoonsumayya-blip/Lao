import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

type StripeCredentials = {
  secretKey: string;
  publishableKey?: string;
  webhookSecret?: string;
};

/**
 * Fetches fresh Stripe credentials from the Replit connection. Credentials are
 * intentionally never cached because the connection can rotate them.
 */
export async function getStripeCredentials(): Promise<StripeCredentials> {
  if (process.env.PAYMENTS_TEST_MODE === "true") {
    return {
      secretKey: "sk_test_mock",
      publishableKey: "pk_test_mock",
      webhookSecret: "whsec_test_mock",
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const token = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (!hostname || !token) {
    throw new Error("Stripe is unavailable because the workspace connection is not configured.");
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: token },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Stripe connection lookup failed with status ${response.status}.`);
  }

  const data = (await response.json()) as {
    items?: Array<{ settings?: Record<string, unknown> }>;
  };
  const settings = data.items?.[0]?.settings;
  const readString = (...keys: string[]) => {
    for (const key of keys) {
      if (typeof settings?.[key] === "string" && settings[key].length > 0) return settings[key] as string;
    }
    return undefined;
  };
  const secretKey = readString("secret_key", "api_key", "stripe_secret_key", "secret");
  const publishableKey = readString("publishable_key", "public_key", "stripe_publishable_key", "publishable");
  const webhookSecret = readString("webhook_secret", "stripe_webhook_secret");

  if (!secretKey) {
    const availableFields = Object.keys(settings ?? {}).sort().join(", ") || "none";
    throw new Error(`Stripe is connected but is missing its secret API key. Available setting fields: ${availableFields}.`);
  }
  return { secretKey, publishableKey, webhookSecret };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  if (process.env.PAYMENTS_TEST_MODE === "true" && process.env.STRIPE_TEST_REFUND_ID) {
    return {
      refunds: {
        create: async () => ({ id: process.env.STRIPE_TEST_REFUND_ID }),
      },
    } as unknown as Stripe;
  }
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe synchronization.");

  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret,
  });
}
