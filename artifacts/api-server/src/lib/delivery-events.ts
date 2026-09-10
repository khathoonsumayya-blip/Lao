import { EventEmitter } from "node:events";
import { and, asc, eq, gt, or } from "drizzle-orm";
import {
  db,
  deliveryCoordinationEventsTable,
  deliveriesTable,
  driversTable,
  notificationAttemptsTable,
} from "@workspace/db";

export type DeliveryEvent = {
  type: "delivery.updated" | "driver.location_updated" | "driver.availability_updated";
  cursor: number;
  deliveryId: string;
  customerId: string;
  driverId: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type DeliveryEventInput = Omit<DeliveryEvent, "cursor" | "createdAt"> & {
  payload?: Record<string, unknown>;
};

const events = new EventEmitter();
events.setMaxListeners(250);
let adminCursor = 0;

/** Coarse invalidation signal for staff workspaces. Payload deliberately has no entity data. */
export type AdminUpdateEvent = { type: "admin.updated"; cursor: number; createdAt: string };

type EventWriter = Pick<typeof db, "insert" | "select">;

export async function recordDeliveryEvent(
  tx: EventWriter,
  event: DeliveryEventInput,
): Promise<DeliveryEvent> {
  const [created] = await tx
    .insert(deliveryCoordinationEventsTable)
    .values({
      deliveryId: event.deliveryId,
      customerId: event.customerId,
      driverId: event.driverId,
      type: event.type,
      payload: event.payload ?? {},
    })
    .returning();
  if (!created) throw new Error("Delivery event could not be recorded.");
  const [driver] = event.driverId
    ? await tx
      .select({ profileId: driversTable.profileId })
      .from(driversTable)
      .where(eq(driversTable.id, event.driverId))
      .limit(1)
    : [];
  const recipients = [...new Set([event.customerId, driver?.profileId].filter((id): id is string => Boolean(id)))];
  if (recipients.length) {
    await tx.insert(notificationAttemptsTable).values(recipients.map((profileId) => ({
      coordinationEventCursor: created.cursor,
      deliveryId: event.deliveryId,
      profileId,
      channel: "in_app",
      status: "pending",
    })));
  }

  return {
    type: created.type as DeliveryEvent["type"],
    cursor: created.cursor,
    deliveryId: created.deliveryId,
    customerId: created.customerId,
    driverId: created.driverId,
    createdAt: created.createdAt.toISOString(),
    payload: created.payload as Record<string, unknown>,
  };
}

export function publishDeliveryEvent(event: DeliveryEvent): void {
  events.emit("delivery", event);
}

export function subscribeToDeliveryEvents(listener: (event: DeliveryEvent) => void): () => void {
  events.on("delivery", listener);
  return () => events.off("delivery", listener);
}

export function publishAdminUpdate(): void {
  adminCursor += 1;
  events.emit("admin", { type: "admin.updated", cursor: adminCursor, createdAt: new Date().toISOString() } satisfies AdminUpdateEvent);
}

export function subscribeToAdminUpdates(listener: (event: AdminUpdateEvent) => void): () => void {
  events.on("admin", listener);
  return () => events.off("admin", listener);
}

export async function listDeliveryEventsAfter(input: {
  cursor: number;
  customerId: string;
  driverId: string | null;
  isStaff: boolean;
  limit?: number;
}): Promise<DeliveryEvent[]> {
  const visibility = input.isStaff
    ? gt(deliveryCoordinationEventsTable.cursor, input.cursor)
    : input.driverId
      ? and(
          gt(deliveryCoordinationEventsTable.cursor, input.cursor),
          or(
            eq(deliveryCoordinationEventsTable.customerId, input.customerId),
            eq(deliveryCoordinationEventsTable.driverId, input.driverId),
          ),
        )
      : and(
          gt(deliveryCoordinationEventsTable.cursor, input.cursor),
          eq(deliveryCoordinationEventsTable.customerId, input.customerId),
        );
  const records = await db
    .select({
      cursor: deliveryCoordinationEventsTable.cursor,
      type: deliveryCoordinationEventsTable.type,
      customerId: deliveryCoordinationEventsTable.customerId,
      driverId: deliveryCoordinationEventsTable.driverId,
      createdAt: deliveryCoordinationEventsTable.createdAt,
      payload: deliveryCoordinationEventsTable.payload,
      deliveryStatus: deliveriesTable.deliveryStatus,
      publicDeliveryId: deliveriesTable.publicDeliveryId,
    })
    .from(deliveryCoordinationEventsTable)
    .innerJoin(deliveriesTable, eq(deliveriesTable.id, deliveryCoordinationEventsTable.deliveryId))
    .where(visibility)
    .orderBy(asc(deliveryCoordinationEventsTable.cursor))
    .limit(input.limit ?? 200);
  const terminalStatuses = new Set(["delivered", "cancelled", "failed", "refunded"]);
  return records.filter((record) => !(record.type === "driver.location_updated" && terminalStatuses.has(record.deliveryStatus))).map((record) => ({
    type: record.type as DeliveryEvent["type"],
    cursor: record.cursor,
    deliveryId: record.publicDeliveryId,
    customerId: record.customerId,
    driverId: record.driverId,
    createdAt: record.createdAt.toISOString(),
      payload: record.payload as Record<string, unknown>,
  }));
}