import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import profileRouter from "./profile";
import discoverRouter from "./discover";
import matchesRouter from "./matches";
import messagesRouter from "./messages";
import sparksRouter from "./sparks";
import supportRouter from "./support";
import gifsRouter from "./gifs";
import phoneVerificationRouter from "./phone-verification";
import blockedContactsRouter from "./blocked-contacts";
import videoCallsRouter from "./video-calls";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(profileRouter);
router.use(discoverRouter);
router.use(matchesRouter);
router.use(messagesRouter);
router.use(sparksRouter);
router.use(supportRouter);
router.use(gifsRouter);
router.use(phoneVerificationRouter);
router.use(blockedContactsRouter);
router.use(videoCallsRouter);

export default router;