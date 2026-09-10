import type Stripe from "stripe";
import { logger } from "./logger";
import { processVerifiedStripeEvent } from "./payment-webhook-service";
import { getStripeSync } from "./stripe-client";

export class WebhookHandlers {
  static async processStripeWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error("Stripe webhook payload must be the unparsed request Buffer.");
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
    // Stripe Sync validates the raw payload against the managed endpoint secret
    // before returning. Parse it only after that signature verification succeeds.
    const event = JSON.parse(payload.toString("utf8")) as Stripe.Event;
    const result = await processVerifiedStripeEvent(event);
    logger.info({ providerEventId: event.id, eventType: event.type, disposition: result.disposition }, "Stripe webhook handled");
  }
}