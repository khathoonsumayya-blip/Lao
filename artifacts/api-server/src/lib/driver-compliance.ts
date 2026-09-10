import { desc, eq } from "drizzle-orm";
import { db, driverDocumentsTable } from "@workspace/db";

const requiredDocumentTypes = ["license", "insurance", "vehicle_registration"] as const;

/** Current eligibility only controls future work; it never changes assignments. */
export async function hasCurrentDriverCompliance(driverId: string): Promise<boolean> {
  const documents = await db.select().from(driverDocumentsTable)
    .where(eq(driverDocumentsTable.driverId, driverId))
    .orderBy(desc(driverDocumentsTable.createdAt));
  const latest = new Map<string, typeof documents[number]>();
  for (const document of documents) if (!latest.has(document.documentType)) latest.set(document.documentType, document);
  const today = new Date().toISOString().slice(0, 10);
  return requiredDocumentTypes.every((type) => {
    const document = latest.get(type);
    return document?.verificationStatus === "approved" && !!document.expiryDate && document.expiryDate > today;
  });
}