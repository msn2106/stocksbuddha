import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function signIn(
  page: Page,
  path: string,
  email: string,
  organisation = false,
) {
  await page.goto(path);
  if (organisation)
    await page
      .getByRole("radio", { name: "Organisation", exact: true })
      .check();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("owner creates an organisation and admin invitation; admin accepts and invites an analyst; each sees the blank protected shell", async ({
  browser,
  request,
}) => {
  const ownerContext = await browser.newContext(),
    adminContext = await browser.newContext(),
    analystContext = await browser.newContext();
  const owner = await ownerContext.newPage(),
    admin = await adminContext.newPage(),
    analyst = await analystContext.newPage();
  const errors: string[] = [];
  for (const page of [owner, admin, analyst])
    page.on("pageerror", (error) => errors.push(error.message));
  await signIn(owner, "/workspace/login", "owner@example.test");
  await expect(owner).toHaveURL(/\/workspace$/);
  await expect(
    owner.getByRole("navigation", { name: "Workspace navigation" }),
  ).toBeVisible();
  await owner.screenshot({
    path: "/tmp/stocksbuddha-platform-workspace.png",
    fullPage: true,
  });
  await owner.getByRole("link", { name: "Organisations", exact: true }).click();
  const create = owner
    .getByRole("heading", { name: "Create organisation", exact: true })
    .locator("..");
  await create
    .getByLabel("Organisation name", { exact: true })
    .fill("New RA Research");
  await create.getByLabel("Legal name", { exact: true }).fill("New RA Legal");
  await create.getByLabel("Website address slug").fill("new-ra");
  await create.getByLabel("Brand initials").fill("nr");
  await create.getByLabel("RA Admin email").fill("admin@example.test");
  await create.getByRole("button", { name: "Create and invite admin" }).click();
  await expect(owner.getByRole("status")).toHaveText("Invitation sent.");
  const emails = await (await request.get("/__test/mail")).json();
  const adminInvite = emails.findLast(
    (email: { to: string; kind: string }) =>
      email.to === "admin@example.test" && email.kind === "invite",
  );
  expect(adminInvite).toBeTruthy();
  await admin.goto(adminInvite.url);
  await expect(admin).toHaveURL(/\/ra\/new-ra\/invitation$/);
  await admin.getByRole("link", { name: "Sign in", exact: true }).click();
  await admin
    .getByLabel("Email address", { exact: true })
    .fill("admin@example.test");
  await admin.getByLabel("Password", { exact: true }).fill("test-password-123");
  await admin.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(admin).toHaveURL(/\/invitation$/);
  await admin.getByRole("button", { name: "Accept invitation" }).click();
  await expect(admin).toHaveURL(/\/ra\/new-ra\/workspace$/);
  await admin.getByRole("button", { name: /^Profile/ }).click();
  await expect(
    admin.getByRole("dialog", { name: "Your profile" }),
  ).toContainText("RA Admin");
  await expect(admin.getByRole("dialog")).toContainText("admin@example.test");
  await admin.keyboard.press("Escape");
  await admin.getByRole("link", { name: "Team", exact: true }).click();
  await admin
    .getByLabel("Email address", { exact: true })
    .fill("analyst@example.test");
  await admin.getByLabel("Your role").selectOption("analyst");
  await admin.getByRole("button", { name: "Send invitation" }).click();
  await expect(admin.getByRole("status")).toHaveText("Invitation sent.");
  const latest = await (await request.get("/__test/mail")).json();
  const staffInvite = latest.findLast(
    (email: { to: string; kind: string }) =>
      email.to === "analyst@example.test" && email.kind === "invite",
  );
  await analyst.goto(staffInvite.url);
  await analyst.getByRole("link", { name: "Sign in", exact: true }).click();
  await analyst
    .getByLabel("Email address", { exact: true })
    .fill("analyst@example.test");
  await analyst
    .getByLabel("Password", { exact: true })
    .fill("test-password-123");
  await analyst.getByRole("button", { name: "Sign in", exact: true }).click();
  await analyst.getByRole("button", { name: "Accept invitation" }).click();
  await expect(analyst).toHaveURL(/\/workspace$/);
  await expect(
    analyst.getByRole("link", { name: "Team", exact: true }),
  ).toHaveCount(0);
  expect(
    (await analystContext.request.get("/ra/new-ra/workspace/team")).status(),
  ).toBe(403);
  expect(
    (
      await analystContext.request.post("/ra/new-ra/workspace/team", {
        headers: { origin: "http://127.0.0.1:3111" },
        form: { email: "investor@example.test", role: "owner" },
      })
    ).status(),
  ).toBe(403);
  for (const width of [1440, 768, 390]) {
    await analyst.setViewportSize({ width, height: 900 });
    await analyst.goto("/ra/new-ra/workspace");
    if (width === 390) {
      await analyst
        .getByRole("button", { name: "Workspace navigation" })
        .click();
      await expect(analyst.getByRole("navigation")).toBeVisible();
      await analyst
        .getByRole("button", { name: "Workspace navigation" })
        .click();
    }
    expect(
      await analyst.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page: analyst }).analyze()).violations,
    ).toEqual([]);
    await analyst.screenshot({
      path: `/tmp/stocksbuddha-organisation-${width}.png`,
      fullPage: true,
    });
  }
  await analyst.getByRole("button", { name: /^Profile/ }).click();
  await analyst.screenshot({
    path: "/tmp/stocksbuddha-profile-mobile.png",
    fullPage: true,
  });
  expect(
    (await new AxeBuilder({ page: analyst }).analyze()).violations,
  ).toEqual([]);
  await analyst.keyboard.press("Escape");
  expect(errors).toEqual([]);
  await ownerContext.close();
  await adminContext.close();
  await analystContext.close();
});

test("investors cannot enter organisation/platform workspace or grant themselves roles", async ({
  page,
}) => {
  await signIn(page, "/ra/alpha/login", "investor@example.test", true);
  await expect(page.getByRole("alert")).toContainText("does not have access");
  await expect(page).toHaveURL(/\/ra\/alpha\/login/);
  await signIn(page, "/workspace/login", "investor@example.test");
  await expect(page.getByRole("alert")).toContainText("does not have access");
  await signIn(page, "/ra/alpha/login", "investor@example.test");
  await expect(page).toHaveURL(/\/join$/);
  await page.getByRole("button", { name: /Join/ }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("button", { name: /^Profile/ })).toBeVisible();
  expect((await page.request.get("/ra/alpha/workspace")).status()).toBe(403);
  expect((await page.request.get("/workspace")).status()).toBe(403);
});

test("a new invited RA Admin creates an account, verifies email and explicitly accepts before gaining organisation access", async ({
  browser,
  request,
}) => {
  const ownerContext = await browser.newContext(),
    recipientContext = await browser.newContext();
  const owner = await ownerContext.newPage(),
    recipient = await recipientContext.newPage();
  await signIn(owner, "/workspace/login", "owner@example.test");
  await owner.goto("/workspace/organisations");
  const create = owner
    .getByRole("heading", { name: "Create organisation", exact: true })
    .locator("..");
  await create
    .getByLabel("Organisation name", { exact: true })
    .fill("Activation Research");
  await create
    .getByLabel("Legal name", { exact: true })
    .fill("Activation Legal");
  await create.getByLabel("Website address slug").fill("activation-ra");
  await create.getByLabel("Brand initials").fill("ar");
  await create.getByLabel("RA Admin email").fill("new-admin@example.test");
  await create.getByRole("button", { name: "Create and invite admin" }).click();
  await expect(owner.getByRole("status")).toHaveText("Invitation sent.");
  let messages = await (await request.get("/__test/mail")).json();
  const invitation = messages
    .filter(
      (mail: { kind: string; to: string }) =>
        mail.kind === "invite" && mail.to === "new-admin@example.test",
    )
    .at(-1);
  await recipient.goto(invitation.url);
  await recipient
    .getByRole("link", { name: "Create account", exact: true })
    .click();
  await recipient.getByLabel("Full name", { exact: true }).fill("New RA Admin");
  await recipient
    .getByLabel("Email address", { exact: true })
    .fill("new-admin@example.test");
  await recipient
    .getByLabel("Password", { exact: true })
    .fill("test-password-123");
  await recipient
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(recipient.getByRole("status")).toBeVisible();
  messages = await (await request.get("/__test/mail")).json();
  const verification = messages
    .filter(
      (mail: { kind: string; to: string }) =>
        mail.kind === "verify" && mail.to === "new-admin@example.test",
    )
    .at(-1);
  expect(verification).toBeTruthy();
  await recipient.goto(verification.url);
  await expect(recipient).toHaveURL(/\/invitation$/);
  await recipient.getByRole("link", { name: "Sign in", exact: true }).click();
  await recipient
    .getByLabel("Email address", { exact: true })
    .fill("new-admin@example.test");
  await recipient
    .getByLabel("Password", { exact: true })
    .fill("test-password-123");
  await recipient.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(recipient).toHaveURL(/\/invitation$/);
  await recipient.getByRole("button", { name: "Accept invitation" }).click();
  await expect(recipient).toHaveURL(/\/ra\/activation-ra\/workspace$/);
  await recipient.getByRole("button", { name: /^Profile/ }).click();
  await expect(recipient.getByRole("dialog")).toContainText("New RA Admin");
  await expect(recipient.getByRole("dialog")).toContainText("Verified");
  await ownerContext.close();
  await recipientContext.close();
});

test("platform verification and recovery stay outside RAs and never grant owner access", async ({
  page,
  request,
}) => {
  const email = "platform-onboarding@example.test";
  const signup = await request.post("/api/auth/sign-up/email", {
    headers: { origin: "http://127.0.0.1:3111" },
    data: { email, name: "Platform applicant", password: "test-password-123" },
  });
  expect(signup.ok()).toBeTruthy();
  await page.goto("/workspace/login");
  await page
    .getByRole("link", { name: "Verify your email", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspace\/verify-email/);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const verification = (
    await (await request.get("/__test/mail")).json()
  ).findLast(
    (message: { to: string; kind: string }) =>
      message.to === email && message.kind === "verify",
  );
  expect(verification).toBeTruthy();
  await page.goto(verification.url);
  await expect(page).toHaveURL(/\/workspace\/login$/);
  await page
    .getByRole("link", { name: "Forgot your password?", exact: true })
    .click();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const reset = (await (await request.get("/__test/mail")).json()).findLast(
    (message: { to: string; kind: string }) =>
      message.to === email && message.kind === "reset",
  );
  await page.goto(reset.url);
  await expect(page).toHaveURL(/\/workspace\/reset-password$/);
  await page
    .getByLabel("Password", { exact: true })
    .fill("new-platform-password-123");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Platform owner sign in" }),
  ).toBeVisible();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("new-platform-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#account-error")).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\/login/);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/verify-email");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/stocksbuddha-platform-verify-${width}.png`,
      fullPage: true,
    });
  }
});
