import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public login links open tenant-branded account pages and preserve language", async ({
  page,
  request,
}) => {
  await page.goto("/ra/alpha");
  await page.getByRole("link", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/ra\/alpha\/login\?lang=en$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Alpha Research/ }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "unavailable in this preview",
  );
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/ra\/alpha\/signup\?lang=en$/);
  await expect(page.getByLabel("Full name")).toBeVisible();
  expect(
    (await request.get("/login", { maxRedirects: 0 })).headers().location,
  ).toBe("/?lang=en#access");
  expect((await request.get("/ra/unknown/login")).status()).toBe(404);
  await page.goto("/ra/beta/signup?lang=hi");
  await expect(
    page.getByRole("heading", { name: "अपना खाता बनाएँ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "साइन इन करें", exact: true }),
  ).toHaveAttribute("href", "/ra/beta/login?lang=hi");
});

test("account pages load styles without hydration errors and remain accessible at desktop and mobile widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ra/stocksbuddha/signup");
    await expect(
      page.getByRole("heading", { name: "Create your account", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByRole("button", { name: "Create account", exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  }
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
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
  expect(errors).toEqual([]);
});
