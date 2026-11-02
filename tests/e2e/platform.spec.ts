import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("platform homepage renders independently with safe metadata and preserved tenant boundaries", async ({
  request,
}) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  const html = await response.text();
  expect(html).toContain("Your research business. Its own place online.");
  expect(html).not.toContain("INH0000210695");
  const bootstrap = JSON.parse(
    html.match(
      /<script id="page-data" type="application\/json">(.*?)<\/script>/s,
    )![1]!,
  );
  expect(bootstrap.tenant).toBeNull();
  expect(bootstrap.website).toBeNull();
  expect(bootstrap.page).toBe("platform");
  expect((await request.get("/unknown")).status()).toBe(404);
  expect((await request.get("/api/unknown")).status()).toBe(404);
  for (const slug of ["stocksbuddha", "alpha", "beta"]) {
    const ra = await request.get(`/api/ra/${slug}`);
    expect(ra.status()).toBe(200);
    expect((await ra.json()).tenant.slug).toBe(slug);
  }
  expect((await request.get("/workspace")).status()).toBe(503);
  expect((await request.get("/ra/alpha/workspace")).status()).toBe(503);
});

test("platform sign-in routes each audience explicitly and demo requests use email", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/#access$/);
  await page.getByLabel("RA website name").fill("alpha");
  await page.getByRole("button", { name: "RA Admin / team sign in" }).click();
  await expect(page).toHaveURL(
    /\/ra\/alpha\/login\?lang=en&audience=organisation$/,
  );
  await expect(
    page.getByRole("radio", { name: "Organisation", exact: true }),
  ).toBeChecked();
  await page.goto("/?lang=hi#access");
  await page.getByLabel("RA वेबसाइट का नाम").fill("beta");
  await page
    .getByRole("button", { name: "निवेशक साइन इन", exact: true })
    .click();
  await expect(page).toHaveURL(/\/ra\/beta\/login\?lang=hi&audience=investor$/);
  await page.goto("/");
  await page
    .getByRole("link", { name: "Platform owner sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspace\/login\?lang=en$/);
  await expect(page.locator(".account-platform")).toHaveAttribute("href", "/");
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Email to request a demo" }),
  ).toHaveAttribute("href", /^mailto:support@stocksbuddha.com/);
  for (const [path, target] of [
    ["/login", "/?lang=en#access"],
    ["/signup", "/?lang=en#contact"],
  ]) {
    expect(
      (await request.get(path!, { maxRedirects: 0 })).headers().location,
    ).toBe(target);
  }
  await page.goto("/access?slug=admin");
  await expect(page.getByRole("alert")).toContainText("non-reserved");
});

test("platform is accessible, hydrated and responsive in English and Hindi", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const locale of ["en", "hi"]) {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/?lang=${locale}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`platform-${locale}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page
    .getByRole("button", { name: "Display preferences", exact: true })
    .click();
  await page
    .getByRole("radio", { name: "Double size (200%)", exact: true })
    .check();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(errors).toEqual([]);
});
