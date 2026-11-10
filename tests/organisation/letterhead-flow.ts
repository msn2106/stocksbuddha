import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import AxeBuilder from "@axe-core/playwright";

test("RA uploads and previews its own letterhead, saves margins and restores defaults independently of Stocks Buddha", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/ra/alpha/login");
  await page.getByRole("radio", { name: "Organisation", exact: true }).check();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("settings-admin@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await page.goto("/ra/alpha/workspace/plans");
  const section = page.getByRole("region", { name: "Letterhead", exact: true });
  await expect(section).toContainText("Default: standard RA stationery");
  const source = await PDFDocument.create();
  source
    .addPage([595.276, 841.89])
    .drawText("ALPHA RESEARCH LETTERHEAD", { x: 60, y: 780, size: 14 });
  const bytes = Buffer.from(await source.save());
  await section.getByLabel("Letterhead PDF", { exact: true }).setInputFiles({
    name: "alpha-letterhead.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await expect(section).toContainText("Uploaded: alpha-letterhead.pdf");
  await section.getByLabel("Top margin (mm)").fill("60");
  await section.getByLabel("Bottom margin (mm)").fill("25");
  await section
    .getByRole("button", { name: "Preview letterhead agreement", exact: true })
    .click();
  await expect(
    section.getByTitle("Letterhead agreement preview"),
  ).toBeVisible();
  const before = await (
    await page.request.get("/api/workspaces/alpha/onboarding/letterhead")
  ).json();
  expect(before.version).toBe(0);
  await section
    .getByRole("button", { name: "Save letterhead", exact: true })
    .click();
  await expect(section.getByRole("status")).toContainText("Letterhead saved");
  await page.reload();
  await expect(section).toContainText("Uploaded: alpha-letterhead.pdf");
  await expect(section.getByLabel("Top margin (mm)")).toHaveValue("60");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).exclude("iframe").analyze()).violations,
    ).toEqual([]);
    await section.screenshot({
      path: `/tmp/stocksbuddha-ra-letterhead-${width}.png`,
    });
  }
  const second = await browser.newContext();
  const stock = await second.newPage();
  await stock.goto("/ra/stocksbuddha/login");
  await stock.getByRole("radio", { name: "Organisation", exact: true }).check();
  await stock
    .getByLabel("Email address", { exact: true })
    .fill("onboarding-admin@example.test");
  await stock.getByLabel("Password", { exact: true }).fill("test-password-123");
  await stock.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(stock).toHaveURL(/\/workspace$/);
  await stock.goto("/ra/stocksbuddha/workspace/plans");
  await expect(
    stock.getByRole("region", { name: "Letterhead", exact: true }),
  ).toContainText("Default: Stocks Buddha supplied letterhead");
  expect(
    (
      await stock.request.get("/api/workspaces/alpha/onboarding/letterhead")
    ).status(),
  ).toBe(404);
  await second.close();
  await section
    .getByRole("button", {
      name: "Remove uploaded letterhead / restore default",
      exact: true,
    })
    .click();
  await section
    .getByRole("button", { name: "Save letterhead", exact: true })
    .click();
  await expect(section).toContainText("Default: standard RA stationery");
  expect(errors).toEqual([]);
});
