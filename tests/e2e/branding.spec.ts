import { test, expect } from "@playwright/test";

test("Stocks Buddha logos follow the actual surface and public letterhead samples remain unsigned PDFs", async ({
  page,
  request,
}) => {
  await page.goto("/ra/stocksbuddha");
  const header = page.locator(".brand:not(.brand-footer)").first();
  await expect(header.locator("img.brand-artwork-light")).toBeVisible();
  await expect(header.locator("img.brand-artwork-dark")).toBeHidden();
  await expect(
    page.locator(".brand-footer img.brand-artwork-dark"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Sample agreement on letterhead",
      exact: true,
    }),
  ).toHaveAttribute("href", "/ra/stocksbuddha/sample-agreement.pdf");
  await page
    .getByRole("button", { name: "Display preferences", exact: true })
    .click();
  await page.getByLabel("High contrast", { exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(header.locator("img.brand-artwork-dark")).toBeVisible();
  await expect(header.locator("img.brand-artwork-light")).toBeHidden();
  for (const path of [
    "/assets/brand/stocksbuddha-light.png",
    "/assets/brand/stocksbuddha-dark.png",
    "/assets/brand/stocksbuddha-letterhead-v1.pdf",
    "/ra/stocksbuddha/sample-agreement.pdf",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect((await response.body()).length).toBeGreaterThan(1000);
    if (path.endsWith(".pdf")) {
      expect(response.headers()["content-type"]).toContain("application/pdf");
      expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
    }
  }
  expect((await request.get("/ra/alpha/sample-agreement.pdf")).status()).toBe(
    404,
  );
});
