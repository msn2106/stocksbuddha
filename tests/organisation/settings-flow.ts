import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
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

test("RA can enter and save Cashfree credentials while investor orders are quoted or signed", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const adminContext = await browser.newContext(),
    investorContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    investor = await investorContext.newPage();
  const origin = "http://127.0.0.1:3111",
    onboarding = "/api/workspaces/alpha/onboarding",
    merchant = "/api/workspaces/alpha/website/integrations/payment";
  try {
    await admin.goto("/ra/alpha/login");
    await admin
      .getByRole("radio", { name: "Organisation", exact: true })
      .check();
    await admin
      .getByLabel("Email address", { exact: true })
      .fill("settings-admin@example.test");
    await admin
      .getByLabel("Password", { exact: true })
      .fill("test-password-123");
    await admin.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(admin).toHaveURL(/\/workspace$/);
    await investor.goto("/ra/stocksbuddha/login");
    await investor
      .getByLabel("Email address", { exact: true })
      .fill("onboarding-other@example.test");
    await investor
      .getByLabel("Password", { exact: true })
      .fill("test-password-123");
    await investor
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(investor).toHaveURL(/\/account$/);
    const enrollment = await investorContext.request.post(
      "/api/workspaces/alpha/membership",
      { headers: { origin, "Idempotency-Key": randomUUID() }, data: {} },
    );
    expect(enrollment.ok(), await enrollment.text()).toBeTruthy();
    const planResponse = await adminContext.request.post(`${onboarding}/plan`, {
      headers: { origin },
      data: {
        version: 0,
        name: "Credential setup test",
        description: "Synthetic research reports",
        price: 100000,
        days: 30,
        taxBps: 0,
        active: true,
      },
    });
    expect(planResponse.ok()).toBeTruthy();
    const plan = await planResponse.json();
    const before = await (await adminContext.request.get(onboarding)).json();
    const terms = await adminContext.request.post(`${onboarding}/settings`, {
      headers: { origin },
      data: {
        version: before.settings?.version ?? 0,
        terms:
          "Synthetic research-service agreement and MITC for credential configuration tests only. ".repeat(
            12,
          ),
        contact: "test@example.test",
        address: "Synthetic research office",
        gstin: "",
        annualLimit: 15100000,
        reviewed: true,
      },
    });
    expect(terms.ok()).toBeTruthy();
    expect(
      (
        await investorContext.request.post(`${onboarding}/skip`, {
          headers: { origin },
          data: { step: "kyc" },
        })
      ).ok(),
    ).toBeTruthy();
    const quoted = await investorContext.request.post(`${onboarding}/quote`, {
      headers: { origin },
      data: { planId: plan.id, key: randomUUID(), code: "" },
    });
    expect(quoted.ok(), await quoted.text()).toBeTruthy();
    const order = await quoted.json();
    const startVersion = (
      await (await adminContext.request.get(merchant)).json()
    ).version;
    await admin.goto("/ra/alpha/workspace/website");
    await admin
      .getByRole("button", { name: "Payment Settings", exact: true })
      .click();
    await expect(admin.getByLabel("Client ID", { exact: true })).toBeEnabled();
    await expect(
      admin.getByLabel("Client secret", { exact: true }),
    ).toBeEnabled();
    await admin
      .getByLabel("Client ID", { exact: true })
      .fill("TEST_quoted_setup");
    await admin
      .getByLabel("Client secret", { exact: true })
      .fill("synthetic-quoted-secret");
    await admin
      .getByLabel("Environment", { exact: true })
      .selectOption("sandbox");
    await admin
      .getByLabel("Enable this payment connection", { exact: true })
      .uncheck();
    await admin
      .getByRole("button", { name: "Save payment settings", exact: true })
      .click();
    await expect(
      admin.getByText("Payment gateway settings saved.", { exact: true }),
    ).toBeVisible();
    expect(
      (await (await adminContext.request.get(merchant)).json()).version,
    ).toBe(startVersion + 1);
    expect(
      (
        await investorContext.request.post(`${onboarding}/skip`, {
          headers: { origin },
          data: { step: "mitc", orderId: order.id },
        })
      ).ok(),
    ).toBeTruthy();
    await admin.reload();
    await admin
      .getByRole("button", { name: "Payment Settings", exact: true })
      .click();
    await expect(admin.getByLabel("Client ID", { exact: true })).toBeEnabled();
    await expect(
      admin.getByLabel("Client secret", { exact: true }),
    ).toBeEnabled();
    await admin
      .getByLabel("Client ID", { exact: true })
      .fill("TEST_signed_setup");
    await admin
      .getByRole("button", { name: "Save payment settings", exact: true })
      .click();
    await expect(
      admin.getByText("Payment gateway settings saved.", { exact: true }),
    ).toBeVisible();
    const saved = await (await adminContext.request.get(merchant)).json();
    expect(saved.clientId).toBe("TEST_signed_setup");
    expect(saved.configured).toBe(true);
    expect(saved.locked).toBe(false);
    expect(saved.version).toBe(startVersion + 2);
    expect(saved.clientSecret).toBeUndefined();
    const investorState = await (
      await investorContext.request.get(onboarding)
    ).json();
    expect(
      investorState.orders.find(
        (entry: { id: string }) => entry.id === order.id,
      ).status,
    ).toBe("signed");
    // Both configured methods stay blocked only for the stale quote, then work after fresh MITC.
    const enableCashfree = await adminContext.request.post(merchant, {
      headers: { origin },
      data: {
        version: saved.version,
        provider: "cashfree",
        enabled: true,
        mode: "sandbox",
        clientId: saved.clientId,
      },
    });
    expect(enableCashfree.ok()).toBeTruthy();
    const qrApi = `${onboarding}/qr-settings`;
    const qr = await (await adminContext.request.get(qrApi)).json();
    expect(
      (
        await adminContext.request.post(qrApi, {
          headers: { origin },
          data: {
            version: qr.version,
            enabled: true,
            payee: "Synthetic RA",
            upiId: "synthetic@bank",
            instructions: "Synthetic only",
            image:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await adminContext.request.post("/__test/expire-checkout", {
          headers: { origin },
          data: { id: order.id },
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await investorContext.request.post(`${onboarding}/qr-start`, {
          headers: { origin },
          data: { orderId: order.id },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await investorContext.request.post(`${onboarding}/payment`, {
          headers: { origin },
          data: { orderId: order.id },
        })
      ).status(),
    ).toBe(409);
    await investor.goto("/ra/alpha/account/onboarding");
    await expect(investor.getByText(/This checkout has expired/)).toBeVisible();
    await expect(
      investor.getByRole("link", { name: "Choose a plan again", exact: true }),
    ).toHaveAttribute("href", "#choose-plan");
    await expect(
      investor.getByRole("button", { name: "Show QR and pay", exact: true }),
    ).toHaveCount(0);
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
        path: `/tmp/sb-checkout-expiry-${width}.png`,
        fullPage: true,
      });
    }
    await investor
      .getByRole("radio", { name: /Credential setup test/ })
      .check();
    await investor
      .getByRole("button", {
        name: "Review final price and agreement",
        exact: true,
      })
      .click();
    await investor
      .getByRole("button", { name: "Skip MITC — DEV only", exact: true })
      .click();
    await expect(
      investor.getByRole("radio", { name: /QR Code/ }),
    ).toBeChecked();
    await expect(
      investor.getByRole("button", { name: "Show QR and pay", exact: true }),
    ).toBeEnabled();
    await investor.getByRole("radio", { name: /Cashfree/ }).check();
    await expect(
      investor.getByRole("button", { name: "Pay with Cashfree", exact: true }),
    ).toBeEnabled();
    const renewed = await (
      await investorContext.request.get(onboarding)
    ).json();
    expect(
      renewed.orders.some((entry: { id: string }) => entry.id === order.id),
    ).toBe(true);
    expect(
      renewed.orders.find((entry: { id: string }) => entry.id !== order.id)
        .status,
    ).toBe("signed");
  } finally {
    await adminContext.close();
    await investorContext.close();
  }
});
