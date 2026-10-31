import express, { type Request, type RequestHandler } from "express";
import type { PageData } from "@ra/contracts";

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
  onError?: (error: unknown) => void;
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
  onError = (error) =>
    console.error(error instanceof Error ? error.message : "Render failure"),
}: PublicAppDependencies) {
  const server = express();
  server.disable("x-powered-by");
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
  server.get("/api/ra/:slug", async (req, res) => {
    const data = await resolvePage(
      `/ra/${req.params.slug}`,
      req.query.lang,
      req.headers.cookie,
    );
    const tenant = data.tenant;
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
    if (req.method !== "GET" && req.method !== "HEAD")
      return res.status(405).send("Method not allowed");
    try {
      const data = await resolvePage(
        req.path,
        req.query.lang,
        req.headers.cookie,
      );
      const rendered = await renderPage(data, req);
      res
        .status(data.tenant ? 200 : 404)
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
