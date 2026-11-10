import { writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const base = "/ra/stocksbuddha";
/** Sign into isolated disposable onboarding fixtures through the real login form. */
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
const pdf = {
  name: "test-pan.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\nFixture evidence\n%%EOF"),
};

test("RA creates plan and discount; investor completes KYC, admin approves; signed checkout freezes discount before payment and emails canonical documents", async ({
  browser,
  request,
}) => {
  test.setTimeout(60000);
  const adminContext = await browser.newContext(),
    investorContext = await browser.newContext(),
    otherContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    investor = await investorContext.newPage(),
    other = await otherContext.newPage();
  const browserErrors: string[] = [];
  for (const page of [admin, investor])
    page.on("pageerror", (error) => browserErrors.push(error.message));
  try {
    await login(admin, "onboarding-admin@example.test", true);
    await admin.goto(`${base}/workspace/website`);
    await admin
      .getByRole("button", { name: "SMS Settings", exact: true })
      .click();
    await admin.getByLabel("Vendor username", { exact: true }).fill("test-ra");
    await admin
      .getByLabel("API key (leave blank to retain saved key)", { exact: true })
      .fill("fake-test-api-key");
    await admin.getByLabel("Approved sender ID").fill("HORIZN");
    await admin
      .getByLabel("DLT entity ID", { exact: true })
      .fill("110100000000001");
    await admin
      .getByLabel("DLT template ID", { exact: true })
      .fill("110100000000002");
    await admin
      .getByLabel("Approved message", { exact: true })
      .fill(
        "Your mobile code is {{otp}}. Valid for {{expiryMinutes}} minutes.",
      );
    await admin.getByLabel("Enable SMS verification", { exact: true }).check();
    await admin
      .getByRole("button", { name: "Save SMS settings", exact: true })
      .click();
    await expect(
      admin.getByText("SMS settings saved.", { exact: true }),
    ).toBeVisible();
    await admin.goto(`${base}/workspace/plans`);
    await admin
      .getByLabel("Plan name", { exact: true })
      .fill("Monthly research");
    await admin
      .getByLabel("Services and offerings")
      .fill("Monthly research reports and market updates. No assured returns.");
    await admin.getByLabel("Base fee (INR)", { exact: true }).fill("2000");
    await admin.getByRole("button", { name: "Save plan", exact: true }).click();
    await expect(
      admin.locator("strong").filter({ hasText: /^Monthly research$/ }),
    ).toBeVisible();
    await admin.getByLabel("Discount code", { exact: true }).fill("WELCOME");
    await admin.getByLabel("Discount value", { exact: true }).fill("10");
    await admin.getByLabel("Starts (UTC date)").fill("2026-01-01");
    await admin.getByLabel("Ends (UTC date)").fill("2027-12-31");
    const couponCodeInput = admin.getByLabel("Discount code", { exact: true });
    await couponCodeInput.fill("Diwali Offer");
    expect(
      await couponCodeInput.evaluate(
        (input: HTMLInputElement) => input.validity.patternMismatch,
      ),
    ).toBeTruthy();
    await couponCodeInput.fill("WELCOME");
    expect(
      await couponCodeInput.evaluate((input: HTMLInputElement) =>
        input.checkValidity(),
      ),
    ).toBeTruthy();
    await admin
      .getByRole("button", { name: "Save discount", exact: true })
      .click();
    await expect(admin.getByText("WELCOME", { exact: true })).toBeVisible();
    const starterTerms = admin.getByLabel("Approved terms and MITC", {
      exact: true,
    });
    await expect(starterTerms).toHaveValue(/{{clientName}}/);
    await expect(
      admin.getByLabel(
        "These research-service terms and MITC have been reviewed and approved.",
      ),
    ).not.toBeChecked();
    await admin.getByRole("button", { name: "Load sample agreement" }).click();
    await expect(starterTerms).toHaveValue(/STARTER DRAFT/);
    const terms =
      "Research services only. No trade execution or assured returns. Market risks apply. Contact the RA for complaints, then SCORES and ODR. Fees and refunds follow applicable SEBI rules. Never share trading or bank passwords or OTPs. ".repeat(
        4,
      );
    await admin
      .getByLabel("Approved terms and MITC", { exact: true })
      .fill(terms);
    await admin
      .getByLabel("Contact details", { exact: true })
      .fill("RA Support: ra@example.test");
    await admin
      .getByLabel("RA address", { exact: true })
      .fill("Example RA office, Mumbai, India");
    await admin
      .getByLabel(
        "These research-service terms and MITC have been reviewed and approved.",
      )
      .check();
    await admin.getByRole("button", { name: "Save agreement details" }).click();
    await expect(admin.getByRole("status")).toContainText("Changes saved");
    await admin.screenshot({
      path: "/tmp/stocksbuddha-onboarding-plans-desktop.png",
      fullPage: true,
    });

    await admin.setViewportSize({ width: 768, height: 1024 });
    await admin.screenshot({
      path: "/tmp/stocksbuddha-onboarding-plans-tablet.png",
      fullPage: true,
    });
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.screenshot({
      path: "/tmp/stocksbuddha-onboarding-plans-mobile.png",
      fullPage: true,
    });
    expect(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(
      (await new AxeBuilder({ page: admin }).analyze()).violations,
    ).toEqual([]);
    await admin.setViewportSize({ width: 1280, height: 720 });
    await login(investor, "onboarding-investor@example.test");
    await expect(
      investor.getByRole("heading", { name: "Your investor journey" }),
    ).toBeVisible();
    await investor
      .getByRole("link", { name: "Continue onboarding", exact: true })
      .click();
    await expect(
      investor.getByLabel("Full name as on PAN", { exact: true }),
    ).toBeDisabled();
    await investor
      .getByLabel("Mobile number", { exact: true })
      .fill("9599400141");
    await investor
      .getByRole("button", { name: "Send mobile code", exact: true })
      .click();
    await expect(investor.getByLabel("Six-digit mobile code")).toBeVisible();
    const sms = await (await request.get("/__test/sms")).json();
    await investor
      .getByLabel("Six-digit mobile code")
      .fill(sms.at(-1).message.match(/\b\d{6}\b/)[0]);
    await investor
      .getByRole("button", { name: "Verify mobile", exact: true })
      .click();
    await expect(
      investor.getByLabel("Full name as on PAN", { exact: true }),
    ).toBeEnabled();
    await expect(
      investor.getByRole("button", { name: "Send mobile code", exact: true }),
    ).toHaveCount(0);
    await investor.reload();
    await expect(
      investor.getByRole("heading", { name: "Mobile verified", exact: true }),
    ).toBeVisible();
    await expect(
      investor.getByRole("button", { name: "Send mobile code", exact: true }),
    ).toHaveCount(0);
    await expect(
      investor.getByRole("button", {
        name: "Change mobile number",
        exact: true,
      }),
    ).toBeVisible();
    for (const [name, width] of [
      ["desktop", 1280],
      ["mobile", 390],
    ] as const) {
      await investor.setViewportSize({ width, height: 900 });
      expect(
        (await new AxeBuilder({ page: investor }).analyze()).violations,
      ).toEqual([]);
      await investor.screenshot({
        path: `/tmp/sb-verified-mobile-${name}.png`,
        fullPage: true,
      });
    }
    await investor.setViewportSize({ width: 1280, height: 720 });
    await investor
      .getByLabel("Current password", { exact: true })
      .fill("test-password-123");
    await investor
      .getByRole("button", { name: "Enable SMS recovery", exact: true })
      .click();
    await expect(
      investor.getByRole("button", {
        name: "Disable SMS recovery",
        exact: true,
      }),
    ).toBeVisible();
    await investor
      .getByLabel("Full name as on PAN", { exact: true })
      .fill("Example Investor");
    await expect(
      investor.getByLabel("Phone number", { exact: true }),
    ).toHaveValue("+919599400141");
    await investor.getByLabel("PAN number", { exact: true }).fill("ABCPD1234E");
    await investor
      .getByLabel("Date of birth", { exact: true })
      .fill("1990-01-01");
    await investor
      .getByLabel("PAN document (PDF, JPEG, PNG; maximum 10 MiB)")
      .setInputFiles(pdf);
    await expect(
      investor.locator(".onboarding > .workspace-notice[role='status']"),
    ).toHaveText("PAN document uploaded.");
    await investor
      .getByLabel(
        "I confirm these identity and family details are correct and consent to their use for KYC verification.",
      )
      .check();
    await investor
      .getByRole("button", { name: "Submit for verification", exact: true })
      .click();
    await expect(
      investor.getByText("Under review", { exact: true }),
    ).toBeVisible();
    await expect(
      investor.getByRole("heading", { name: "Choose your plan" }),
    ).toHaveCount(0);

    await admin.getByRole("link", { name: "Users", exact: true }).click();
    const row = admin
      .getByRole("row")
      .filter({ hasText: "onboarding-investor@example.test" });
    await row.getByRole("link", { name: "Edit user" }).click();
    await admin
      .getByRole("combobox", { name: "Decision", exact: true })
      .selectOption("changes");
    await admin
      .getByLabel("Reason / message to investor")
      .fill("Please confirm your legal name is correct.");
    await admin.getByRole("button", { name: "Save review decision" }).click();
    await expect(
      admin.getByText("Changes requested", { exact: true }),
    ).toBeVisible();
    await investor
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await expect(
      investor.getByText("Please confirm your legal name is correct.", {
        exact: true,
      }),
    ).toBeVisible();
    await investor
      .getByRole("button", { name: "Submit for verification", exact: true })
      .click();
    await expect(
      investor.getByText("Under review", { exact: true }),
    ).toBeVisible();
    await admin
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await admin
      .getByRole("combobox", { name: "Decision", exact: true })
      .selectOption("verified");
    await admin
      .getByRole("combobox", { name: "KFIN result", exact: true })
      .selectOption("KYC VALIDATED");
    await admin
      .getByLabel("Verification reference", { exact: true })
      .fill("KFIN-FIXTURE-001");
    await expect(
      admin.getByRole("link", { name: "Open KFIN KRA" }),
    ).toHaveClass(/button secondary/);
    const proofInput = admin.getByLabel("Separate KFIN verification evidence", {
      exact: true,
    });
    await expect(proofInput).toHaveAttribute("required", "");
    await admin.getByRole("button", { name: "Save review decision" }).click();
    expect(
      await proofInput.evaluate(
        (input: HTMLInputElement) => input.validity.valueMissing,
      ),
    ).toBeTruthy();
    await expect(
      admin.getByText("Under review", { exact: true }),
    ).toBeVisible();
    await admin
      .getByLabel("Separate KFIN verification evidence", { exact: true })
      .setInputFiles({ ...pdf, name: "kfin-result.pdf" });
    await expect(admin.getByRole("status")).toHaveText(
      "Verification evidence uploaded.",
    );
    await admin.getByRole("button", { name: "Save review decision" }).click();
    await expect(admin.getByText("Verified", { exact: true })).toBeVisible();
    await investor
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await investor.getByRole("radio").check();
    await investor.getByLabel("Discount code (optional)").fill("WELCOME");
    await investor
      .getByRole("button", { name: "Review final price and agreement" })
      .click();
    await expect(
      investor.getByText("₹1,800.00", { exact: true }),
    ).toBeVisible();
    await expect(
      investor.getByRole("button", { name: "Pay with Cashfree" }),
    ).toHaveCount(0);
    const state = await investor.evaluate(async () =>
      (await fetch("/api/workspaces/stocksbuddha/onboarding")).json(),
    );
    const orderId = state.orders[0].id;
    const agreementFrame = investor.getByRole("region", {
      name: "Agreement and MITC pages",
      exact: true,
    });
    await expect(agreementFrame).toBeVisible();
    await expect(
      agreementFrame.locator('canvas[data-rendered="true"]'),
    ).toBeVisible();
    const agreementResponse = await investor.request.get(
      `/api/workspaces/stocksbuddha/onboarding/agreement/${orderId}`,
    );
    expect(agreementResponse.status()).toBe(200);
    expect(agreementResponse.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'self'",
    );
    expect((await agreementResponse.body()).subarray(0, 5).toString()).toBe(
      "%PDF-",
    );
    for (const width of [1280, 390]) {
      await investor.setViewportSize({ width, height: 900 });
      expect(
        await investor.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await agreementFrame.scrollIntoViewIfNeeded();
      await expect(
        agreementFrame.locator('canvas[data-rendered="true"]'),
      ).toBeVisible();
      await investor.screenshot({
        path: `/tmp/stocksbuddha-investor-letterhead-preview-${width}.png`,
      });
    }
    const forged = await investor.evaluate(
      async (id) =>
        (
          await fetch("/api/workspaces/stocksbuddha/onboarding/payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: id }),
          })
        ).status,
      orderId,
    );
    expect(forged).toBe(409);

    await investor
      .getByLabel(
        "I have read and agree to the service terms, MITC and final payable amount.",
      )
      .check();
    await investor
      .getByLabel("Full name for signature", { exact: true })
      .fill("Example Investor");
    await investor
      .getByLabel("Signature method", { exact: true })
      .selectOption("upload");
    const signaturePng = await investor.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 120;
      const context = canvas.getContext("2d")!;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(15, 85);
      context.bezierCurveTo(90, 0, 130, 110, 350, 20);
      context.stroke();
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await investor
      .getByLabel("Signature image", { exact: true })
      .setInputFiles({
        name: "investor-signature.png",
        mimeType: "image/png",
        buffer: Buffer.from(signaturePng, "base64"),
      });
    await expect(investor.locator(".signature-selection img")).toBeVisible();
    await investor
      .getByLabel("Signature method", { exact: true })
      .selectOption("draw");
    const pad = investor.getByLabel("Draw your signature here", {
      exact: true,
    });
    await pad.scrollIntoViewIfNeeded();
    const box = (await pad.boundingBox())!;
    await investor.mouse.move(box.x + 20, box.y + 30);
    await investor.mouse.down();
    await investor.mouse.move(box.x + box.width / 2, box.y + 70, { steps: 8 });
    await investor.mouse.move(box.x + box.width - 20, box.y + 20, { steps: 8 });
    await investor.mouse.up();
    await expect(investor.locator(".signature-selection img")).toBeVisible();
    await investor
      .getByRole("button", { name: "Clear drawing", exact: true })
      .click();
    await expect(
      investor.getByRole("button", { name: "Sign and continue", exact: true }),
    ).toBeDisabled();
    const touch = await investorContext.newCDPSession(investor);
    await touch.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await pad.scrollIntoViewIfNeeded();
    const touchBox = (await pad.boundingBox())!;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: touchBox.x + 20, y: touchBox.y + 30 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: touchBox.x + touchBox.width / 2, y: touchBox.y + 70 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: touchBox.x + touchBox.width - 20, y: touchBox.y + 20 },
      ],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(investor.locator(".signature-selection img")).toBeVisible();
    await investor.screenshot({
      path: "/tmp/stocksbuddha-touch-signature.png",
    });
    await touch.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await touch.detach();
    await investor
      .getByLabel("Signature method", { exact: true })
      .selectOption("typed");
    for (const font of ["formal", "allura", "caveat"])
      await investor
        .getByLabel("Signature font", { exact: true })
        .selectOption(font);
    await investor.evaluate(() => document.fonts.ready);
    for (const width of [390, 1280]) {
      await investor.setViewportSize({ width, height: 900 });
      await investor.locator(".signature-input").scrollIntoViewIfNeeded();
      expect(
        await investor.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await investor.screenshot({
        path: `/tmp/stocksbuddha-signature-controls-${width}.png`,
      });
    }
    await investor
      .getByRole("button", { name: "Send email confirmation code" })
      .click();
    await expect(
      investor.locator(".onboarding > .workspace-notice[role='status']"),
    ).toHaveText("A confirmation code was sent to your verified email.");
    const messages = await (await request.get("/__test/mail")).json();
    const code = messages.findLast(
      (entry: { to: string; kind: string }) =>
        entry.to === "onboarding-investor@example.test" &&
        entry.kind === "signing",
    ).code;
    await investor
      .getByLabel("Email confirmation code", { exact: true })
      .fill(code);
    await investor
      .getByRole("button", { name: "Sign and continue", exact: true })
      .click();
    await expect(
      investor.getByRole("link", { name: "Download signed agreement" }),
    ).toBeVisible();
    await investor.screenshot({
      path: "/tmp/stocksbuddha-onboarding-signed-desktop.png",
      fullPage: true,
    });
    const downloadable = investor.getByRole("link", {
      name: "Download signed agreement",
    });
    const link = await downloadable.getAttribute("href");
    const archived = await investorContext.request.get(link!);
    expect(archived.ok()).toBeTruthy();
    await writeFile(
      "/tmp/stocksbuddha-signed-visual-signature.pdf",
      await archived.body(),
    );
    await investor
      .getByText("Read agreement and MITC", { exact: true })
      .click();
    await expect(
      investor
        .getByRole("region", { name: "Agreement and MITC pages" })
        .locator('canvas[data-rendered="true"]'),
    ).toBeVisible();
    const originalBytes = await archived.body();
    expect(originalBytes.subarray(0, 5).toString()).toBe("%PDF-");
    await login(other, "onboarding-other@example.test");
    expect((await otherContext.request.get(link!)).status()).toBe(404);
    expect(
      (
        await otherContext.request.get(
          `/api/workspaces/stocksbuddha/onboarding?customer=${state.customer.id}`,
        )
      ).status(),
    ).toBe(403);
    await investor.evaluate(() => {
      (window as typeof window & { Cashfree: unknown }).Cashfree = () => ({
        checkout: async ({
          paymentSessionId,
        }: {
          paymentSessionId: string;
        }) => {
          await fetch("/__test/settle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: paymentSessionId.slice("fixture-".length),
            }),
          });
        },
      });
    });
    await investor
      .getByRole("button", { name: "Pay with Cashfree", exact: true })
      .click();
    await expect(
      investor.getByText("Confirmed", { exact: true }),
    ).toBeVisible();
    await expect(
      investor.getByRole("link", { name: "Download invoice" }),
    ).toBeVisible();
    const sent = await (await request.get("/__test/mail")).json();
    const receipt = sent.findLast(
      (entry: { to: string; kind: string }) =>
        entry.to === "onboarding-investor@example.test" &&
        entry.kind === "receipt",
    );
    expect(receipt.attachments).toHaveLength(2);
    expect(Buffer.from(receipt.attachments[0].content.data)).toEqual(
      originalBytes,
    );
    await admin.goto("/ra/stocksbuddha/workspace/users");
    const jobs = admin.getByRole("region", {
      name: "Payments and document delivery",
    });
    await expect(jobs.getByText(/paid \/ sent/)).toBeVisible();
    await expect(
      jobs.getByRole("button", { name: "Retry", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await investorContext.request.get(
          "/api/workspaces/stocksbuddha/onboarding/jobs",
        )
      ).status(),
    ).toBe(403);
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.screenshot({
      path: "/tmp/stocksbuddha-delivery-status-mobile.png",
      fullPage: true,
    });
    expect(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(
      (await new AxeBuilder({ page: admin }).analyze()).violations,
    ).toEqual([]);
    await investor.setViewportSize({ width: 390, height: 844 });
    await investor.screenshot({
      path: "/tmp/stocksbuddha-onboarding-investor-mobile.png",
      fullPage: true,
    });
    expect(
      await investor.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(
      (await new AxeBuilder({ page: investor }).analyze()).violations,
    ).toEqual([]);
    await investor.goto(`${base}/forgot-password`);
    await investor.getByText("Reset password by SMS", { exact: true }).click();
    const recovery = investor
      .locator("details")
      .filter({ hasText: "Reset password by SMS" });
    await recovery
      .getByLabel("Email", { exact: true })
      .fill("onboarding-investor@example.test");
    await recovery
      .getByRole("button", { name: "Request recovery code", exact: true })
      .click();
    await expect(recovery.getByLabel("SMS code", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    const recoveryMessages = await (await request.get("/__test/sms")).json();
    await recovery
      .getByLabel("SMS code", { exact: true })
      .fill(recoveryMessages.at(-1).message.match(/\b\d{6}\b/)[0]);
    await recovery
      .getByLabel("New password", { exact: true })
      .fill("new-investor-password-123");
    await recovery
      .getByLabel("Confirm new password", { exact: true })
      .fill("new-investor-password-123");
    await recovery
      .getByRole("button", { name: "Reset password with code", exact: true })
      .click();
    await expect(
      recovery.getByText("Password changed. Sign in with your new password.", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await investorContext.request.get("/api/session")).status()).toBe(
      401,
    );
    await investor.goto(`${base}/login`);
    await investor
      .getByLabel("Email address", { exact: true })
      .fill("onboarding-investor@example.test");
    await investor
      .getByLabel("Password", { exact: true })
      .fill("new-investor-password-123");
    await investor
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(investor).toHaveURL(/\/account$/);
    expect(browserErrors).toEqual([]);
  } finally {
    await Promise.all([
      adminContext.close(),
      investorContext.close(),
      otherContext.close(),
    ]);
  }
});
