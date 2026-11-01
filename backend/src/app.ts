import express, { type Request, type RequestHandler } from "express";
import type { PageData } from "@ra/contracts";
import { requestMonitoring, monitorTenant } from "./monitoring";

export type RenderedPage = {
  template: string;
  lang: string;
  html: string;
  head: string;
  data: string;
};
export type PublicAppDependencies = {
  resolvePage: (
    pathname: string,
    requestedLocale?: unknown,
    cookies?: string,
  ) => Promise<PageData>;
  renderPage: (data: PageData, request: Request) => Promise<RenderedPage>;
  assets?: RequestHandler;
  authentication?: RequestHandler;
  onError?: (error: unknown) => void;
  ready?: () => Promise<boolean>;
};

/**
 * Construct public routes and middleware without opening a port or starting Vite/Nest.
 * @param dependencies - Request resolver, renderer and optional asset/error adapters.
 * @returns An independent Express application suitable for HTTP integration tests.
 */
export function createPublicApp({
  resolvePage,
  renderPage,
  assets,
  authentication,
  ready = async () => true,
  onError = (error) =>
    console.error(error instanceof Error ? error.message : "Render failure"),
}: PublicAppDependencies) {
  const server = express();
  server.disable("x-powered-by");
  server.use(requestMonitoring);
  server.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // Preview content must not be indexed or cached across tenants.
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  server.get("/api/health", (_req, res) =>
    res.json({ status: "ok", slice: "S0.2" }),
  );
  server.get("/api/ready", async (_req, res) => {
    try {
      const available = await ready();
      res
        .status(available ? 200 : 503)
        .json({ status: available ? "ready" : "unavailable" });
    } catch (error) {
      onError(error);
      res.status(503).json({ status: "unavailable" });
    }
  });
  if (authentication) server.use(authentication);
  else {
    server.get(
      [
        "/workspace/login",
        "/workspace/verify-email",
        "/workspace/forgot-password",
        "/workspace/reset-password",
      ],
      (req, res, next) => {
        res.status(503);
        res.locals.accountPage = {
          tenant: null,
          website: null,
          page: "account",
          locale: "en",
          account: {
            mode: req.path.split("/").at(-1) as
              "login" | "verify-email" | "forgot-password" | "reset-password",
            audience: "platform",
            error: "service",
          },
        } satisfies PageData;
        next();
      },
    );
    server.get("/ra/:slug/signin", (req, res) =>
      res.redirect(
        308,
        `/ra/${encodeURIComponent(req.params.slug as string)}/login`,
      ),
    );
    server.get(["/login", "/signin", "/signup"], (req, res) =>
      res.redirect(
        302,
        `/ra/stocksbuddha/${req.path === "/signup" ? "signup" : "login"}`,
      ),
    );
    server.get(
      [
        "/ra/:slug/login",
        "/ra/:slug/signup",
        "/ra/:slug/verify-email",
        "/ra/:slug/forgot-password",
        "/ra/:slug/reset-password",
      ],
      async (req, res, next) => {
        const data = await resolvePage(
          `/ra/${req.params.slug}`,
          req.query.lang,
          req.headers.cookie,
        );
        if (!data.tenant)
          return res.status(404).json({ error: "workspace_not_found" });
        res.status(503);
        res.locals.accountPage = {
          ...data,
          page: "account",
          account: {
            mode: req.path.split("/").at(-1) as
              | "signup"
              | "login"
              | "verify-email"
              | "forgot-password"
              | "reset-password",
            error: "service",
          },
        } satisfies PageData;
        next();
      },
    );
    server.use(
      [
        "/api/auth",
        "/api/session",
        "/api/workspaces",
        "/workspace",
        "/workspaces",
        "/ra/:slug/account",
        "/ra/:slug/invitation",
        "/logout",
        "/ra/:slug/login",
        "/ra/:slug/signup",
        "/ra/:slug/logout",
        "/ra/:slug/workspace",
      ],
      (_req, res, next) =>
        res.locals.accountPage
          ? next()
          : res.status(503).json({ error: "authentication_unavailable" }),
    );
  }
  server.get("/api/ra/:slug", async (req, res) => {
    const data = await resolvePage(
      `/ra/${req.params.slug}`,
      req.query.lang,
      req.headers.cookie,
    );
    const tenant = data.tenant;
    if (tenant) monitorTenant(tenant.id);
    res
      .status(tenant ? 200 : 404)
      .json(tenant ? data : { error: "Tenant not found" });
  });
  server.use("/api", (_req, res) =>
    res.status(404).json({ error: "Not found" }),
  );
  // Canonical public slug; only the known former address redirects.
  server.get(["/ra/stocks-buddha", "/ra/stocks-buddha/"], (req, res) => {
    const query = req.originalUrl.includes("?")
      ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
      : "";
    res.redirect(308, `/ra/stocksbuddha${query}`);
  });
  server.get("/", (_req, res) => res.redirect(302, "/ra/stocksbuddha"));

  if (assets) server.use(assets);
  server.use(async (req, res, next) => {
    const account: PageData | undefined = res.locals.accountPage;
    if (!account && req.method !== "GET" && req.method !== "HEAD")
      return res.status(405).send("Method not allowed");
    try {
      const publicData = await resolvePage(
        account?.tenant ? `/ra/${account.tenant.slug}` : req.path,
        req.query.lang,
        req.headers.cookie,
      );
      const data = account
        ? {
            ...publicData,
            tenant: account.tenant,
            page: "account" as const,
            account: account.account,
          }
        : publicData;
      if (data.tenant) monitorTenant(data.tenant.id);
      const rendered = await renderPage(data, req);
      res
        .status(account ? res.statusCode : data.tenant ? 200 : 404)
        .type("html")
        .send(
          rendered.template
            .replace("<!--app-lang-->", () => rendered.lang)
            .replace("<!--app-head-->", () => rendered.head)
            .replace("<!--app-html-->", () => rendered.html)
            .replace("<!--app-data-->", () => rendered.data),
        );
    } catch (error) {
      next(error);
    }
  });
  server.use(((error, _req, res, _next) => {
    // Preserve Express's four-argument error-middleware signature.
    void _next;
    onError(error);
    res
      .status(500)
      .type("text")
      .send("The website could not load. Please try again.");
  }) as express.ErrorRequestHandler);
  return server;
}
