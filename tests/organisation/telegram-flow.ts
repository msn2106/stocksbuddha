import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Authenticate real disposable RA/investor sessions through the rendered form. */
async function login(page: Page, email: string, owner = false) {
  await page.goto("/ra/alpha/login");
  if (owner)
    await page
      .getByRole("radio", { name: "Organisation", exact: true })
      .check();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(owner ? /\/workspace$/ : /\/account$/);
}

test("RA connects bot; investor links and replaces account; recommendation sends once to latest chat", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "settings-admin@example.test", true);
  await page.goto("/ra/alpha/workspace/website");
  await page
    .getByRole("button", { name: "Telegram Settings", exact: true })
    .click();
  await page
    .getByLabel("Bot token", { exact: true })
    .fill("123456789:fake_test_bot_token");
  await page
    .getByRole("button", { name: "Save Telegram settings", exact: true })
    .click();
  await expect(page.getByText(/Telegram token saved/)).toBeVisible();
  await page
    .getByRole("button", { name: "Connect bot to site", exact: true })
    .click();
  await expect(
    page.getByText("Bot @fixture_ra_bot is connected."),
  ).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `/tmp/sb-telegram-owner-${width}.png`,
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  const context = await browser.newContext(),
    investor = await context.newPage();
  investor.on("pageerror", (error) => errors.push(error.message));
  try {
    await login(investor, "telegram-investor@example.test");
    await investor.goto("/ra/alpha/account/recommendations");
    let updateId = 10000;
    for (const userId of [101, 202]) {
      await investor
        .getByRole("button", {
          name:
            userId === 101 ? "Connect Telegram" : "Replace Telegram account",
          exact: true,
        })
        .click();
      const invite = investor.getByRole("link", {
        name: "Open personal Telegram invite",
      });
      await expect(invite).toBeVisible();
      const token = new URL(
        (await invite.getAttribute("href"))!,
      ).searchParams.get("start");
      for (const payload of [
        { text: `/start ${token}` },
        { contact: { user_id: userId, phone_number: "919876543210" } },
      ]) {
        const response = await investor.request.post("/__test/telegram-input", {
          headers: { Origin: "http://127.0.0.1:3111" },
          data: {
            update_id: ++updateId,
            message: {
              chat: { id: userId, type: "private" },
              from: { id: userId, is_bot: false },
              ...payload,
            },
          },
        });
        expect(response.status()).toBe(204);
      }
      await investor
        .getByRole("button", { name: "Refresh Telegram status" })
        .focus();
      await investor.keyboard.press("Enter");
      await expect(
        investor.getByText(/Connected to @fixture_ra_bot/),
      ).toBeVisible();
    }
    for (const width of [1280, 390]) {
      await investor.setViewportSize({ width, height: 900 });
      expect(
        await investor.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      expect(
        (await new AxeBuilder({ page: investor }).analyze()).violations,
      ).toEqual([]);
      await investor.screenshot({
        path: `/tmp/sb-telegram-investor-${width}.png`,
        fullPage: true,
      });
    }
    const seed = await page.request.post("/__test/telegram-recommendation", {
      headers: { Origin: "http://127.0.0.1:3111" },
    });
    expect(seed.ok()).toBeTruthy();
    await page.goto("/ra/alpha/workspace/recommendations");
    await page
      .getByRole("button", { name: "View research", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Send latest version to Telegram" })
      .click();
    await expect(page.getByText("pending: 1", { exact: true })).toBeVisible();
    const delivered = await page.request.post("/__test/telegram-deliver", {
      headers: { Origin: "http://127.0.0.1:3111" },
    });
    const sends = await delivered.json();
    expect(sends).toHaveLength(1);
    expect(sends[0].chat_id).toBe("202");
    await page.getByRole("button", { name: "Refresh delivery status" }).click();
    await expect(page.getByText("delivered: 1", { exact: true })).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: `/tmp/sb-telegram-delivery-${width}.png`,
        fullPage: true,
      });
    }
    await investor.getByRole("button", { name: "Disconnect Telegram" }).click();
    await expect(
      investor.getByRole("button", { name: "Connect Telegram", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
