import { ReplitConnectors } from "@replit/connectors-sdk";

type SendPasswordResetEmailInput = {
  recipient: string;
  resetUrl: string;
  expiresInMinutes: number;
};

export class EmailProviderError extends Error {
  constructor(
    readonly provider: "resend",
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`Resend rejected password reset email (${status}): ${responseBody || "empty response"}`);
    this.name = "EmailProviderError";
  }
}

function senderAddress(): string {
  const sender = process.env.PASSWORD_RESET_FROM_EMAIL?.trim();
  if (!sender) {
    throw new Error("PASSWORD_RESET_FROM_EMAIL is required to send password reset email.");
  }
  return sender;
}

function redactProviderDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactProviderDetails);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /api[-_]?key|authorization|credential|password|secret|token/i.test(key)
          ? "[REDACTED]"
          : redactProviderDetails(entry),
      ]),
    );
  }
  return value;
}

function safeProviderResponse(raw: string): string {
  if (!raw) return "";
  try {
    return JSON.stringify(redactProviderDetails(JSON.parse(raw)));
  } catch {
    return raw
      .replace(/(api[-_]?key|authorization|credential|password|secret|token)\s*[:=]\s*[^,\s}]+/gi, "$1=[REDACTED]")
      .slice(0, 8_000);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function sendPasswordResetEmail({
  recipient,
  resetUrl,
  expiresInMinutes,
}: SendPasswordResetEmailInput): Promise<void> {
  const safeResetUrl = escapeHtml(resetUrl);
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderAddress(),
      to: [recipient],
      subject: "Reset your Anything Anywhere password",
      text: [
        "We received a request to reset your Anything Anywhere password.",
        "",
        `Use this link within ${expiresInMinutes} minutes:`,
        resetUrl,
        "",
        "If you did not request this, you can safely ignore this email.",
      ].join("\n"),
      html: `<p>We received a request to reset your Anything Anywhere password.</p><p><a href="${safeResetUrl}">Reset your password</a> within ${expiresInMinutes} minutes.</p><p>If you did not request this, you can safely ignore this email.</p>`,
    }),
  });

  if (!response.ok) {
    throw new EmailProviderError(
      "resend",
      response.status,
      safeProviderResponse(await response.text()),
    );
  }
}

/** Deliberately returns no provider payload: settings test delivery is an admin-only diagnostic. */
export async function sendAdminTestEmail(recipient: string, senderName: string, replyTo?: string | null): Promise<void> {
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${senderName} <${senderAddress()}>`, to: [recipient], ...(replyTo ? { reply_to: replyTo } : {}),
      subject: "Anything Anywhere email settings test",
      text: "Your administrator email settings test was sent successfully.",
    }),
  });
  if (!response.ok) throw new EmailProviderError("resend", response.status, safeProviderResponse(await response.text()));
}