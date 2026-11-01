import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("SSR content, tenant metadata, unknown paths, and API boundaries", async ({
  request,
}) => {
  const alpha = await request.get("/ra/alpha");
  const alphaHtml = await alpha.text();
  expect(alpha.status()).toBe(200);
  expect(alphaHtml).toContain(
    "<title>Alpha Research | Independent Research</title>",
  );
  expect(alphaHtml).toContain("A patient perspective on Indian equities.");
  expect(alphaHtml).not.toContain("Beta Research");
  const beta = await request.get("/ra/beta");
  expect(await beta.text()).toContain(
    "<title>Beta Research | Independent Research</title>",
  );
  for (const route of [
    "/ra/missing",
    "/ra/admin",
    "/api/ra/missing",
    "/api/other",
  ])
    expect((await request.get(route)).status()).toBe(404);
  const result = await request.get("/api/ra/alpha");
  expect((await result.json()).tenant.slug).toBe("alpha");
  expect(result.headers()["cache-control"]).toBe("no-store");
});

test("separate tenant tabs retain their own identity", async ({ context }) => {
  const alpha = await context.newPage();
  const beta = await context.newPage();
  await Promise.all([alpha.goto("/ra/alpha"), beta.goto("/ra/beta")]);
  await expect(alpha).toHaveTitle("Alpha Research | Independent Research");
  await expect(beta).toHaveTitle("Beta Research | Independent Research");
  await alpha.reload();
  await expect(alpha.getByRole("heading", { level: 1 })).toHaveText(
    "A patient perspective on Indian equities.",
  );
  await expect(beta.getByRole("heading", { level: 1 })).toHaveText(
    "Understand the market. Respect the risk.",
  );
});

test("primary interactions, keyboard dialog, FAQ, accessibility and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/ra/stocksbuddha");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Clarity in a market full of noise.",
  );
  await page
    .getByRole("button", { name: "Valuation Question the price" })
    .click();
  await expect(page.getByText("Price is part of the story.")).toBeVisible();
  await page
    .getByRole("button", { name: "View subscription availability" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "View subscription availability" }),
  ).toBeFocused();
  await page
    .getByText("Are investment returns guaranteed?", { exact: true })
    .click();
  await expect(
    page.getByText("No. Investments in securities markets", { exact: false }),
  ).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.screenshot({ path: "test-results/desktop-viewport.png" });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Our approach" })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).not.toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ra/stocksbuddha");
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.screenshot({ path: "test-results/mobile-viewport.png" });
  expect(errors).toEqual([]);
});
