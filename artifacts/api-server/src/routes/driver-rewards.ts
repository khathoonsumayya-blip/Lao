import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAdminDriverBonusBody,
  CreateAdminDriverBonusHeader,
  CreateAdminDriverBonusResponse,
  GetAdminDriverBonusParams,
  GetAdminDriverBonusResponse,
  GetAdminDriverBonusSummaryResponse,
  GetAdminDriverPerformanceQueryParams,
  GetAdminDriverPerformanceResponse,
  GetDriverBonusWalletResponse,
  ListAdminDriverBonusesQueryParams,
  ListAdminDriverBonusesResponse,
  ListAdminDriverPerformanceQueryParams,
  ListAdminDriverPerformanceResponse,
  UpdateAdminDriverBonusStatusBody,
  UpdateAdminDriverBonusStatusHeader,
  UpdateAdminDriverBonusStatusParams,
  UpdateAdminDriverBonusStatusResponse,
} from "@workspace/api-zod";
import {
  adminAuditLogsTable, db, deliveriesTable, driverBonusEventsTable, driverBonusesTable, driverDeliveryOfferAttemptsTable, driversTable, profilesTable, ratingsTable,
} from "@workspace/db";
import { currentAuth, requireAdminRoles, requireRoles } from "../lib/auth";

const router: IRouter = Router();
const allowedTransitions: Record<string, string[]> = {
  pending: ["approved", "reversed"], approved: ["paid", "reversed"], paid: ["reversed"], reversed: [],
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return uuidPattern.test(value);
}

function mapBonus(row: typeof driverBonusesTable.$inferSelect) {
  return {
    id: row.id, driverId: row.driverId, amountCents: row.amountCents, currency: row.currency,
    type: row.type, reason: row.reason, note: row.note,
    performancePeriodStart: row.performancePeriodStart?.toISOString() ?? null,
    performancePeriodEnd: row.performancePeriodEnd?.toISOString() ?? null, status: row.status,
    issuedByProfileId: row.issuedByProfileId, approvedAt: row.approvedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null, reversedAt: row.reversedAt?.toISOString() ?? null,
    reversalReason: row.reversalReason, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}
function idempotencyHeader(req: { headers: Record<string, string | string[] | undefined> }) {
  const value = req.headers["idempotency-key"];
  return Array.isArray(value) ? value[0] : value;
}
function fingerprint(value: Record<string, unknown>) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

const acceptanceDefinition = "Acceptance is persisted accepted offer responses divided by persisted accepted plus declined offer responses. Expired or unresponded offers are excluded.";
const onTimeDefinition = "On time means deliveredAt is no later than assignedAt plus the persisted estimatedDurationMinutes. Rows without both timestamps and a positive estimate are excluded.";
function bonusTotals(bonuses: Array<typeof driverBonusesTable.$inferSelect>) {
  const totals = { pendingCents: 0, approvedCents: 0, paidCents: 0, reversedCents: 0, totalCents: 0 };
  for (const bonus of bonuses) { totals[`${bonus.status}Cents` as keyof typeof totals] += bonus.amountCents; totals.totalCents += bonus.amountCents; }
  return totals;
}
function performanceRow(
  driver: { id: string; firstName: string; lastName: string },
  deliveries: Array<typeof deliveriesTable.$inferSelect>,
  ratings: Array<typeof ratingsTable.$inferSelect>,
  bonuses: Array<typeof driverBonusesTable.$inferSelect>,
  attempts: Array<typeof driverDeliveryOfferAttemptsTable.$inferSelect> = [],
) {
  const completed = deliveries.filter((delivery) => delivery.deliveryStatus === "delivered");
  const cancelled = deliveries.filter((delivery) => delivery.deliveryStatus === "cancelled");
  const measurable = completed.filter((delivery) => delivery.assignedAt && delivery.deliveredAt && Number(delivery.estimatedDurationMinutes) > 0);
  const onTime = measurable.filter((delivery) => delivery.deliveredAt!.getTime() <= delivery.assignedAt!.getTime() + Number(delivery.estimatedDurationMinutes) * 60_000);
  const scores = ratings.map((rating) => Number(rating.score)).filter(Number.isFinite);
  const accepted = attempts.filter((attempt) => attempt.response === "accepted").length;
  const declined = attempts.filter((attempt) => attempt.response === "declined").length;
  return {
    driverId: driver.id, name: `${driver.firstName} ${driver.lastName}`.trim(), completedDeliveries: completed.length,
    acceptanceRate: accepted + declined ? accepted / (accepted + declined) : null, acceptanceAccepted: accepted, acceptanceDeclined: declined,
    onTimeRate: measurable.length ? onTime.length / measurable.length : null,
    rating: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    cancellations: cancelled.length, bonusTotals: bonusTotals(bonuses), acceptanceDefinition, onTimeDefinition,
  };
}
function dates(raw: Record<string, unknown>) {
  const from = typeof raw.from === "string" ? new Date(`${raw.from}T00:00:00.000Z`) : undefined;
  const to = typeof raw.to === "string" ? new Date(`${raw.to}T00:00:00.000Z`) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) return null;
  return { from, to: to ? new Date(to.getTime() + 86_400_000) : undefined };
}

router.get("/admin/driver-performance", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const range = dates(req.query as Record<string, unknown>);
  const parsed = ListAdminDriverPerformanceQueryParams.safeParse({
    ...req.query, from: range?.from, to: range?.to ? new Date(range.to.getTime() - 86_400_000) : undefined,
  });
  if (!range || !parsed.success) { res.status(400).json({ error: "Use valid YYYY-MM-DD from/to dates, with from on or before to." }); return; }
  const search = parsed.data.search?.trim();
  const { page, pageSize } = parsed.data;
  const conditions = search ? [or(ilike(profilesTable.firstName, `%${search}%`), ilike(profilesTable.lastName, `%${search}%`), ilike(profilesTable.email, `%${search}%`))] : [];
  const drivers = await db.select({ id: driversTable.id, firstName: profilesTable.firstName, lastName: profilesTable.lastName })
    .from(driversTable)
    .innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(profilesTable.firstName), asc(profilesTable.lastName), asc(driversTable.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  if (!drivers.length) { res.json(ListAdminDriverPerformanceResponse.parse([])); return; }

  const driverIds = drivers.map((driver) => driver.id);
  const deliveryConditions = [inArray(deliveriesTable.driverId, driverIds)];
  const ratingConditions = [inArray(ratingsTable.driverId, driverIds)];
  const bonusConditions = [inArray(driverBonusesTable.driverId, driverIds)];
  const attemptConditions = [inArray(driverDeliveryOfferAttemptsTable.driverId, driverIds)];
  if (range.from) deliveryConditions.push(gte(deliveriesTable.assignedAt, range.from));
  if (range.to) deliveryConditions.push(lt(deliveriesTable.assignedAt, range.to));
  if (range.from) { ratingConditions.push(gte(ratingsTable.createdAt, range.from)); bonusConditions.push(gte(driverBonusesTable.createdAt, range.from)); attemptConditions.push(gte(driverDeliveryOfferAttemptsTable.offeredAt, range.from)); }
  if (range.to) { ratingConditions.push(lt(ratingsTable.createdAt, range.to)); bonusConditions.push(lt(driverBonusesTable.createdAt, range.to)); attemptConditions.push(lt(driverDeliveryOfferAttemptsTable.offeredAt, range.to)); }
  const [deliveries, ratings, bonuses, attempts] = await Promise.all([
    db.select().from(deliveriesTable).where(and(...deliveryConditions)),
    db.select().from(ratingsTable).where(and(...ratingConditions)),
    db.select().from(driverBonusesTable).where(and(...bonusConditions)),
    db.select().from(driverDeliveryOfferAttemptsTable).where(and(...attemptConditions)),
  ]);
  function groupedByDriver<T extends { driverId: string | null }>(rows: T[]) {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      if (!row.driverId) continue;
      const existing = grouped.get(row.driverId);
      if (existing) existing.push(row);
      else grouped.set(row.driverId, [row]);
    }
    return grouped;
  }
  const deliveriesByDriver = groupedByDriver(deliveries);
  const ratingsByDriver = groupedByDriver(ratings);
  const bonusesByDriver = groupedByDriver(bonuses);
  const attemptsByDriver = groupedByDriver(attempts);
  const result = drivers.map((driver) => performanceRow(
    driver,
    deliveriesByDriver.get(driver.id) ?? [],
    ratingsByDriver.get(driver.id) ?? [],
    bonusesByDriver.get(driver.id) ?? [],
    attemptsByDriver.get(driver.id) ?? [],
  ));
  res.json(ListAdminDriverPerformanceResponse.parse(result));
});

router.get("/admin/driver-performance/detail", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const range = dates(req.query as Record<string, unknown>);
  const query = GetAdminDriverPerformanceQueryParams.safeParse({ ...req.query, from: range?.from, to: range?.to ? new Date(range.to.getTime() - 86_400_000) : undefined });
  if (!range || !query.success) { res.status(400).json({ error: "Use a valid driver id and YYYY-MM-DD date range." }); return; }
  const [driver] = await db.select({ id: driversTable.id, firstName: profilesTable.firstName, lastName: profilesTable.lastName }).from(driversTable).innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id)).where(eq(driversTable.id, query.data.driverId)).limit(1);
  if (!driver) { res.status(404).json({ error: "Driver not found." }); return; }
  const deliveryConditions = [eq(deliveriesTable.driverId, driver.id)];
  const ratingConditions = [eq(ratingsTable.driverId, driver.id)];
  const bonusConditions = [eq(driverBonusesTable.driverId, driver.id)];
  const attemptConditions = [eq(driverDeliveryOfferAttemptsTable.driverId, driver.id)];
  if (range.from) deliveryConditions.push(gte(deliveriesTable.assignedAt, range.from));
  if (range.to) deliveryConditions.push(lt(deliveriesTable.assignedAt, range.to));
  if (range.from) { ratingConditions.push(gte(ratingsTable.createdAt, range.from)); bonusConditions.push(gte(driverBonusesTable.createdAt, range.from)); attemptConditions.push(gte(driverDeliveryOfferAttemptsTable.offeredAt, range.from)); }
  if (range.to) { ratingConditions.push(lt(ratingsTable.createdAt, range.to)); bonusConditions.push(lt(driverBonusesTable.createdAt, range.to)); attemptConditions.push(lt(driverDeliveryOfferAttemptsTable.offeredAt, range.to)); }
  const [deliveries, ratings, bonuses, attempts] = await Promise.all([
    db.select().from(deliveriesTable).where(and(...deliveryConditions)).orderBy(desc(deliveriesTable.assignedAt)).limit(200),
    db.select().from(ratingsTable).where(and(...ratingConditions)),
    db.select().from(driverBonusesTable).where(and(...bonusConditions)).orderBy(desc(driverBonusesTable.createdAt)).limit(200),
    db.select().from(driverDeliveryOfferAttemptsTable).where(and(...attemptConditions)),
  ]);
  res.json(GetAdminDriverPerformanceResponse.parse({
    performance: performanceRow(driver, deliveries, ratings, bonuses, attempts),
    deliveries: deliveries.map((d) => ({ id: d.publicDeliveryId, status: d.deliveryStatus, assignedAt: d.assignedAt?.toISOString() ?? null, deliveredAt: d.deliveredAt?.toISOString() ?? null, cancelledAt: d.cancelledAt?.toISOString() ?? null, estimatedDurationMinutes: d.estimatedDurationMinutes ? Number(d.estimatedDurationMinutes) : null })),
    bonuses: bonuses.map(mapBonus),
  }));
});

router.get("/driver/bonuses", requireRoles("driver"), async (_req, res): Promise<void> => {
  const profileId = currentAuth(res).profileId;
  const [driver] = await db.select({ id: driversTable.id }).from(driversTable).where(eq(driversTable.profileId, profileId)).limit(1);
  if (!driver) { res.status(403).json({ error: "Driver profile is not available." }); return; }
  const bonuses = await db.select().from(driverBonusesTable).where(eq(driverBonusesTable.driverId, driver.id)).orderBy(desc(driverBonusesTable.createdAt));
  const totals = { pendingCents: 0, approvedCents: 0, paidCents: 0, reversedCents: 0 };
  for (const bonus of bonuses) totals[`${bonus.status}Cents` as keyof typeof totals] += bonus.amountCents;
  res.json(GetDriverBonusWalletResponse.parse({ ...totals, transactions: bonuses.map((bonus) => ({ ...mapBonus(bonus), label: "Bonus" })) }));
});

router.get("/admin/driver-bonuses", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const rawQuery = req.query as Record<string, unknown>;
  const parsed = ListAdminDriverBonusesQueryParams.safeParse({
    ...rawQuery,
    startDate: typeof rawQuery.startDate === "string" ? new Date(`${rawQuery.startDate}T00:00:00.000Z`) : rawQuery.startDate,
    endDate: typeof rawQuery.endDate === "string" ? new Date(`${rawQuery.endDate}T00:00:00.000Z`) : rawQuery.endDate,
  });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const q = parsed.data;
  const conditions = [];
  if (q.status) conditions.push(eq(driverBonusesTable.status, q.status));
  if (q.startDate) conditions.push(gte(driverBonusesTable.createdAt, q.startDate));
  if (q.endDate) {
    const end = new Date(q.endDate);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(lte(driverBonusesTable.createdAt, end));
  }
  if (q.search) {
    const match = `%${q.search}%`;
    conditions.push(or(ilike(profilesTable.firstName, match), ilike(profilesTable.lastName, match), ilike(profilesTable.email, match)));
  }
  const rows = await db.select({ bonus: driverBonusesTable }).from(driverBonusesTable)
    .innerJoin(driversTable, eq(driverBonusesTable.driverId, driversTable.id))
    .innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
    .where(conditions.length ? and(...conditions) : undefined).orderBy(desc(driverBonusesTable.createdAt)).limit(200);
  res.json(ListAdminDriverBonusesResponse.parse(rows.map((row) => mapBonus(row.bonus))));
});

router.get("/admin/driver-bonuses/summary", requireAdminRoles("admin", "dispatcher"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(driverBonusesTable);
  const result = { pendingCents: 0, approvedCents: 0, paidCents: 0, reversedCents: 0, totalCents: 0 };
  for (const row of rows) { result[`${row.status}Cents` as keyof typeof result] += row.amountCents; result.totalCents += row.amountCents; }
  res.json(GetAdminDriverBonusSummaryResponse.parse(result));
});

router.get("/admin/driver-bonuses/:id", requireAdminRoles("admin", "dispatcher"), async (req, res): Promise<void> => {
  const parsed = GetAdminDriverBonusParams.safeParse(req.params);
  if (!parsed.success || !isUuid(parsed.data.id)) { res.status(400).json({ error: "Invalid driver bonus identifier." }); return; }
  const [bonus] = await db.select().from(driverBonusesTable).where(eq(driverBonusesTable.id, parsed.data.id)).limit(1);
  if (!bonus) { res.status(404).json({ error: "Driver bonus not found." }); return; }
  const events = await db.select().from(driverBonusEventsTable).where(eq(driverBonusEventsTable.bonusId, bonus.id)).orderBy(driverBonusEventsTable.createdAt);
  res.json(GetAdminDriverBonusResponse.parse({ bonus: mapBonus(bonus), events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })) }));
});

router.post("/admin/driver-bonuses", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const header = CreateAdminDriverBonusHeader.safeParse({ "Idempotency-Key": idempotencyHeader(req) });
  const body = CreateAdminDriverBonusBody.safeParse(req.body);
  if (!header.success || !body.success) { res.status(400).json({ error: header.error?.message ?? body.error?.message }); return; }
  const input = body.data; const actorProfileId = currentAuth(res).profileId;
  const requestFingerprint = fingerprint({
    driverId: input.driverId, amountCents: input.amountCents, type: input.type, reason: input.reason,
    note: input.note ?? null, performancePeriodStart: input.performancePeriodStart?.toISOString() ?? null,
    performancePeriodEnd: input.performancePeriodEnd?.toISOString() ?? null, currency: "USD",
  });
  if (input.performancePeriodStart && input.performancePeriodEnd && new Date(input.performancePeriodStart) > new Date(input.performancePeriodEnd)) {
    res.status(400).json({ error: "Performance period start must be on or before its end." }); return;
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${header.data["Idempotency-Key"]}))`);
    const [existing] = await tx.select().from(driverBonusesTable).where(eq(driverBonusesTable.idempotencyKey, header.data["Idempotency-Key"])).for("update").limit(1);
    if (existing) {
      const same = existing.requestFingerprint === requestFingerprint;
      return { existing, conflict: !same };
    }
    const [driver] = await tx.select({ id: driversTable.id }).from(driversTable).innerJoin(profilesTable, eq(driversTable.profileId, profilesTable.id))
      .where(and(eq(driversTable.id, input.driverId), eq(driversTable.approvalStatus, "approved"), eq(profilesTable.status, "active"))).for("update").limit(1);
    if (!driver) return { missing: true };
    const [bonus] = await tx.insert(driverBonusesTable).values({ driverId: input.driverId, amountCents: input.amountCents, currency: "USD", type: input.type, reason: input.reason, note: input.note ?? null, performancePeriodStart: input.performancePeriodStart ? new Date(input.performancePeriodStart) : null, performancePeriodEnd: input.performancePeriodEnd ? new Date(input.performancePeriodEnd) : null, status: "pending", issuedByProfileId: actorProfileId, idempotencyKey: header.data["Idempotency-Key"], requestFingerprint }).returning();
    await tx.insert(driverBonusEventsTable).values({ bonusId: bonus.id, type: "created", toStatus: "pending", actorProfileId, reason: bonus.reason, idempotencyKey: header.data["Idempotency-Key"] });
    await tx.insert(adminAuditLogsTable).values({ actorProfileId, action: "driver_bonus.created", entityType: "driver_bonus", entityId: bonus.id, metadata: { driverId: bonus.driverId, amountCents: bonus.amountCents, type: bonus.type } });
    return { bonus };
  });
  if ("missing" in result) { res.status(422).json({ error: "Driver is not an eligible active approved driver." }); return; }
  if (result.conflict) { res.status(409).json({ error: "Idempotency key was already used for a different award." }); return; }
  const bonus = result.existing ?? result.bonus!;
  res.status(result.existing ? 200 : 201).json(CreateAdminDriverBonusResponse.parse(mapBonus(bonus)));
});

router.post("/admin/driver-bonuses/:id/status", requireAdminRoles("admin"), async (req, res): Promise<void> => {
  const params = UpdateAdminDriverBonusStatusParams.safeParse(req.params);
  const header = UpdateAdminDriverBonusStatusHeader.safeParse({ "Idempotency-Key": idempotencyHeader(req) });
  const body = UpdateAdminDriverBonusStatusBody.safeParse(req.body);
  if (!params.success || !isUuid(params.data.id)) { res.status(400).json({ error: "Invalid driver bonus identifier." }); return; }
  if (!header.success || !body.success) { res.status(400).json({ error: header.error?.message ?? body.error?.message }); return; }
  const input = body.data; const actorProfileId = currentAuth(res).profileId;
  if (input.status === "reversed" && (!input.reason || input.reason.trim().length < 3)) { res.status(400).json({ error: "A reversal reason is required." }); return; }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${header.data["Idempotency-Key"]}))`);
    const [event] = await tx.select().from(driverBonusEventsTable).where(eq(driverBonusEventsTable.idempotencyKey, header.data["Idempotency-Key"])).for("update").limit(1);
    if (event) {
      if (event.bonusId !== params.data.id || event.toStatus !== input.status || (event.reason ?? null) !== (input.reason?.trim() ?? null)) {
        return { conflict: true };
      }
      return { replay: event.bonusId };
    }
    const [bonus] = await tx.select().from(driverBonusesTable).where(eq(driverBonusesTable.id, params.data.id)).for("update").limit(1);
    if (!bonus) return { missing: true };
    if (!allowedTransitions[bonus.status]?.includes(input.status)) return { invalid: true };
    const now = new Date();
    const patch = input.status === "approved" ? { status: input.status, approvedAt: now, approvedByProfileId: actorProfileId }
      : input.status === "paid" ? { status: input.status, paidAt: now, paidByProfileId: actorProfileId }
        : { status: input.status, reversedAt: now, reversedByProfileId: actorProfileId, reversalReason: input.reason!.trim() };
    const [updated] = await tx.update(driverBonusesTable).set(patch).where(eq(driverBonusesTable.id, bonus.id)).returning();
    await tx.insert(driverBonusEventsTable).values({ bonusId: bonus.id, type: input.status, fromStatus: bonus.status, toStatus: input.status, actorProfileId, reason: input.reason?.trim() ?? null, idempotencyKey: header.data["Idempotency-Key"] });
    await tx.insert(adminAuditLogsTable).values({ actorProfileId, action: `driver_bonus.${input.status}`, entityType: "driver_bonus", entityId: bonus.id, metadata: { fromStatus: bonus.status, toStatus: input.status, reason: input.reason?.trim() ?? null } });
    return { updated };
  });
  if ("missing" in result) { res.status(404).json({ error: "Driver bonus not found." }); return; }
  if ("conflict" in result) { res.status(409).json({ error: "Idempotency key was already used for a different transition." }); return; }
  if ("invalid" in result) { res.status(409).json({ error: "Bonus status transition is not permitted." }); return; }
  const bonus = result.updated ?? (await db.select().from(driverBonusesTable).where(eq(driverBonusesTable.id, result.replay!)).limit(1))[0]!;
  res.json(UpdateAdminDriverBonusStatusResponse.parse(mapBonus(bonus)));
});

export default router;