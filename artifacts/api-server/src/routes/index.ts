import { Router, type IRouter } from "express";
import healthRouter from "./health";
import deliveriesRouter from "./deliveries";
import authRouter from "./auth";
import paymentsRouter from "./payments";
import adminRouter from "./admin";
import driverRewardsRouter from "./driver-rewards";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(paymentsRouter);
router.use(adminRouter);
router.use(driverRewardsRouter);
router.use(deliveriesRouter);

export default router;
