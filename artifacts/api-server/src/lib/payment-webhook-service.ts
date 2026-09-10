import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import {
  adminAuditLogsTable,
  db,
  deliveriesTable,
  deliveryStatusHistoryTable,
  paymentWebhookEventsTable,
  paymentsTable,
  refundOperationsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { publishDeliveryEvent, recordDeliveryEvent, type DeliveryEvent } from "./delivery-events";
import { createDispatchAlertsForDelivery } from "./delivery-service";

type PaymentAction = "succeeded" | "failed" | "refunded" | "partial_refund";

type PaymentWebhookResult =
  | { disposition: "processed"; action: PaymentAction }
  | { disposition: "duplicate" }
  | { disposition: "ignored"; action: PaymentAction };

function eventDetails(event: Stripe.Event): {
  action: PaymentAction;
  paymentIntentId: string;
  metadata: Record<string, unknown>;
} | null {
  const object = event.data.object as unknown as Record<string, unknown>;
  const objectId = typeof object.id === "string" ? object.id : null;
  const intent =
    typeof object.payment_intent === "string"
      ? object.payment_intent
      : object.payment_intent && typeof object.payment_intent === "object" && "id" in object.payment_intent
        ? String((object.payment_intent as { id: unknown }).id)
        : null;

  if (event.type === "payment_intent.succeeded" && objectId) {
    return { action: "succeeded", paymentIntentId: objectId, metadata: { intentStatus: object.status ?? null } };
  }
  if ((event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") && objectId) {
    return { action: "failed", paymentIntentId: objectId, metadata: { intentStatus: object.status ?? null, terminal: event.type === "payment_intent.canceled" } };
  }
  if (event.type === "charge.refunded" && intent) {
    const amount = typeof object.amount === "number" ? object.amount : null;
    const amountRefunded = typeof object.amount_refunded === "number" ? object.amount_refunded : null;
    const fullyRefunded = object.refunded === true || (amount !== null && amountRefunded !== null && amountRefunded >= amount);
    return {
      action: fullyRefunded ? "refunded" : "partial_refund",
      paymentIntentId: intent,
      metadata: { chargeStatus: object.status ?? null, amount, amountRefunded, fullyRefunded },
    };
  }
  return null;
}

async function auditDuplicate(paymentIntentId: string, providerEventId: string): Promise<void> {
  const [payment] = await db
    .select({ id: paymentsTable.id, deliveryId: paymentsTable.deliveryId })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.provider, "stripe"), eq(paymentsTable.providerPaymentId, paymentIntentId)))
    .limit(1);
  if (!payment) return;

  await db.insert(adminAuditLogsTable).values({
    action: "payment.webhook_duplicate",
    entityType: "payment",
    entityId: payment.id,
    metadata: { provider: "stripe", providerEventId },
  });
}

/**
 * Applies a verified Stripe event. The unique provider-event ledger and the
 * row lock ensure repeated or concurrent deliveries of the same event cannot
 * progress a delivery twice.
 */
export async function processVerifiedStripeEvent(event: Stripe.Event): Promise<PaymentWebhookResult> {
  const details = eventDetails(event);
  if (!details) return { disposition: "ignored", action: "failed" };
  let deliveryEvent: DeliveryEvent | null = null;

  const result = await db.transaction(async (tx): Promise<PaymentWebhookResult> => {
    const [payment] = await tx
      .select()
      .from(paymentsTable)
      .where(and(eq(paymentsTable.provider, "stripe"), eq(paymentsTable.providerPaymentId, details.paymentIntentId)))
      .limit(1);
    if (!payment) {
      throw new Error(`No delivery payment matches Stripe PaymentIntent ${details.paymentIntentId}.`);
    }

    const [delivery] = await tx
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, payment.deliveryId))
      .for("update")
      .limit(1);
    if (!delivery) throw new Error("Payment references a delivery that no longer exists.");

    const [webhookEvent] = await tx
      .insert(paymentWebhookEventsTable)
      .values({
        provider: "stripe",
        providerEventId: event.id,
        eventType: event.type,
        paymentIntentId: details.paymentIntentId,
        paymentId: payment.id,
        deliveryId: delivery.id,
        metadata: details.metadata,
      })
      .onConflictDoNothing()
      .returning();
    if (!webhookEvent) return { disposition: "duplicate" };

    const paymentMetadata = {
      ...payment.metadata,
      lastProviderEventId: event.id,
      lastProviderEventType: event.type,
    };
    const paymentUpdate = async (status: "paid" | "failed" | "refunded") => {
      await tx
        .update(paymentsTable)
        .set({ status, metadata: paymentMetadata })
        .where(eq(paymentsTable.id, payment.id));
    };
    const audit = async (action: string, metadata: Record<string, unknown> = {}) => {
      await tx.insert(adminAuditLogsTable).values({
        action,
        entityType: "payment",
        entityId: payment.id,
        metadata: { provider: "stripe", providerEventId: event.id, ...metadata },
      });
    };

    if (details.action === "succeeded") {
      if (delivery.deliveryStatus !== "payment_pending") {
        await audit("payment.webhook_ignored", { reason: "delivery_not_payment_pending", eventType: event.type });
        return { disposition: "ignored", action: details.action };
      }
      await paymentUpdate("paid");
      const dispatchLeadTimeMs = 30 * 60 * 1000;
      const dispatchDue = !delivery.scheduledPickupStartAt ||
        delivery.scheduledPickupStartAt.getTime() <= Date.now() + dispatchLeadTimeMs;
      const nextStatus = dispatchDue ? "searching_driver" : "paid";
      await tx
        .update(deliveriesTable)
        .set({
          paymentStatus: "paid",
          deliveryStatus: nextStatus,
          ...(dispatchDue ? {
            dispatchStartedAt: new Date(),
            offerExpiresAt: new Date(Date.now() + 2 * 60_000),
          } : {}),
        })
        .where(eq(deliveriesTable.id, delivery.id));
      await tx.insert(deliveryStatusHistoryTable).values([
        {
          deliveryId: delivery.id,
          fromStatus: "payment_pending",
          toStatus: "paid",
          reason: "Stripe payment verified.",
          metadata: { provider: "stripe", providerEventId: event.id },
        },
        ...(dispatchDue ? [{
          deliveryId: delivery.id,
          fromStatus: "paid" as const,
          toStatus: "searching_driver" as const,
          reason: "Payment verified; dispatch matching started.",
          metadata: { provider: "stripe", providerEventId: event.id },
        }] : []),
      ]);
      await audit("payment.succeeded", { deliveryId: delivery.id });
      deliveryEvent = await recordDeliveryEvent(tx, {
        type: "delivery.updated",
        deliveryId: delivery.id,
        customerId: delivery.customerId,
        driverId: delivery.driverId,
         payload: { status: nextStatus, paymentStatus: "paid" },
      });
      return { disposition: "processed", action: details.action };
    }

    if (details.action === "failed") {
      if (delivery.deliveryStatus !== "payment_pending") {
        await audit("payment.webhook_ignored", { reason: "delivery_not_payment_pending", eventType: event.type });
        return { disposition: "ignored", action: details.action };
      }
      if (details.metadata.terminal !== true) {
        await audit("payment.attempt_failed", { deliveryId: delivery.id });
        return { disposition: "processed", action: details.action };
      }
      await paymentUpdate("failed");
      await tx
        .update(deliveriesTable)
        .set({ paymentStatus: "failed", deliveryStatus: "failed" })
        .where(eq(deliveriesTable.id, delivery.id));
      await createDispatchAlertsForDelivery(tx, delivery, "delivery_failed");
      await tx.insert(deliveryStatusHistoryTable).values({
        deliveryId: delivery.id,
        fromStatus: "payment_pending",
        toStatus: "failed",
        reason: "Stripe reported that payment failed.",
        metadata: { provider: "stripe", providerEventId: event.id },
      });
      await audit("payment.failed", { deliveryId: delivery.id });
      deliveryEvent = await recordDeliveryEvent(tx, {
        type: "delivery.updated",
        deliveryId: delivery.id,
        customerId: delivery.customerId,
        driverId: delivery.driverId,
        payload: { status: "failed", paymentStatus: "failed" },
      });
      return { disposition: "processed", action: details.action };
    }

    if (details.action === "partial_refund") {
      await audit("payment.refund_partial", { deliveryId: delivery.id, ...details.metadata });
      return { disposition: "processed", action: details.action };
    }
    await paymentUpdate("refunded");
    await tx
      .update(refundOperationsTable)
      .set({ status: "confirmed", providerError: null })
      .where(eq(refundOperationsTable.paymentId, payment.id));
    const dispatchNotStarted = ["payment_pending", "paid", "searching_driver", "failed", "refunded"].includes(delivery.deliveryStatus);
    await tx
      .update(deliveriesTable)
      .set({ paymentStatus: "refunded", ...(dispatchNotStarted ? { deliveryStatus: "refunded" } : {}) })
      .where(eq(deliveriesTable.id, delivery.id));
    if (dispatchNotStarted && delivery.deliveryStatus !== "refunded") {
      await tx.insert(deliveryStatusHistoryTable).values({
        deliveryId: delivery.id,
        fromStatus: delivery.deliveryStatus,
        toStatus: "refunded",
        reason: "Stripe refund verified; dispatch is blocked.",
        metadata: { provider: "stripe", providerEventId: event.id },
      });
    }
    await audit(dispatchNotStarted ? "payment.refunded" : "payment.refunded_after_dispatch", { deliveryId: delivery.id });
    deliveryEvent = await recordDeliveryEvent(tx, {
      type: "delivery.updated",
      deliveryId: delivery.id,
      customerId: delivery.customerId,
      driverId: delivery.driverId,
      payload: { status: dispatchNotStarted ? "refunded" : delivery.deliveryStatus, paymentStatus: "refunded" },
    });
    return { disposition: "processed", action: details.action };
  });
  const eventToPublish = deliveryEvent as DeliveryEvent | null;
  if (eventToPublish) {
    const [matchingDelivery] = await db
      .select({ publicDeliveryId: deliveriesTable.publicDeliveryId, customerId: deliveriesTable.customerId })
      .from(paymentsTable)
      .innerJoin(deliveriesTable, eq(deliveriesTable.id, paymentsTable.deliveryId))
      .where(and(eq(paymentsTable.provider, "stripe"), eq(paymentsTable.providerPaymentId, details.paymentIntentId)))
      .limit(1);
    if (matchingDelivery) {
      publishDeliveryEvent({ ...eventToPublish, deliveryId: matchingDelivery.publicDeliveryId });
    }
  }

  if (result.disposition === "duplicate") {
    await auditDuplicate(details.paymentIntentId, event.id);
    logger.info({ providerEventId: event.id, paymentIntentId: details.paymentIntentId }, "Ignored duplicate Stripe webhook");
  }
  return result;
}