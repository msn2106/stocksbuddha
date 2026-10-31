import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPublicApp, type PublicAppDependencies } from "../../src/app";
import { makePage } from "../../../packages/contracts/tests/fixtures";

/** Open an ephemeral HTTP boundary for one integration scenario and always close its connections. */
async function withApp(
  dependencies: Partial<PublicAppDependencies>,
  scenario: (base: string) => Promise<void>,
) {
  const app = createPublicApp({
    resolvePage: async (pathname) =>
      pathname === "/ra/example"
        ? makePage()
        : { tenant: null, website: null, locale: "en", page: "not-found" },
    renderPage: async (page) => ({
      template:
        '<html lang="<!--app-lang-->"><head><!--app-head--></head><body><!--app-html--><!--app-data--></body></html>',
      lang: page.locale,
      head: "<title>Example</title>",
      html: page.tenant ? "Example page" : "Unavailable",
      data: "<script>bootstrap</script>",
    }),
    onError: () => {},
    ...dependencies,
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await scenario(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("independent app instances expose health, tenant projections, 404s, headers and SSR", async () => {
  const calls: unknown[][] = [];
  await withApp(
    {
      resolvePage: async (...args) => {
        calls.push(args);
        return args[0] === "/ra/example"
          ? makePage()
          : { tenant: null, website: null, locale: "en", page: "not-found" };
      },
    },
    async (base) => {
      const health = await fetch(`${base}/api/health`);
      assert.deepEqual(await health.json(), { status: "ok", slice: "S0.2" });
      assert.equal(health.headers.get("cache-control"), "no-store");
      assert.equal(health.headers.get("x-powered-by"), null);
      const tenant = await fetch(`${base}/api/ra/example?lang=hi`, {
        headers: { cookie: "test=value" },
      });
      assert.equal(tenant.status, 200);
      assert.deepEqual(calls.at(-1), ["/ra/example", "hi", "test=value"]);
      assert.equal((await fetch(`${base}/api/ra/missing`)).status, 404);
      assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
      const page = await fetch(`${base}/ra/example`);
      assert.equal(page.status, 200);
      assert.match(
        await page.text(),
        /<html lang="en"><head><title>Example<\/title>/,
      );
      assert.equal((await fetch(`${base}/ra/missing`)).status, 404);
      assert.equal(
        (await fetch(`${base}/ra/example`, { method: "HEAD" })).status,
        200,
      );
      assert.equal(
        (await fetch(`${base}/ra/example`, { method: "POST" })).status,
        405,
      );
      for (const [url, status, destination] of [
        ["/", 302, "/ra/stocksbuddha"],
        ["/ra/stocks-buddha?lang=hi", 308, "/ra/stocksbuddha?lang=hi"],
        ["/ra/stocks-buddha", 308, "/ra/stocksbuddha"],
      ] as const) {
        const redirect = await fetch(base + url, { redirect: "manual" });
        assert.equal(redirect.status, status);
        assert.equal(redirect.headers.get("location"), destination);
      }
    },
  );
});

test("resolver/renderer failures reach the injected error boundary without disclosing details", async () => {
  for (const failing of ["resolvePage", "renderPage"] as const) {
    const errors: unknown[] = [];
    await withApp(
      {
        [failing]: async () => {
          throw new Error("Private credentials");
        },
        onError: (error) => errors.push(error),
      },
      async (base) => {
        for (const route of failing === "resolvePage"
          ? ["/ra/example", "/api/ra/example"]
          : ["/ra/example"]) {
          const response = await fetch(base + route);
          assert.equal(response.status, 500);
          assert.equal(
            (await response.text()).includes("Private credentials"),
            false,
          );
        }
        assert.ok(errors.length > 0);
      },
    );
  }
});

test("optional asset middleware can serve a response before SSR", async () => {
  await withApp(
    {
      assets: (req, res, next) =>
        req.path === "/assets/test.js"
          ? void res.type("js").send("asset")
          : next(),
    },
    async (base) => {
      assert.equal(
        await (await fetch(`${base}/assets/test.js`)).text(),
        "asset",
      );
      assert.equal((await fetch(`${base}/ra/example`)).status, 200);
    },
  );
});
