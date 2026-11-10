import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("RA configures private template library and dedicated integration tabs across screen sizes", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/ra/alpha/login");
  await page.getByRole("radio", { name: "Organisation", exact: true }).check();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("settings-admin@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await page.goto("/ra/alpha/workspace/website");
  await expect(page.getByLabel("Website name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Vendor username", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "SMS Settings", exact: true }).click();
  await page.getByLabel("Vendor username", { exact: true }).fill("settings-ra");
  await page
    .getByLabel("API key (leave blank to retain saved key)", { exact: true })
    .fill("fake-settings-api-key");
  await page.getByLabel("Approved sender ID").fill("HORIZN");
  await page
    .getByLabel("DLT entity ID", { exact: true })
    .fill("110100000000001");
  await page
    .getByLabel("DLT template ID", { exact: true })
    .fill("110100000000002");
  await page
    .getByLabel("Approved message", { exact: true })
    .fill(
      "Your verification code is {{otp}}. Valid for {{expiryMinutes}} minutes.",
    );
  await page
    .getByRole("button", { name: "Add SMS template", exact: true })
    .click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Subscription reminder");
  await page
    .getByLabel("DLT template ID", { exact: true })
    .fill("110100000000003");
  await page
    .getByLabel("Approved message", { exact: true })
    .fill("Your subscription renewal is due. - Your RA");
  await page
    .getByRole("button", { name: "Save SMS settings", exact: true })
    .click();
  await expect(
    page.getByText("SMS settings saved.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Subscription reminder / }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Reset\/Forgot Password / }).click();
  await expect(
    page.getByText(/This entry stores your reference copy/),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Login / }).click();
  for (const [name, width] of [
    ["desktop", 1280],
    ["tablet", 768],
    ["mobile", 390],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(
      "Login",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    const username = await page
      .getByLabel("Vendor username", { exact: true })
      .boundingBox();
    expect(username!.width).toBeGreaterThan(180);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: `/tmp/sb-sms-${name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("button", { name: "Telegram Settings", exact: true })
    .click();
  await page
    .getByLabel("Bot token", { exact: true })
    .fill("123456789:fake-test-bot-token");
  await page
    .getByLabel("Channel / chat ID", { exact: true })
    .fill("@research_channel");
  await page
    .getByLabel("Investor invite link (optional)")
    .fill("https://t.me/+testInvite");
  await page
    .getByRole("button", { name: "Save Telegram settings", exact: true })
    .click();
  await expect(page.getByText(/Telegram settings saved/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "/tmp/sb-telegram-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Payment Settings", exact: true })
    .click();
  await page
    .getByLabel("Client ID", { exact: true })
    .fill("TEST_settings_merchant");
  await page
    .getByLabel("Client secret", { exact: true })
    .fill("fake-settings-secret");
  await page
    .getByRole("button", { name: "Save payment settings", exact: true })
    .click();
  await expect(
    page.getByText("Payment gateway settings saved.", { exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "/tmp/sb-payment-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "SMS Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Subscription reminder / }),
  ).toBeVisible();
  await expect(
    page.getByLabel("API key (leave blank to retain saved key)", {
      exact: true,
    }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Add SMS template", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(
    "New SMS 4",
  );
  await page
    .getByRole("button", { name: "Remove New SMS 4", exact: true })
    .click();
  expect(errors).toEqual([]);
});
