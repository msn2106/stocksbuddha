import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
const base = "/ra/stocksbuddha",
  api = "/api/workspaces/stocksbuddha/onboarding",
  origin = "http://127.0.0.1:3111";
// Non-payable raster test pattern: exercises QR preview without encoding a payment destination.
const qr = {
  name: "synthetic-qr.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAJQAAACUCAAAAABQV18IAAABlklEQVR42u3bwY6DMAyEYd7/pbuXPa3weAbRVeL8HClNv0rGiU24PgseFyhQoECBAgUK1MaoSxzqmvIHfj9zxgU1F9UNXl2nrunGBTUf9TcQqx9S5+9Q1bigQHUBDgpUglKTczIxgzoL1QXz3cJQjfMvqwRQy6LUAl8FqvvZ69UMqKVRVgPCSJhOQn216wJqaZSzuKsaFwquEjCouSiVMCtcl2yrCbi8SUCNQ6lC4Q6p/oQ7JqgzUE4x4Db9kwIW1CxU+vDInbSdohbUbFSXHJ0GbHLTgJqNchrzXRB3N0ScPEFtjUqCXi38ukaHXTiA2hqlik2nua823IA6G+U0+J0HQMm1oOaikuZ918ToNlA8fooFajtUV0y6DX/1B+LmPqgtUe7gKpC7YI434IDaHpUWEklytDYeghqFSl+8UM17t8kLaj6qC265QDOb/1/ZfApqaZS7ecaZiNOXy0Cdi0qSpHse1Jko9ZDIbaC9Huiglkcl56PmxZPNEqC2RzmFgxPcT74Pah5qhQMUKFCgQIECBWoj1A+kBQg2okYafwAAAABJRU5ErkJggg==",
    "base64",
  ),
};
const proof = {
  name: "synthetic-payment.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\nSynthetic payment claim\n%%EOF"),
};
/** Sign in through real authentication against a fresh disposable MariaDB schema. */
async function login(page: Page, email: string, admin = false) {
  await page.goto(`${base}/login`);
  if (admin)
    await page
      .getByRole("radio", { name: "Organisation", exact: true })
      .check();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(admin ? "/workspace$" : "/account$"));
}
/** Setup requests use the same authenticated, Origin-protected business APIs as the browser. */
async function post(request: APIRequestContext, action: string, data: unknown) {
  const response = await request.post(`${api}/${action}`, {
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
/** Capture responsive screenshots and verify layout, keyboard focus and automated accessibility. */
async function inspect(page: Page, name: string) {
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/sb-${name}-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("QR settings and investor claims retain snapshots, reject safely and activate only after bank-checked RA approval", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const adminContext = await browser.newContext(),
    investorContext = await browser.newContext(),
    otherContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    investor = await investorContext.newPage(),
    other = await otherContext.newPage();
  const errors: string[] = [];
  for (const page of [admin, investor])
    page.on("pageerror", (error) => errors.push(error.message));
  try {
    await login(admin, "onboarding-admin@example.test", true);
    await admin.goto(`${base}/workspace/website`);
    await admin
      .getByRole("button", { name: "Payment Settings", exact: true })
      .click();
    await admin
      .getByLabel("Payee name", { exact: true })
      .fill("Synthetic Research RA");
    await admin.getByLabel("UPI ID", { exact: true }).fill("synthetic@bank");
    await admin
      .getByLabel("Payment instructions", { exact: true })
      .fill("Synthetic test only. Do not transfer money.");
    await admin.getByLabel(/Upload QR code/).setInputFiles(qr);
    await admin.getByLabel("Enable QR payments", { exact: true }).check();
    await admin
      .getByRole("button", { name: "Save QR settings", exact: true })
      .click();
    await expect(
      admin.getByText("QR payment settings saved.", { exact: true }),
    ).toBeVisible();
    await inspect(admin, "qr-settings");
    const concurrentSettings = await Promise.all([
      adminContext.request.get(`${api}/qr-settings`),
      adminContext.request.get(
        "/api/workspaces/stocksbuddha/website/integrations/payment",
      ),
      adminContext.request.get(api),
    ]);
    for (const response of concurrentSettings)
      expect(response.status()).toBe(200);
    const qrVersion = await (
      await adminContext.request.get(`${api}/qr-settings`)
    ).json();
    const racingSaves = await Promise.all([
      adminContext.request.post(`${api}/qr-settings`, {
        headers: { origin },
        data: qrVersion,
      }),
      adminContext.request.post(`${api}/qr-settings`, {
        headers: { origin },
        data: qrVersion,
      }),
    ]);
    expect(racingSaves.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    const plan = await post(adminContext.request, "plan", {
      version: 0,
      name: "QR research plan",
      description: "Synthetic research reports",
      days: 30,
      price: 123400,
      taxBps: 0,
      active: true,
    });
    const currentSettings = await (await adminContext.request.get(api)).json();
    await post(adminContext.request, "settings", {
      version: currentSettings.settings?.version ?? 0,
      terms:
        "Synthetic research service terms and MITC for browser verification only. ".repeat(
          15,
        ),
      contact: "test@example.test",
      address: "Synthetic office address",
      gstin: "",
      annualLimit: 15100000,
      reviewed: true,
    });
    await login(investor, "qr-investor@example.test");
    await investor.goto(`${base}/account/onboarding`);
    await investor
      .getByRole("button", { name: "Skip KYC — DEV only", exact: true })
      .click();
    await expect(
      investor.getByText("QR research plan", { exact: true }),
    ).toBeVisible();
    let id = (
      await post(investorContext.request, "quote", {
        planId: plan.id,
        key: randomUUID(),
        code: "",
      })
    ).id;
    expect(
      (
        await investorContext.request.post(`${api}/qr-start`, {
          data: { orderId: id },
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
    await post(investorContext.request, "skip", { step: "mitc", orderId: id });
    await investor.reload();
    await expect(
      investor.getByRole("radio", { name: /QR Code/ }),
    ).toBeChecked();
    await expect(
      investor.getByRole("radio", { name: /Cashfree/ }),
    ).toBeEnabled();
    await investor.getByRole("radio", { name: /Cashfree/ }).focus();
    await investor.keyboard.press("ArrowLeft");
    await expect(
      investor.getByRole("radio", { name: /QR Code/ }),
    ).toBeChecked();
    await investor
      .getByRole("button", { name: "Show QR and pay", exact: true })
      .click();
    await expect(
      investor.getByText("Synthetic Research RA", { exact: true }),
    ).toBeVisible();
    await expect(
      investor.getByRole("button", { name: "Pay with Cashfree", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await investorContext.request.post(`${api}/payment`, {
          data: { orderId: id },
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
    await inspect(investor, "qr-instructions");
    // Replacement changes future attempts, preserving the payee already shown to this investor.
    const savedQr = await (
      await adminContext.request.get(`${api}/qr-settings`)
    ).json();
    await post(adminContext.request, "qr-settings", {
      ...savedQr,
      payee: "Replacement Synthetic RA",
    });
    await investor.reload();
    await expect(
      investor.getByText("Synthetic Research RA", { exact: true }),
    ).toBeVisible();
    await investor
      .getByLabel("UTR / transaction reference")
      .fill("QRTEST123456");
    const local = new Date();
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    await investor
      .getByLabel("Payment date and time")
      .fill(local.toISOString().slice(0, 16));
    await investor.getByLabel(/Payment proof/).setInputFiles(proof);
    await investor
      .getByRole("button", { name: "Submit payment proof", exact: true })
      .click();
    await expect(
      investor.getByText("Awaiting payment verification", { exact: true }),
    ).toBeVisible();
    await inspect(investor, "qr-submitted");
    await login(other, "onboarding-other@example.test");
    expect(
      (await otherContext.request.get(`${api}/qr-payment/${id}`)).status(),
    ).toBe(404);
    expect(
      (
        await otherContext.request.get(`${api}/qr-payment/${id}/proof`)
      ).status(),
    ).toBe(404);
    await admin.goto(`${base}/workspace/users`);
    const queue = admin.getByRole("region", {
      name: "QR payment reviews",
      exact: true,
    });
    await queue
      .getByRole("button", { name: "Review payment", exact: true })
      .click();
    await expect(queue.getByText(/QRTEST123456/)).toBeVisible();
    const download = await adminContext.request.get(
      `${api}/qr-payment/${id}/proof`,
    );
    expect(download.headers()["content-disposition"]).toContain("attachment");
    expect(await download.body()).toEqual(proof.buffer);
    await queue
      .getByLabel("Review reason / bank verification note")
      .fill("No funds received; claim rejected after bank check.");
    await queue.getByLabel(/I checked the receiving bank/).check();
    await inspect(admin, "qr-review");
    await queue
      .getByRole("button", { name: "Reject / close claim", exact: true })
      .click();
    await expect(
      queue.getByText("No QR payments awaiting review.", { exact: true }),
    ).toBeVisible();
    await investor.reload();
    await expect(
      investor.getByText("Payment claim closed", { exact: true }),
    ).toBeVisible();
    await expect(
      investor.getByText(/No funds received; claim rejected/),
    ).toBeVisible();
    id = (
      await post(investorContext.request, "quote", {
        planId: plan.id,
        key: randomUUID(),
        code: "",
      })
    ).id;
    await post(investorContext.request, "skip", { step: "mitc", orderId: id });
    await investor.reload();
    await investor
      .getByRole("button", { name: "Show QR and pay", exact: true })
      .click();
    await expect(
      investor.getByText("Replacement Synthetic RA", { exact: true }),
    ).toBeVisible();
    await investor
      .getByLabel("UTR / transaction reference")
      .fill("QRTEST123456");
    await investor
      .getByLabel("Payment date and time")
      .fill(local.toISOString().slice(0, 16));
    await investor.getByLabel(/Payment proof/).setInputFiles(proof);
    await investor
      .getByRole("button", { name: "Submit payment proof", exact: true })
      .click();
    await expect(investor.getByRole("alert")).toContainText(
      "already submitted",
    );
    await investor
      .getByLabel("UTR / transaction reference")
      .fill("QRTEST654321");
    await investor
      .getByRole("button", { name: "Submit payment proof", exact: true })
      .click();
    await expect(
      investor.getByText("Awaiting payment verification", { exact: true }),
    ).toBeVisible();
    await admin.reload();
    await queue
      .getByRole("button", { name: "Review payment", exact: true })
      .click();
    await queue
      .getByLabel("Review reason / bank verification note")
      .fill("Synthetic exact amount confirmed in receiving account.");
    await queue.getByLabel(/I checked the receiving bank/).check();
    await queue
      .getByRole("button", { name: "Approve received payment", exact: true })
      .click();
    await expect(
      queue.getByText("No QR payments awaiting review.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await adminContext.request.post(`${api}/qr-review`, {
          headers: { origin },
          data: {
            orderId: id,
            version: 2,
            approve: true,
            fundsChecked: true,
            reason: "Duplicate approval must fail",
          },
        })
      ).status(),
    ).toBe(409);
    await adminContext.request.post("/__test/deliver", { headers: { origin } });
    await investor.reload();
    await expect(
      investor.getByText("Confirmed", { exact: true }),
    ).toBeVisible();
    await expect(
      investor.getByRole("link", { name: "Download invoice", exact: true }),
    ).toBeVisible();
    const state = await (await investorContext.request.get(api)).json();
    expect(
      state.orders.find((order: { id: string }) => order.id === id)
        .paymentMethod,
    ).toBe("qr");
    const messages = await (
      await adminContext.request.get("/__test/mail")
    ).json();
    expect(
      messages.filter(
        (message: { kind: string; to: string }) =>
          message.kind === "receipt" &&
          message.to === "qr-investor@example.test",
      ),
    ).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([
      adminContext.close(),
      investorContext.close(),
      otherContext.close(),
    ]);
  }
});

test("investors cannot read QR settings, review queues or submit administrator decisions", async ({
  page,
}) => {
  await login(page, "onboarding-other@example.test");
  // Exercise overlapping lock paths within the intentionally bounded auth pool.
  for (let iteration = 0; iteration < 3; iteration++) {
    const concurrent = await Promise.all([
      page.request.get(api),
      page.request.get("/api/sms/stocksbuddha/mobile"),
    ]);
    for (const response of concurrent) expect(response.status()).toBe(200);
  }
  expect((await page.request.get(`${api}/qr-settings`)).status()).toBe(403);
  expect((await page.request.get(`${api}/qr-payments`)).status()).toBe(403);
  expect(
    (
      await page.request.post(`${api}/qr-review`, {
        headers: { origin },
        data: {
          orderId: randomUUID(),
          version: 1,
          approve: true,
          fundsChecked: true,
          reason: "Forbidden investor approval",
        },
      })
    ).status(),
  ).toBe(403);
});
