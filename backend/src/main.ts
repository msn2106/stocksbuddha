import "reflect-metadata";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import { createPublicApp } from "./app";
import { SeedTenantRepository } from "./tenants/tenants";
import { SeedWebsiteRepository } from "./websites/repository";
import { createPublicSiteResolver } from "./tenancy/resolve-public-site";

const resolvePage = createPublicSiteResolver(
  new SeedTenantRepository(),
  new SeedWebsiteRepository(),
);

/** Nest application root for the public-site Express server; no providers are registered yet. */
class AppModule {}
Module({})(AppModule);

export type StartupOptions = {
  env?: NodeJS.ProcessEnv;
  frontendRoot?: string;
  createVite?: typeof import("vite").createServer;
  buildApp?: typeof createPublicApp;
  createNest?: typeof NestFactory.create;
  log?: typeof console.log;
};

/**
 * Configure rendering and start the public server with injectable lifecycle adapters.
 * @param options - Environment, frontend asset location and process-boundary adapters.
 * @returns The initialized Nest application after shutdown hooks and listening are configured.
 * @throws If Vite/application startup fails; request rendering errors propagate to Express.
 */
export async function startServer({
  env = process.env,
  frontendRoot = fileURLToPath(new URL("../../frontend/", import.meta.url)),
  createVite,
  buildApp = createPublicApp,
  createNest = NestFactory.create.bind(NestFactory),
  log = console.log,
}: StartupOptions = {}) {
  const production = env.NODE_ENV === "production";
  // Source and build both live one directory below backend/. Do not depend on cwd:
  // npm workspace scripts execute from the package directory.
  const vite = production
    ? null
    : await (createVite ?? (await import("vite")).createServer)({
        root: frontendRoot,
        configFile: path.join(frontendRoot, "vite.config.ts"),
        // Avoid temporary bundled configs being observed by the backend watcher.
        configLoader: "runner",
        server: { middlewareMode: true },
        appType: "custom",
      });
  const server = buildApp({
    resolvePage,
    assets: vite
      ? vite.middlewares
      : express.Router().use(
          "/assets",
          express.static(path.join(frontendRoot, "dist/client/assets"), {
            immutable: true,
            maxAge: "1y",
          }),
        ),
    /** Load the environment-specific HTML template and renderer for each request. */
    renderPage: async (data, req) => {
      try {
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
              pathToFileURL(
                path.join(frontendRoot, "dist/server/entry-server.js"),
              ).href
            );
        return { template, ...renderer.render(data) };
      } catch (error) {
        if (vite && error instanceof Error) vite.ssrFixStacktrace(error);
        throw error;
      }
    },
  });
  const app = await createNest(AppModule, new ExpressAdapter(server), {
    logger: ["error", "warn"],
  });
  app.enableShutdownHooks();
  const port = Number(env.PORT || 3000);
  await app.listen(port, env.HOST || "127.0.0.1");
  log(`RA website: http://localhost:${port}/ra/stocksbuddha`);
  return app;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await startServer();
