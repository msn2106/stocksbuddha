import express, { type Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { AccountView, Tenant } from "@ra/contracts";
import type { AuthRoutesDependencies } from "../auth/routes";
import { OnboardingError } from "../onboarding/domain";
import { ResearchValidationError, type ResearchService } from "./service";
/** Bind recommendation APIs and pages to the current authenticated tenant; mutations require same origin. */
export function mountResearch(
  router: Router,
  d: Pick<AuthRoutesDependencies, "auth" | "store"> & {
    service: ResearchService;
    origin: string;
    page: (
      res: express.Response,
      next: express.NextFunction,
      tenant: Tenant | null,
      view: AccountView,
    ) => void;
  },
) {
  const api = express.Router({ mergeParams: true });
  api.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const identity = await d.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity?.user.emailVerified)
      return res.status(401).json({ error: "unauthorized" });
    const workspace = await d.store.find(
      identity.user.id,
      String(req.params.slug),
    );
    if (
      !workspace ||
      !["owner", "subscriber"].includes(workspace.membership.role)
    )
      return res.status(403).json({ error: "forbidden" });
    if (req.method !== "GET" && req.headers.origin !== d.origin)
      return res.status(403).json({ error: "forbidden_origin" });
    res.locals.researchContext = {
      token: identity.session.token,
      tenantId: workspace.tenant.id,
    };
    next();
  });
  api.use(express.json({ limit: "128kb" }));
  api.get("/", async (req, res) =>
    res.json(
      await d.service.list(
        res.locals.researchContext,
        Number(req.query.page ?? 0),
      ),
    ),
  );
  api.get("/options", async (_req, res) =>
    res.json(await d.service.options(res.locals.researchContext)),
  );
  api.post("/groups", async (req, res) =>
    res.json(await d.service.saveGroup(res.locals.researchContext, req.body)),
  );
  api.post("/", async (req, res) =>
    res.json(await d.service.save(res.locals.researchContext, req.body)),
  );
  api.get("/:id", async (req, res) =>
    res.json(
      await d.service.detail(res.locals.researchContext, String(req.params.id)),
    ),
  );
  api.post("/:id/preview", async (req, res) =>
    res.json(
      await d.service.preview(
        res.locals.researchContext,
        String(req.params.id),
      ),
    ),
  );
  api.post("/:id/publish", async (req, res) =>
    res.json(
      await d.service.publish(
        res.locals.researchContext,
        String(req.params.id),
        req.body,
      ),
    ),
  );
  api.post("/:id/close", async (req, res) =>
    res.json(
      await d.service.close(
        res.locals.researchContext,
        String(req.params.id),
        req.body,
      ),
    ),
  );
  api.post("/:id/read", async (req, res) =>
    res.json(
      await d.service.markRead(
        res.locals.researchContext,
        String(req.params.id),
        req.body?.version,
      ),
    ),
  );
  api.get("/:id/attachments/:fileId", async (req, res) => {
    const file = await d.service.download(
      res.locals.researchContext,
      String(req.params.id),
      String(req.params.fileId),
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="research-attachment"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    );
    res.type(file.mime).send(file.bytes);
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
        ...(error instanceof ResearchValidationError
          ? { issues: error.issues }
          : {}),
        error:
          error instanceof OnboardingError
            ? error.code
            : "research_unavailable",
      });
  }) as express.ErrorRequestHandler);
  router.use("/api/workspaces/:slug/recommendations", api);
  for (const area of ["workspace", "account"])
    router.get(`/ra/:slug/${area}/recommendations`, async (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      const identity = await d.auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!identity?.user.emailVerified)
        return res.redirect(
          303,
          `/ra/${encodeURIComponent(req.params.slug)}/login`,
        );
      const w = await d.store.find(identity.user.id, req.params.slug);
      const role = area === "workspace" ? "owner" : "subscriber";
      if (!w || w.membership.role !== role)
        return res.status(403).send("Workspace unavailable");
      d.page(res, next, w.tenant, {
        mode: "workspace",
        section: "recommendations",
        area: area === "workspace" ? "organisation" : "investor",
        role,
        capabilities: w.capabilities,
        profile: {
          name: identity.user.name,
          email: identity.user.email,
          emailVerified: true,
        },
      });
    });
}
