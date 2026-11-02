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
  for (const url of ["/ra/stocks-buddha", "/ra/stocks-buddha?lang=hi"])
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

test("platform homepage renders without tenant resolution and defaults to preview indexing", async () => {
  const pages: unknown[] = [];
  const deps: Partial<PublicAppDependencies> = {
    resolvePage: async () => {
      throw new Error("Platform must not resolve an RA");
    },
    renderPage: async (data) => {
      pages.push(data);
      return {
        template: "<!--app-html-->",
        html: data.page,
        head: "",
        data: "",
        lang: data.locale,
      };
    },
  };
  const home = await request(deps, "/?lang=hi", "GET");
  assert.equal(home.status, 200);
  assert.equal(home.body, "platform");
  assert.equal(home.headers["x-robots-tag"], "noindex, nofollow");
  assert.deepEqual(pages[0], {
    tenant: null,
    website: null,
    page: "platform",
    locale: "hi",
    indexable: false,
    platformAccessError: false,
  });
  assert.equal((await request(deps, "/", "HEAD")).body, "");
  assert.equal((await request(deps, "/", "POST")).status, 405);
  const live = await request(
    { ...deps, brandSiteIndexable: true },
    "/?lang=invalid",
  );
  assert.equal(live.headers["x-robots-tag"], "index, follow");
  assert.equal((pages.at(-1) as { locale: string }).locale, "en");
  const invalid = await request(deps, "/?access=invalid");
  assert.equal(invalid.status, 200);
  assert.equal(
    (pages.at(-1) as { platformAccessError: boolean }).platformAccessError,
    true,
  );
});

test("platform access validates slug and never implicitly chooses an RA", async () => {
  for (const [path, target] of [
    ["/login", "/?lang=en#access"],
    ["/signin?lang=hi", "/?lang=hi#access"],
    ["/signup", "/?lang=en#contact"],
    [
      "/access?slug=alpha&audience=organisation&lang=hi",
      "/ra/alpha/login?lang=hi&audience=organisation",
    ],
    [
      "/access?slug=beta&audience=unknown&lang=unknown",
      "/ra/beta/login?lang=en&audience=investor",
    ],
    ["/access?slug=../../workspace", "/?lang=en&access=invalid#access"],
    ["/access?slug=admin", "/?lang=en&access=invalid#access"],
    ["/access", "/?lang=en&access=invalid#access"],
  ]) {
    const response = await request({}, path);
    assert.equal(response.headers.location, target);
    assert.ok([302, 303].includes(response.status));
  }
  const tenant = await request({ brandSiteIndexable: true }, "/ra/example");
  assert.equal(tenant.headers["x-robots-tag"], "noindex, nofollow");
});
