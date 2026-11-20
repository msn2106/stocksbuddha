import express, { type Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { AccountView, Tenant } from "@ra/contracts";
import type { AuthRoutesDependencies } from "../auth/routes";
import { OnboardingError } from "../onboarding/domain";
import type { MarketService } from "./service";
/** Private RA workspace endpoints with same-origin mutations and bounded request bodies. */
export function mountMarket(
  router: Router,
  d: Pick<AuthRoutesDependencies, "auth" | "store"> & {
    service: MarketService;
    origin: string;
    page: (
      res: express.Response,
      next: express.NextFunction,
      tenant: Tenant | null,
      account: AccountView,
    ) => void;
  },
) {
  const api = express.Router({ mergeParams: true });
  api.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const identity = await d.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity?.user.emailVerified)
      return res.status(401).json({ error: "unauthorized" });
    const workspace = await d.store.find(
      identity.user.id,
      req.params.slug as string,
    );
    if (!workspace || workspace.membership.role !== "owner")
      return res.status(403).json({ error: "forbidden" });
    if (req.method !== "GET" && req.headers.origin !== d.origin)
      return res.status(403).json({ error: "forbidden_origin" });
    res.locals.marketContext = {
      token: identity.session.token,
      tenantId: workspace.tenant.id,
    };
    next();
  });
  api.use(express.json({ limit: "32kb" }));
  api.get("/", async (_req, res) =>
    res.json(await d.service.read(res.locals.marketContext)),
  );
  api.get("/instruments", async (req, res) =>
    res.json(
      await d.service.search(
        res.locals.marketContext,
        String(req.query.q ?? ""),
        String(req.query.type ?? ""),
        String(req.query.expiry ?? ""),
      ),
    ),
  );
  api.get("/instruments/:key", async (req, res) =>
    res.json(
      await d.service.instrument(
        res.locals.marketContext,
        String(req.params.key),
      ),
    ),
  );
  api.post("/", async (req, res) =>
    res.json(await d.service.mutate(res.locals.marketContext, req.body)),
  );
  api.post("/check", async (req, res) => {
    if (
      !Array.isArray(req.body?.keys) ||
      req.body.keys.length > 10 ||
      !req.body.keys.every(
        (k: unknown) => typeof k === "string" && k.length < 160,
      )
    )
      return res.status(400).json({ error: "invalid_fields" });
    res.json(await d.service.check(res.locals.marketContext, req.body.keys));
  });
  api.use(((error, _req, res, _next) => {
    void _next;
    res
      .status(
        error instanceof OnboardingError
          ? error.status
          : error?.type === "entity.too.large"
            ? 413
            : 503,
      )
      .json({
        error:
          error instanceof OnboardingError ? error.code : "market_unavailable",
      });
  }) as express.ErrorRequestHandler);
  router.use("/api/workspaces/:slug/market", api);
  router.get("/ra/:slug/workspace/market", async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const identity = await d.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity?.user.emailVerified)
      return res.redirect(
        303,
        `/ra/${encodeURIComponent(req.params.slug)}/login`,
      );
    const workspace = await d.store.find(identity.user.id, req.params.slug);
    if (!workspace || workspace.membership.role !== "owner")
      return res.status(403).send("Workspace unavailable");
    return d.page(res, next, workspace.tenant, {
      mode: "workspace",
      section: "market",
      area: "organisation",
      role: "owner",
      capabilities: workspace.capabilities,
      profile: {
        name: identity.user.name,
        email: identity.user.email,
        emailVerified: true,
      },
    });
  });
}
