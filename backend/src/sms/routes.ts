import express, { type Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { AuthRoutesDependencies } from "../auth/routes";
import { clientIp, trustedProxies } from "../auth/client-ip";
import { SmsError } from "./policy";
import type { SmsService } from "./service";

/** Mount private SMS APIs and generic public investor recovery with bounded bodies and fresh authorization. */
export function mountSms(
  router: Router,
  dependencies: Pick<AuthRoutesDependencies, "auth" | "store"> & {
    service: SmsService;
    origin: string;
    trustedProxyAddresses?: string;
  },
) {
  const { auth, store, service, origin } = dependencies;
  const trusted = trustedProxies(dependencies.trustedProxyAddresses);
  const api = express.Router({ mergeParams: true });
  api.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    next();
  });
  api.use("/settings", express.json({ limit: "256kb" }));
  api.use(express.json({ limit: "8kb" }));
  api.use(async (req, res, next) => {
    await service.throttle(clientIp(req, trusted));
    if (req.path.startsWith("/public/")) return next();
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity?.user.emailVerified)
      return res.status(401).json({ error: "unauthorized" });
    const workspace = await store.find(
      identity.user.id,
      (req.params as Record<string, string>).slug,
    );
    if (!workspace) return res.status(403).json({ error: "forbidden" });
    res.locals.smsContext = {
      token: identity.session.token,
      tenantId: workspace.tenant.id,
    };
    next();
  });
  api.get("/settings", async (_req, res) =>
    res.json(await service.settings(res.locals.smsContext)),
  );
  api.post("/settings", async (req, res) =>
    res.json(await service.saveSettings(res.locals.smsContext, req.body)),
  );
  api.get("/records", async (req, res) =>
    res.json(
      await service.records(
        res.locals.smsContext,
        typeof req.query.before === "string" ? req.query.before : undefined,
      ),
    ),
  );
  api.get("/mobile", async (_req, res) =>
    res.json(await service.mobile(res.locals.smsContext)),
  );
  api.post("/send", async (req, res) =>
    res.json(
      await service.send({
        context: res.locals.smsContext,
        mobile: req.body?.mobile,
        key: req.body?.key,
        ip: clientIp(req, trusted),
      }),
    ),
  );
  api.post("/verify", async (req, res) =>
    res.json(
      await service.verify({
        context: res.locals.smsContext,
        challengeId: req.body?.challengeId,
        code: req.body?.code,
        ip: clientIp(req, trusted),
      }),
    ),
  );
  api.post("/recovery-contact", async (req, res) =>
    res.json(
      await service.recoveryContact(
        res.locals.smsContext,
        req.body?.password,
        req.body?.enabled,
      ),
    ),
  );
  api.post("/public/send", async (req, res) => {
    const started = Date.now();
    const result = await service.send({
      slug: (req.params as Record<string, string>).slug,
      email: req.body?.email,
      key: req.body?.key,
      ip: clientIp(req, trusted),
    });
    // Equal minimum response duration for existing and unknown accounts, longer than the bounded vendor deadline.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 8500 - (Date.now() - started))),
    );
    res.json({
      ...result,
      sendsRemaining: 0,
      attemptsRemaining: 5,
      message:
        "If SMS recovery is enabled and within its limit, a code has been sent. SMS is limited to three sends per rolling 24 hours. Email recovery is available anytime.",
    });
  });
  api.post("/public/reset", async (req, res) => {
    const password = req.body?.password;
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128 ||
      password !== req.body?.confirmPassword
    )
      return res.status(400).json({ error: "invalid_password" });
    await service.verify({
      slug: (req.params as Record<string, string>).slug,
      challengeId: req.body?.challengeId,
      code: req.body?.code,
      ip: clientIp(req, trusted),
      newPassword: password,
    });
    res.json({ ok: true });
  });
  /** Return safe classifications without serializing provider or database exceptions. */
  const errors: express.ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const status =
      error instanceof SmsError
        ? error.status
        : error?.type === "entity.too.large"
          ? 413
          : error?.type === "entity.parse.failed"
            ? 400
            : 503;
    if (error instanceof SmsError && error.retryAfter)
      res.setHeader("Retry-After", error.retryAfter);
    res.status(status).json({
      error: error instanceof SmsError ? error.code : "sms_unavailable",
    });
  };
  api.use(errors);
  router.use("/api/sms/:slug", api);
}
