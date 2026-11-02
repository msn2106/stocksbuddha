import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("canonical slug and old-address redirect preserve the requested language", async ({
  request,
}) => {
  const home = await request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(200);
  expect(home.headers().location).toBeUndefined();
  const old = await request.get("/ra/stocks-buddha?lang=hi", {
    maxRedirects: 0,
  });
  expect(old.status()).toBe(308);
  expect(old.headers().location).toBe("/ra/stocksbuddha?lang=hi");
  expect((await request.get(old.headers().location)).status()).toBe(200);
});
test("public API and SSR expose only the requested tenant and selected language", async ({
  request,
}) => {
  const alpha = await request.get(
    "/api/ra/alpha?lang=hi&tenantId=dab574d1-3eea-4547-8295-3bf8d22c6282",
    { headers: { "x-tenant-id": "dab574d1-3eea-4547-8295-3bf8d22c6282" } },
  );
  const data = await alpha.json();
  expect(data.tenant.slug).toBe("alpha");
  expect(data.website.tenantId).toBe(data.tenant.id);
  expect(data.locale).toBe("hi");
  expect(data.website.content["site.hero"]).toBe(
    "भारतीय इक्विटी पर एक धैर्यपूर्ण नज़रिया।",
  );
  expect(JSON.stringify(data)).not.toContain("Beta Research");
  expect(data.website.content.en).toBeUndefined();
  expect(data.website.status).toBeUndefined();
  const html = await (await request.get("/ra/alpha?lang=hi")).text();
  expect(html).not.toContain("A patient perspective on Indian equities.");
  expect(html).not.toContain("Understand the market. Respect the risk.");
  expect(alpha.headers()["cache-control"]).toBe("no-store");
  expect(
    (
      await request.post("/api/ra/alpha", {
        data: { tenantId: data.tenant.id },
      })
    ).status(),
  ).toBe(404);
});
test("tenant languages persist independently across tabs without changing another tenant", async ({
  context,
}) => {
  const alpha = await context.newPage(),
    beta = await context.newPage();
  await alpha.goto("/ra/alpha?lang=hi");
  await beta.goto("/ra/beta");
  await expect(alpha.locator("html")).toHaveAttribute("lang", "hi");
  await expect(beta.locator("html")).toHaveAttribute("lang", "en");
  await alpha.goto("/ra/alpha");
  await expect(alpha.locator("html")).toHaveAttribute("lang", "hi");
  await beta.reload();
  await expect(beta.locator("html")).toHaveAttribute("lang", "en");
  const cookies = await context.cookies();
  const languageCookies = cookies.filter((c) =>
    c.name.startsWith("ra-language-"),
  );
  expect(languageCookies).toHaveLength(2);
  expect(languageCookies.map((c) => c.path).sort()).toEqual([
    "/ra/alpha",
    "/ra/beta",
  ]);
});
test("different tenant templates render configured DOM order with accessible responsive content", async ({
  page,
}) => {
  await page.goto("/ra/alpha");
  await expect(page.locator(".site-shell")).toHaveAttribute(
    "data-template",
    "classic",
  );
  await expect(page.locator(".framework-visual")).toBeVisible();
  expect(
    await page
      .locator("main > section[id]")
      .evaluateAll((nodes) => nodes.map((n) => n.id)),
  ).toEqual([
    "hero",
    "research",
    "approach",
    "about",
    "expectations",
    "plans",
    "faq",
    "investor",
  ]);
  await page.goto("/ra/beta");
  await expect(page.locator(".site-shell")).toHaveAttribute(
    "data-template",
    "editorial",
  );
  await expect(page.locator(".framework-visual")).toHaveCount(0);
  await expect(page.locator(".principles-bar")).toHaveCount(0);
  expect(
    await page
      .locator("main > section[id]")
      .evaluateAll((nodes) => nodes.map((n) => n.id)),
  ).toEqual([
    "hero",
    "about",
    "research",
    "approach",
    "expectations",
    "plans",
    "faq",
    "investor",
  ]);
  for (const locale of ["en", "hi"]) {
    await page.goto(`/ra/beta?lang=${locale}`);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.screenshot({
    path: "test-results/beta-editorial-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/beta-editorial-desktop.png",
    fullPage: true,
  });
});
