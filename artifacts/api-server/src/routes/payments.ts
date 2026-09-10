import { Router, type IRouter } from "express";
import { GetStripePaymentConfigResponse } from "@workspace/api-zod";
import { currentAuth, requireRoles } from "../lib/auth";
import { getStripeCredentials } from "../lib/stripe-client";

const router: IRouter = Router();

router.get("/payments/stripe-config", requireRoles("customer"), async (req, res): Promise<void> => {
  try {
    const { publishableKey } = await getStripeCredentials();
    if (!publishableKey) {
      res.status(503).json({ error: "Stripe checkout is unavailable because its publishable key is not configured." });
      return;
    }
    res.json(GetStripePaymentConfigResponse.parse({ publishableKey }));
  } catch (error) {
    req.log.error({ err: error, customerId: currentAuth(res).profileId }, "Stripe checkout configuration unavailable");
    res.status(503).json({ error: "Secure payments are temporarily unavailable. Please try again shortly." });
  }
});

export default router;