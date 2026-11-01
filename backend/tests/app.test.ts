import { test } from "node:test";
import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { createPublicApp, type PublicAppDependencies } from "../src/app";
import { makePage } from "../../packages/contracts/tests/fixtures";

/** Exercise an Express request with an in-memory transport and stubbed adapters, without opening a port. */
async function request(
  dependencies: Partial<PublicAppDependencies>,
  url: string,
  method = "GET",
) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const req = new IncomingMessage(socket as Socket);
  req.url = url;
  req.method = method;
  req.httpVersion = "1.0";
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 0;
  const res = new ServerResponse(req);
  res.assignSocket(socket as Socket);
  const app = createPublicApp({
    resolvePage: async () => makePage(),
    renderPage: async () => ({
      template:
        "<!--app-lang-->|<!--app-head-->|<!--app-html-->|<!--app-data-->",
      lang: "en",
      head: "head",
      html: "page",
      data: "data",
    }),
    onError: () => {},
    ...dependencies,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      res.on("finish", resolve);
      res.on("error", reject);
      app(req, res);
    });
    return {
      status: res.statusCode,
      headers: res.getHeaders(),
      body: Buffer.concat(chunks)
        .toString()
        .split("\r\n\r\n")
        .slice(1)
        .join("\r\n\r\n"),
    };
  } finally {
    socket.destroy();
  }
}

test("public route handlers select success/not-found/method/redirect responses with controlled adapters", async () => {
  for (const path of [
    "/workspace/login",
    "/workspace/verify-email",
    "/workspace/forgot-password",
    "/workspace/reset-password",
    "/api/auth/get-session",
    "/api/session",
    "/api/workspaces",
    "/workspace/stocksbuddha",
    "/ra/example/login",
    "/ra/example/signup",
  ]) {
    assert.equal((await request({}, path)).status, 503);
  }
  assert.equal((await request({}, "/api/ready")).status, 200);
  assert.equal(
    (await request({ ready: async () => false }, "/api/ready")).status,
    503,
  );
  const unavailable = await request(
    {
      ready: async () => {
        throw new Error("private database details");
      },
    },
    "/api/ready",
  );
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.includes("private"), false);
  assert.deepEqual(JSON.parse((await request({}, "/api/health")).body), {
    status: "ok",
    slice: "S0.2",
  });
  assert.equal((await request({}, "/api/ra/example")).status, 200);
  const missing: PublicAppDependencies["resolvePage"] = async () => ({
    tenant: null,
    website: null,
    page: "not-found",
    locale: "en",
  });
  assert.equal(
    (await request({ resolvePage: missing }, "/api/ra/missing")).status,
    404,
  );
  assert.equal((await request({}, "/api/unknown")).status, 404);
  assert.equal((await request({}, "/ra/example", "POST")).status, 405);
  const page = await request({}, "/ra/example");
  assert.equal(page.body, "en|head|page|data");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(
    (await request({ resolvePage: missing }, "/ra/missing")).status,
    404,
  );
  assert.equal((await request({}, "/ra/example", "HEAD")).body, "");
  for (const url of ["/ra/stocks-buddha", "/ra/stocks-buddha?lang=hi", "/"])
    assert.ok([302, 308].includes((await request({}, url)).status));
});

test("render errors are redacted and optional assets take precedence over rendering", async () => {
  const errors: unknown[] = [];
  const result = await request(
    {
      renderPage: async () => {
        throw new Error("Secret");
      },
      onError: (error) => errors.push(error),
    },
    "/ra/example",
  );
  assert.equal(result.status, 500);
  assert.equal(result.body.includes("Secret"), false);
  assert.equal(errors.length, 1);
  const asset = await request(
    {
      assets: (_req, res) => {
        res.send("asset");
      },
    },
    "/assets/x.js",
  );
  assert.equal(asset.body, "asset");
});
