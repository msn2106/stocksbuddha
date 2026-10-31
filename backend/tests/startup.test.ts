import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { NestFactory } from "@nestjs/core";
import { fileURLToPath } from "node:url";
import { startServer, type StartupOptions } from "../src/main";
import type { PublicAppDependencies } from "../src/app";
import { makePage } from "../../packages/contracts/tests/fixtures";

test("production startup configures lifecycle and renders from the configured asset root without opening ports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sb-startup-"));
  const calls: unknown[][] = [];
  let dependencies: PublicAppDependencies | undefined;
  const app = {
    enableShutdownHooks: () => calls.push(["shutdown"]),
    listen: async (...args: unknown[]) => calls.push(["listen", ...args]),
  };
  try {
    await mkdir(path.join(root, "dist/client"), { recursive: true });
    await mkdir(path.join(root, "dist/server"), { recursive: true });
    await writeFile(
      path.join(root, "dist/client/index.html"),
      "production template",
    );
    await writeFile(
      path.join(root, "dist/server/entry-server.js"),
      'exports.render = (data) => ({ html: data.page, head: "metadata", data: "json", lang: data.locale });',
    );
    const result = await startServer({
      env: { NODE_ENV: "production", HOST: "0.0.0.0", PORT: "3200" },
      frontendRoot: root,
      buildApp: (options) => {
        dependencies = options;
        return express();
      },
      createNest: (async () => app) as unknown as NonNullable<
        StartupOptions["createNest"]
      >,
      log: (...args) => calls.push(args),
    });
    assert.equal(result, app);
    assert.deepEqual(calls.slice(0, 2), [
      ["shutdown"],
      ["listen", 3200, "0.0.0.0"],
    ]);
    assert.ok(dependencies?.assets);
    const rendered = await dependencies!.renderPage(makePage(), {
      originalUrl: "/ra/example",
    } as express.Request);
    assert.equal(rendered.template, "production template");
    assert.equal(rendered.html, "landing");
    await rm(path.join(root, "dist/client/index.html"));
    await assert.rejects(
      () => dependencies!.renderPage(makePage(), {} as express.Request),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("development startup transforms HTML, uses Vite SSR and forwards corrected rendering failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sb-startup-dev-"));
  let dependencies: PublicAppDependencies | undefined;
  const listens: unknown[][] = [],
    corrected: Error[] = [];
  let fail: boolean | string = false;
  const vite = {
    middlewares: express(),
    transformIndexHtml: async (url: string, template: string) =>
      `${url}:${template}`,
    ssrLoadModule: async () => {
      if (fail === "non-error") throw "opaque rejection";
      if (fail) throw new Error("render failed");
      return {
        render: () => ({ lang: "en", html: "SSR", head: "", data: "" }),
      };
    },
    ssrFixStacktrace: (error: Error) => corrected.push(error),
  };
  try {
    await writeFile(path.join(root, "index.html"), "development template");
    await startServer({
      env: {},
      frontendRoot: root,
      createVite: (async () => vite) as unknown as NonNullable<
        StartupOptions["createVite"]
      >,
      buildApp: (options) => {
        dependencies = options;
        return express();
      },
      createNest: (async () => ({
        enableShutdownHooks() {},
        listen: async (...args: unknown[]) => listens.push(args),
      })) as unknown as NonNullable<StartupOptions["createNest"]>,
      log: () => {},
    });
    assert.deepEqual(listens, [[3000, "127.0.0.1"]]);
    const rendered = await dependencies!.renderPage(makePage(), {
      originalUrl: "/ra/example?lang=en",
    } as express.Request);
    assert.equal(rendered.template, "/ra/example?lang=en:development template");
    fail = true;
    await assert.rejects(
      () =>
        dependencies!.renderPage(makePage(), {
          originalUrl: "/ra/example",
        } as express.Request),
      /render failed/,
    );
    assert.equal(corrected.length, 1);
    fail = "non-error";
    await assert.rejects(
      () =>
        dependencies!.renderPage(makePage(), {
          originalUrl: "/ra/example",
        } as express.Request),
      (error: unknown) => error === "opaque rejection",
    );
    assert.equal(corrected.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the production CLI dispatches startup through the default Nest adapter without opening a port", async (context) => {
  const argv = process.argv;
  const mode = process.env.NODE_ENV;
  const calls: unknown[][] = [];
  const app = {
    enableShutdownHooks() {},
    listen: async (...args: unknown[]) => {
      calls.push(args);
    },
  };
  context.mock.method(NestFactory, "create", async () => app as never);
  context.mock.method(console, "log", () => {});
  try {
    process.env.NODE_ENV = "production";
    process.argv = [
      process.execPath,
      fileURLToPath(new URL("../src/main.ts", import.meta.url)),
    ];
    await import(new URL("../src/main.ts?unit-cli", import.meta.url).href);
    assert.equal(calls.length, 1);
  } finally {
    process.argv = argv;
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
  }
});
