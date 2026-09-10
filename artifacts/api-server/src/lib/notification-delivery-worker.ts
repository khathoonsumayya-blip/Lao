import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  db,
  notificationAttemptsTable,
  notificationsTable,
} from "@workspace/db";
import { logger } from "./logger";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const CLAIM_LEASE_MS = 60_000;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

type ClaimedNotificationAttempt = {
  id: string;
  coordinationEventCursor: number;
  deliveryId: string;
  publicDeliveryId: string;
  profileId: string;
  channel: string;
  attempts: string;
  eventType: string;
  payload: Record<string, unknown>;
  claimToken: string;
};

export type DeliveryUpdateNotification = {
  attemptId: string;
  idempotencyKey: string;
  coordinationEventCursor: number;
  deliveryId: string;
  publicDeliveryId: string;
  profileId: string;
  type: string;
  status: string | null;
  payload: Record<string, unknown>;
};

export type NotificationTransport = {
  /**
   * External providers should use notification.idempotencyKey when their API
   * supports idempotency. This protects delivery if a provider accepts a send
   * but the process fails before it can record the completed attempt.
   */
  deliver(notification: DeliveryUpdateNotification): Promise<void>;
};

export type NotificationWorkerResult = {
  claimed: number;
  delivered: number;
  retried: number;
};

function clampBatchSize(size: number | undefined): number {
  return Math.max(1, Math.min(Math.floor(size ?? DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE));
}

function retryDelayMs(attempts: string): number {
  const attempt = Number.parseInt(attempts, 10);
  const normalizedAttempt = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1;
  return Math.min(
    INITIAL_RETRY_DELAY_MS * 2 ** Math.min(normalizedAttempt - 1, 8),
    MAX_RETRY_DELAY_MS,
  );
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000);
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function toDeliveryUpdateNotification(attempt: ClaimedNotificationAttempt): DeliveryUpdateNotification {
  const status = typeof attempt.payload.status === "string" ? attempt.payload.status : null;
  return {
    attemptId: attempt.id,
    idempotencyKey: attempt.id,
    coordinationEventCursor: attempt.coordinationEventCursor,
    deliveryId: attempt.deliveryId,
    publicDeliveryId: attempt.publicDeliveryId,
    profileId: attempt.profileId,
    type: attempt.eventType,
    status,
    payload: attempt.payload,
  };
}

async function claimNotificationAttempts(
  batchSize: number,
  leaseDurationMs: number,
  channel?: string,
): Promise<ClaimedNotificationAttempt[]> {
  const claimToken = randomUUID();
  const channelFilter = channel === undefined
    ? sql`true`
    : sql`channel = ${channel}`;
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT id
      FROM notification_attempts
      WHERE (
        (status = 'pending' AND next_attempt_at <= now())
        OR (status = 'processing' AND lease_expires_at <= now())
      )
      AND ${channelFilter}
      ORDER BY next_attempt_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    ),
    claimed AS (
      UPDATE notification_attempts AS attempts
      SET
        status = 'processing',
        attempts = (attempts.attempts::integer + 1)::text,
        claim_token = ${claimToken},
        lease_expires_at = now() + (${leaseDurationMs} * interval '1 millisecond'),
        updated_at = now()
      FROM candidates
      WHERE attempts.id = candidates.id
      RETURNING
        attempts.id,
        attempts.coordination_event_cursor,
        attempts.delivery_id,
        attempts.profile_id,
        attempts.channel,
        attempts.attempts,
        attempts.claim_token
    )
    SELECT
      claimed.id,
      claimed.coordination_event_cursor AS "coordinationEventCursor",
      claimed.delivery_id AS "deliveryId",
      deliveries.public_delivery_id AS "publicDeliveryId",
      claimed.profile_id AS "profileId",
      claimed.channel,
      claimed.attempts,
      events.type AS "eventType",
      events.payload,
      claimed.claim_token AS "claimToken"
    FROM claimed
    INNER JOIN delivery_coordination_events AS events
      ON events.cursor = claimed.coordination_event_cursor
    INNER JOIN deliveries
      ON deliveries.id = claimed.delivery_id
  `);

  return result.rows as ClaimedNotificationAttempt[];
}

async function scheduleRetry(attempt: ClaimedNotificationAttempt, error: unknown): Promise<boolean> {
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempt.attempts));
  const result = await db
    .update(notificationAttemptsTable)
    .set({
      status: "pending",
      lastError: errorMessage(error),
      nextAttemptAt,
      claimToken: null,
      leaseExpiresAt: null,
    })
    .where(and(
      eq(notificationAttemptsTable.id, attempt.id),
      eq(notificationAttemptsTable.status, "processing"),
      eq(notificationAttemptsTable.claimToken, attempt.claimToken),
    ))
    .returning({ id: notificationAttemptsTable.id });
  return result.length === 1;
}

async function deliverInApp(attempt: ClaimedNotificationAttempt): Promise<boolean> {
  const notification = toDeliveryUpdateNotification(attempt);
  const status = notification.status ? statusLabel(notification.status) : "updated";
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: notificationAttemptsTable.id,
        leaseExpiresAt: notificationAttemptsTable.leaseExpiresAt,
      })
      .from(notificationAttemptsTable)
      .where(and(
        eq(notificationAttemptsTable.id, attempt.id),
        eq(notificationAttemptsTable.status, "processing"),
        eq(notificationAttemptsTable.claimToken, attempt.claimToken),
      ))
      .for("update")
      .limit(1);

    if (!current || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) {
      return false;
    }

    await tx.insert(notificationsTable).values({
      profileId: notification.profileId,
      deliveryId: notification.deliveryId,
      type: "delivery_updated",
      title: "Delivery update",
      body: `Delivery ${notification.publicDeliveryId} is now ${status}.`,
    });
    const [delivered] = await tx
      .update(notificationAttemptsTable)
      .set({
        status: "delivered",
        lastError: null,
        claimToken: null,
        leaseExpiresAt: null,
      })
      .where(and(
        eq(notificationAttemptsTable.id, attempt.id),
        eq(notificationAttemptsTable.status, "processing"),
        eq(notificationAttemptsTable.claimToken, attempt.claimToken),
      ))
      .returning({ id: notificationAttemptsTable.id });
    return Boolean(delivered);
  });
}

async function claimIsStillActive(attempt: ClaimedNotificationAttempt): Promise<boolean> {
  const [current] = await db
    .select({ id: notificationAttemptsTable.id })
    .from(notificationAttemptsTable)
    .where(and(
      eq(notificationAttemptsTable.id, attempt.id),
      eq(notificationAttemptsTable.status, "processing"),
      eq(notificationAttemptsTable.claimToken, attempt.claimToken),
      gt(notificationAttemptsTable.leaseExpiresAt, new Date()),
    ))
    .limit(1);
  return Boolean(current);
}

async function extendLease(attempt: ClaimedNotificationAttempt, leaseDurationMs: number): Promise<boolean> {
  const [extended] = await db
    .update(notificationAttemptsTable)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseDurationMs) })
    .where(and(
      eq(notificationAttemptsTable.id, attempt.id),
      eq(notificationAttemptsTable.status, "processing"),
      eq(notificationAttemptsTable.claimToken, attempt.claimToken),
    ))
    .returning({ id: notificationAttemptsTable.id });
  return Boolean(extended);
}

async function markDelivered(attempt: ClaimedNotificationAttempt): Promise<boolean> {
  const [delivered] = await db
    .update(notificationAttemptsTable)
    .set({
      status: "delivered",
      lastError: null,
      claimToken: null,
      leaseExpiresAt: null,
    })
    .where(and(
      eq(notificationAttemptsTable.id, attempt.id),
      eq(notificationAttemptsTable.status, "processing"),
      eq(notificationAttemptsTable.claimToken, attempt.claimToken),
    ))
    .returning({ id: notificationAttemptsTable.id });
  return Boolean(delivered);
}

export async function runNotificationDeliveryWorker(input: {
  batchSize?: number;
  channel?: string;
  leaseDurationMs?: number;
  transports?: Record<string, NotificationTransport>;
} = {}): Promise<NotificationWorkerResult> {
  const leaseDurationMs = Math.max(100, input.leaseDurationMs ?? CLAIM_LEASE_MS);
  const claimed = await claimNotificationAttempts(
    clampBatchSize(input.batchSize),
    leaseDurationMs,
    input.channel,
  );
  const results = await Promise.all(claimed.map(async (attempt) => {
    try {
      if (attempt.channel === "in_app") {
        return { delivered: await deliverInApp(attempt), retried: false };
      }

      const transport = input.transports?.[attempt.channel];
      if (!transport) {
        return {
          delivered: false,
          retried: await scheduleRetry(attempt, new Error(`No transport is configured for "${attempt.channel}".`)),
        };
      }
      if (!await claimIsStillActive(attempt)) return { delivered: false, retried: false };
      const heartbeat = setInterval(() => {
        void extendLease(attempt, leaseDurationMs).catch((error) => {
          logger.warn({ err: error, notificationAttemptId: attempt.id }, "Unable to extend notification delivery lease");
        });
      }, Math.max(25, Math.floor(leaseDurationMs / 3)));
      heartbeat.unref();
      try {
        await transport.deliver(toDeliveryUpdateNotification(attempt));
      } finally {
        clearInterval(heartbeat);
      }
      return { delivered: await markDelivered(attempt), retried: false };
    } catch (error) {
      const retried = await scheduleRetry(attempt, error);
      logger.warn({ err: error, notificationAttemptId: attempt.id }, "Notification delivery will be retried");
      return { delivered: false, retried };
    }
  }));

  return {
    claimed: claimed.length,
    delivered: results.filter((result) => result.delivered).length,
    retried: results.filter((result) => result.retried).length,
  };
}

export function startNotificationDeliveryWorker(pollIntervalMs = 2_000): () => void {
  const run = () => {
    void runNotificationDeliveryWorker().catch((error) => {
      logger.error({ err: error }, "Notification delivery worker failed");
    });
  };
  run();
  const interval = setInterval(run, pollIntervalMs);
  interval.unref();
  return () => clearInterval(interval);
}