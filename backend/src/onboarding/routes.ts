import express, { type Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { AccountView, Tenant } from "@ra/contracts";
import type { AuthRoutesDependencies } from "../auth/routes";
import { OnboardingError } from "./domain";
import type { OnboardingService } from "./service";
type Page = (
  res: express.Response,
  next: express.NextFunction,
  tenant: Tenant | null,
  account: AccountView,
  status?: number,
) => void;
/** Mount bounded, independently authorized onboarding APIs and workspace pages before generic body parsers. */
export function mountOnboarding(
  router: Router,
  dependencies: Pick<AuthRoutesDependencies, "auth" | "store"> & {
    service: OnboardingService;
    origin: string;
    page: Page;
  },
) {
  const { auth, store, service, origin, page } = dependencies;
  const api = express.Router({ mergeParams: true });
  api.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity?.user.emailVerified)
      return res.status(401).json({ error: "unauthorized" });
    const workspace = await store.find(
      identity.user.id,
      req.params.slug as string,
    );
    if (!workspace)
      return res.status(404).json({ error: "workspace_not_found" });
    if (!["owner", "subscriber"].includes(workspace.membership.role))
      return res.status(403).json({ error: "forbidden" });
    if (req.method !== "GET" && req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    res.locals.onboardingContext = {
      token: identity.session.token,
      tenantId: workspace.tenant.id,
    };
    next();
  });
  api.use(express.json({ limit: "64kb" }));
  api.get("/", async (req, res) => {
    res.json(
      await service.read(
        res.locals.onboardingContext,
        typeof req.query.customer === "string" ? req.query.customer : undefined,
        typeof req.query.before === "string" ? req.query.before : undefined,
      ),
    );
  });
  api.post("/:action", async (req, res) => {
    const context = res.locals.onboardingContext,
      body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return res.status(400).json({ error: "invalid_fields" });
    switch (req.params.action) {
      case "plan":
      case "coupon":
      case "settings":
        return res.json(await service.manage(context, req.params.action, body));
      case "kyc-save":
      case "kyc-submit":
        return res.json(
          await service.saveKyc(
            context,
            body,
            req.params.action === "kyc-submit",
          ),
        );
      case "review":
        return res.json(await service.review(context, body));
      case "quote":
        return res.json(await service.quote(context, body));
      case "code":
        return res.json(await service.sendCode(context, body.orderId));
      case "sign":
        return res.json(await service.sign(context, body));
      case "skip":
        return res.json(await service.skip(context, body));
      case "payment":
        return res.json(await service.payment(context, body.orderId));
      case "confirm":
        return res.json(await service.confirm(context, body.orderId));
      case "cancel":
        return res.json(await service.cancel(context, body.orderId));
      default:
        return res.status(404).json({ error: "not_found" });
    }
  });
  /** Bound and sanitize all unexpected database, cryptographic and provider failures. */
  const errors: express.ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const status =
      error instanceof OnboardingError
        ? error.status
        : error?.type === "entity.too.large"
          ? 413
          : error?.type === "entity.parse.failed"
            ? 400
            : error?.code === "ER_DUP_ENTRY"
              ? 409
              : 503;
    res.status(status).json({
      error:
        error instanceof OnboardingError
          ? error.code
          : status === 409
            ? "record_exists"
            : status === 400
              ? "invalid_fields"
              : "onboarding_unavailable",
    });
  };
  api.use(errors);
  router.use("/api/workspaces/:slug/onboarding", api);
  const webhooks = express.Router();
  webhooks.post(
    "/:slug",
    express.raw({ type: "application/json", limit: "128kb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        return res.status(400).json({ error: "invalid_fields" });
      res.json(
        await service.webhook(
          req.params.slug,
          req.body,
          req.get("x-webhook-timestamp") ?? "",
          req.get("x-webhook-signature") ?? "",
        ),
      );
    },
  );
  webhooks.use(errors);
  router.use("/api/onboarding/webhooks", webhooks);
  router.get(
    [
      "/ra/:slug/workspace/plans",
      "/ra/:slug/workspace/users",
      "/ra/:slug/workspace/users/:customerId",
      "/ra/:slug/account/onboarding",
    ],
    async (req, res, next) => {
      const identity = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!identity?.user.emailVerified)
        return res.redirect(
          303,
          `/ra/${encodeURIComponent(req.params.slug as string)}/login`,
        );
      const workspace = await store.find(
        identity.user.id,
        req.params.slug as string,
      );
      const investor = req.path.includes("/account/");
      if (
        !workspace ||
        workspace.membership.role !== (investor ? "subscriber" : "owner")
      )
        return res.status(403).send("Workspace unavailable");
      return page(res, next, workspace.tenant, {
        mode: "workspace",
        onboardingEnabled: true,
        section: investor
          ? "onboarding"
          : req.path.includes("/plans")
            ? "plans"
            : "users",
        customerId: req.params.customerId as string | undefined,
        area: investor ? "investor" : "organisation",
        role: workspace.membership.role,
        capabilities: workspace.capabilities,
        profile: {
          name: identity.user.name,
          email: identity.user.email,
          emailVerified: true,
        },
      });
    },
  );
}
