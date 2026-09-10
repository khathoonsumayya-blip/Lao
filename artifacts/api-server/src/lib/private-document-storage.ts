import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const sidecarEndpoint = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${sidecarEndpoint}/token`,
    type: "external_account",
    credential_source: {
      url: `${sidecarEndpoint}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateDirectory(): string {
  const path = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "");
  if (!path) throw new Error("Private document storage is not configured.");
  return path;
}

function storagePathParts(path: string): { bucket: string; object: string } {
  const parts = path.replace(/^\//, "").split("/");
  if (parts.length < 2) throw new Error("Invalid private storage path.");
  return { bucket: parts[0], object: parts.slice(1).join("/") };
}

export async function createDriverDocumentUpload(driverId: string): Promise<{ uploadURL: string; objectPath: string }> {
  const { bucket, object } = storagePathParts(`${privateDirectory()}/driver-documents/${driverId}/${randomUUID()}`);
  const response = await fetch(`${sidecarEndpoint}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucket,
      object_name: object,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Unable to prepare a secure document upload.");
  const { signed_url: uploadURL } = await response.json() as { signed_url: string };
  return { uploadURL, objectPath: `/objects/${object}` };
}

export async function documentObjectExists(driverId: string, objectPath: string): Promise<boolean> {
  if (!objectPath.startsWith("/objects/")) return false;
  const { bucket, object: privatePrefix } = storagePathParts(privateDirectory());
  const object = objectPath.slice("/objects/".length);
  if (!object.startsWith(`${privatePrefix}/driver-documents/${driverId}/`)) return false;
  const [exists] = await storage.bucket(bucket).file(object).exists();
  return exists;
}

function privateObjectForDriver(driverId: string, objectPath: string) {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid private storage path.");
  const { bucket, object: privatePrefix } = storagePathParts(privateDirectory());
  const object = objectPath.slice("/objects/".length);
  if (!object.startsWith(`${privatePrefix}/driver-documents/${driverId}/`)) {
    throw new Error("That document does not belong to this driver.");
  }
  return { bucket, object };
}

export async function createDriverDocumentDownloadUrl(driverId: string, objectPath: string): Promise<string> {
  const { bucket, object } = privateObjectForDriver(driverId, objectPath);
  const file = storage.bucket(bucket).file(object);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Private document is unavailable.");
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 5 * 60_000,
  });
  return url;
}

export function createDeliveryPhotoObjectPath(deliveryId: string): string {
  const { object } = storagePathParts(`${privateDirectory()}/delivery-photos/${deliveryId}/${randomUUID()}`);
  return `/objects/${object}`;
}

export async function createDeliveryPhotoUpload(deliveryId: string, objectPath: string, expiresAt: string): Promise<{
  uploadURL: string;
  objectPath: string;
  expiresAt: string;
}> {
  const { bucket, object } = privateObjectForDelivery(deliveryId, objectPath);
  const response = await fetch(`${sidecarEndpoint}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucket,
      object_name: object,
      method: "PUT",
      expires_at: expiresAt,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Unable to prepare a secure package-photo upload.");
  const { signed_url: uploadURL } = await response.json() as { signed_url: string };
  return { uploadURL, objectPath, expiresAt };
}

function privateObjectForDelivery(deliveryId: string, objectPath: string) {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid private storage path.");
  const { bucket, object: privatePrefix } = storagePathParts(privateDirectory());
  const object = objectPath.slice("/objects/".length);
  if (!object.startsWith(`${privatePrefix}/delivery-photos/${deliveryId}/`)) {
    throw new Error("That upload does not belong to this delivery.");
  }
  return { bucket, object };
}

export async function deliveryPhotoObjectExists(deliveryId: string, objectPath: string): Promise<boolean> {
  const { bucket, object } = privateObjectForDelivery(deliveryId, objectPath);
  const [exists] = await storage.bucket(bucket).file(object).exists();
  return exists;
}

function hasExpectedImageSignature(contentType: string, bytes: Buffer): boolean {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.length >= 12
    && bytes.subarray(0, 4).equals(Buffer.from("RIFF"))
    && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
}

export async function verifyDeliveryPhotoObject(
  deliveryId: string,
  objectPath: string,
  expected: { contentType: string; size: number },
): Promise<boolean> {
  const { bucket, object } = privateObjectForDelivery(deliveryId, objectPath);
  const file = storage.bucket(bucket).file(object);
  try {
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (metadata.contentType !== expected.contentType || size !== expected.size) {
      await file.delete({ ignoreNotFound: true });
      return false;
    }
    const [signature] = await file.download({ start: 0, end: 11 });
    if (!hasExpectedImageSignature(expected.contentType, signature)) {
      await file.delete({ ignoreNotFound: true });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function deleteDeliveryPhotoObject(deliveryId: string, objectPath: string): Promise<void> {
  const { bucket, object } = privateObjectForDelivery(deliveryId, objectPath);
  await storage.bucket(bucket).file(object).delete({ ignoreNotFound: true });
}

export async function createDeliveryPhotoDownloadUrl(deliveryId: string, objectPath: string): Promise<string> {
  const { bucket, object } = privateObjectForDelivery(deliveryId, objectPath);
  const [url] = await storage.bucket(bucket).file(object).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 5 * 60_000,
  });
  return url;
}