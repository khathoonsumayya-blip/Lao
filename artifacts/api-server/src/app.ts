import express, { type Express } from "express";
import Stripe from "stripe";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authenticateRequest, type AuthContext } from "./lib/auth";
import { WebhookHandlers } from "./lib/webhook-handlers";

const app: Express = express();
const isProduction = process.env.NODE_ENV === "production";
const approvedProductionOrigins = new Set([
  "https://www.anythinganywhere.com",
  "https://driver.anythinganywhere.com",
  "https://admin.anythinganywhere.com",
]);
const configuredCorsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
// Production CORS is an allowlist, never an arbitrary reflection of the
// request origin. An unset or invalid production configuration intentionally
// allows no credentialed browser origin.
const corsOrigins = isProduction
  ? configuredCorsOrigins.filter((origin) => approvedProductionOrigins.has(origin))
  : configuredCorsOrigins;
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res): Promise<void> => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing Stripe signature." });
      return;
    }
    const normalizedSignature = Array.isArray(signature) ? signature[0] : signature;
    try {
      await WebhookHandlers.processStripeWebhook(req.body as Buffer, normalizedSignature);
      res.status(200).json({ received: true });
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        req.log.warn({ err: error }, "Rejected Stripe webhook signature");
        res.status(400).json({ error: "Webhook verification failed." });
        return;
      }
      req.log.error({ err: error }, "Verified Stripe webhook processing failed");
      res.status(500).json({ error: "Webhook processing failed; Stripe will retry." });
    }
  },
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || !isProduction || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authenticateRequest);
app.use((req, res, next) => {
  const auth = res.locals.auth as AuthContext | undefined;
  if (
    safeMethods.has(req.method) ||
    auth?.authMethod !== "cookie" ||
    (!isProduction && !process.env.CORS_ORIGIN)
  ) {
    next();
    return;
  }
  const origin = req.get("origin");
  if (!origin || !corsOrigins.includes(origin)) {
    res.status(403).json({ error: "Cookie-authenticated requests require an approved origin." });
    return;
  }
  next();
});

app.use("/api", router);

export default app;
