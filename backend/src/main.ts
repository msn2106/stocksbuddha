import "reflect-metadata";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import { resolveLocale } from "@ra/contracts";
import { findPublicTenant, resolvePage } from "./tenants/tenants";

class AppModule {}
Module({})(AppModule);

const production = process.env.NODE_ENV === "production";
// Source and build both live one directory below backend/. Do not depend on cwd:
// npm workspace scripts execute from the package directory.
const frontendRoot = fileURLToPath(new URL("../../frontend/", import.meta.url));
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
  res.json({ status: "ok", slice: "S0.1" }),
);
server.get("/api/ra/:slug", (req, res) => {
  const tenant = findPublicTenant(req.params.slug);
  res
    .status(tenant ? 200 : 404)
    .json(tenant ? { tenant } : { error: "Tenant not found" });
});
server.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
server.get("/", (_req, res) => res.redirect(302, "/ra/stocks-buddha"));

const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({
      root: frontendRoot,
      configFile: path.join(frontendRoot, "vite.config.ts"),
      // Avoid temporary bundled configs being observed by the backend watcher.
      configLoader: "runner",
      server: { middlewareMode: true },
      appType: "custom",
    });
if (vite) server.use(vite.middlewares);
else
  server.use(
    "/assets",
    express.static(path.join(frontendRoot, "dist/client/assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );

server.use(async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD")
    return res.status(405).send("Method not allowed");
  try {
    const cookieLanguage = /(?:^|;\s*)ra-language=([A-Za-z0-9-]+)(?:;|$)/.exec(
      req.headers.cookie ?? "",
    )?.[1];
    const language = req.query.lang ?? cookieLanguage;
    const data = {
      ...resolvePage(req.path),
      locale: resolveLocale(language),
    };
    let template = await readFile(
      path.join(
        frontendRoot,
        production ? "dist/client/index.html" : "index.html",
      ),
      "utf8",
    );
    if (vite)
      template = await vite.transformIndexHtml(req.originalUrl, template);
    const renderer = vite
      ? await vite.ssrLoadModule("/src/entry-server.tsx")
      : await import(
          pathToFileURL(path.join(frontendRoot, "dist/server/entry-server.js"))
            .href
        );
    const rendered = renderer.render(data);
    res
      .status(data.tenant ? 200 : 404)
      .type("html")
      .send(
        template
          .replace("<!--app-lang-->", () => rendered.lang)
          .replace("<!--app-head-->", () => rendered.head)
          .replace("<!--app-html-->", () => rendered.html)
          .replace("<!--app-data-->", () => rendered.data),
      );
  } catch (error) {
    if (vite && error instanceof Error) vite.ssrFixStacktrace(error);
    next(error);
  }
});
server.use(((error, _req, res, _next) => {
  console.error(error instanceof Error ? error.message : "Render failure");
  res
    .status(500)
    .type("text")
    .send("The website could not load. Please try again.");
}) as express.ErrorRequestHandler);
const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
  logger: ["error", "warn"],
});
app.enableShutdownHooks();
const port = Number(process.env.PORT || 3000);
await app.listen(port, process.env.HOST || "127.0.0.1");
console.log(`RA website: http://localhost:${port}/ra/stocks-buddha`);
