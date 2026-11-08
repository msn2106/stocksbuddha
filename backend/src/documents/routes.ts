import express, { type Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { AuthRoutesDependencies } from "../auth/routes";
import type { AccountView, Tenant } from "@ra/contracts";
import { DocumentError, DocumentService } from "./service";
import { maxDocumentBytes } from "./policy";

type Page = (
  res: express.Response,
  next: express.NextFunction,
  tenant: Tenant | null,
  view: AccountView,
  status?: number,
) => void;
/** Mount independent authenticated document routes before general JSON parsers, bounding raw uploads after authorization. */
export function mountDocuments(
  router: Router,
  dependencies: Pick<AuthRoutesDependencies, "auth" | "store"> & {
    service: DocumentService;
    origin: string;
    page: Page;
  },
) {
  const { auth, store, service, origin, page } = dependencies;
  const api = express.Router({ mergeParams: true });
  api.use(async (req, res, next) => {
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity?.user.emailVerified)
      return res.status(401).json({ error: "unauthorized" });
    const workspace = req.params.slug
      ? await store.find(identity.user.id, req.params.slug as string)
      : null;
    if (req.params.slug && !workspace)
      return res.status(404).json({ error: "workspace_not_found" });
    res.locals.documentContext = {
      token: identity.session.token,
      tenantId: workspace?.tenant.id ?? null,
    };
    // Authorize platform access before reading even a bounded upload body.
    if (!workspace) await service.list(res.locals.documentContext);
    if (req.method !== "GET" && req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  api.get("/", async (req, res) =>
    res.json(
      await service.list(
        res.locals.documentContext,
        typeof req.query.before === "string" ? req.query.before : undefined,
      ),
    ),
  );
  api.get("/customers", async (_req, res) =>
    res.json({
      customers: await service.customers(res.locals.documentContext),
    }),
  );
  api.post(
    "/",
    express.raw({
      type: ["application/pdf", "image/jpeg", "image/png"],
      limit: maxDocumentBytes,
    }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new DocumentError("invalid_document", 400);
      let name: string;
      try {
        name = decodeURIComponent(req.get("X-Document-Name") ?? "");
      } catch {
        throw new DocumentError("invalid_document", 400);
      }
      const result = await service.upload(res.locals.documentContext, {
        kind: req.get("X-Document-Kind") ?? "",
        customerId: req.get("X-Customer-Id"),
        name,
        mime: req.get("Content-Type")?.split(";")[0] ?? "",
        bytes: req.body,
      });
      res.status(201).json(result);
    },
  );
  api.get("/:id/download", async (req, res) => {
    const file = await service.download(
      res.locals.documentContext,
      req.params.id as string,
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
    );
    res.type(file.mime).send(file.bytes);
  });
  api.use(((error, _req, res, _next) => {
    void _next;
    const tooLarge = error?.type === "entity.too.large";
    res
      .status(
        error instanceof DocumentError ? error.status : tooLarge ? 413 : 502,
      )
      .json({
        error:
          error instanceof DocumentError
            ? error.code
            : tooLarge
              ? "document_too_large"
              : "document_storage_failed",
      });
  }) as express.ErrorRequestHandler);
  router.use(["/api/documents", "/api/workspaces/:slug/documents"], api);
  router.get(
    [
      "/workspace/documents",
      "/ra/:slug/workspace/documents",
      "/ra/:slug/account/documents",
    ],
    async (req, res, next) => {
      const identity = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!identity?.user.emailVerified)
        return res.redirect(
          303,
          req.params.slug
            ? `/ra/${encodeURIComponent(req.params.slug as string)}/login`
            : "/workspace/login",
        );
      const workspace = req.params.slug
        ? await store.find(identity.user.id, req.params.slug as string)
        : null;
      if (req.params.slug && !workspace)
        return res.status(404).send("Workspace unavailable");
      if (
        workspace &&
        ((req.path.includes("/account/") &&
          workspace.membership.role !== "subscriber") ||
          (req.path.includes("/workspace/") &&
            workspace.membership.role === "subscriber"))
      )
        return res.status(403).send("Workspace unavailable");
      try {
        await service.list({
          token: identity.session.token,
          tenantId: workspace?.tenant.id ?? null,
        });
      } catch {
        return res.status(403).send("Workspace unavailable");
      }
      return page(res, next, workspace?.tenant ?? null, {
        mode: "workspace",
        section: "documents",
        area: workspace
          ? workspace.membership.role === "subscriber"
            ? "investor"
            : "organisation"
          : "platform",
        role: workspace?.membership.role ?? "platform_owner",
        capabilities: workspace?.capabilities ?? [],
        profile: {
          name: identity.user.name,
          email: identity.user.email,
          emailVerified: true,
        },
      });
    },
  );
}
