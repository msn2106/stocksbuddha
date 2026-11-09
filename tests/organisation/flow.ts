import englishWebsite from "../../backend/src/websites/seeds/stocksbuddha/en.json" with { type: "json" };
import hindiWebsite from "../../backend/src/websites/seeds/stocksbuddha/hi.json" with { type: "json" };
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
  await create
    .getByLabel("Full name", { exact: true })
    .fill("RA Administrator");
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
  await expect(admin.getByLabel("Email address", { exact: true })).toHaveValue(
    "admin@example.test",
  );
  await expect(
    admin.getByLabel("Email address", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await admin.getByLabel("Password", { exact: true }).fill("test-password-123");
  await admin
    .getByRole("button", { name: "Sign in and join", exact: true })
    .click();
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
  await admin.getByLabel("Full name", { exact: true }).fill("Test Analyst");
  await admin.getByRole("button", { name: "Send invitation" }).click();
  await expect(admin.getByRole("status")).toHaveText("Invitation sent.");
  const latest = await (await request.get("/__test/mail")).json();
  const firstStaffInvite = latest.findLast(
    (email: { to: string; kind: string }) =>
      email.to === "analyst@example.test" && email.kind === "invite",
  );
  expect(firstStaffInvite.fullName).toBe("Test Analyst");
  // An RA Admin opening someone else's invitation must retain an exit to their own workspace.
  await admin.goto(firstStaffInvite.url);
  await expect(admin.getByRole("alert")).toContainText("different account");
  await admin
    .getByRole("link", { name: "Back to my workspaces", exact: true })
    .click();
  await expect(admin).toHaveURL(/\/workspaces$/);
  await admin.getByRole("link", { name: /New RA Research/ }).click();
  await expect(admin).toHaveURL(/\/ra\/new-ra\/workspace\?lang=en$/);
  await expect(admin.getByRole("button", { name: /^Profile/ })).toContainText(
    "RA Admin",
  );
  await admin.getByRole("link", { name: "Team", exact: true }).click();

  const resendButton = admin.getByRole("button", {
    name: "Resend invitation",
    exact: true,
  });
  await resendButton.hover();
  await expect(admin.getByRole("tooltip")).toHaveText("Resend invitation");
  await resendButton.focus();
  await admin.keyboard.press("Escape");
  await expect(admin.getByRole("tooltip")).toHaveCount(0);
  for (const width of [1440, 390]) {
    await admin.setViewportSize({ width, height: 900 });
    await admin.mouse.move(0, 0);
    await resendButton.hover();
    await expect(admin.getByRole("tooltip")).toBeVisible();
    await admin.screenshot({
      path: `/tmp/stocksbuddha-team-icons-${width}.png`,
      fullPage: true,
    });
    expect(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await admin.setViewportSize({ width: 1440, height: 900 });
  await resendButton.click();
  await expect(admin.getByRole("status")).toHaveText("Invitation sent.");
  const resent = await (await request.get("/__test/mail")).json();
  const staffInvite = resent.findLast(
    (email: { to: string; kind: string }) =>
      email.to === "analyst@example.test" && email.kind === "invite",
  );
  expect(staffInvite.url).not.toBe(firstStaffInvite.url);
  expect((await request.get(firstStaffInvite.url)).status()).toBe(404);
  await admin.goto(firstStaffInvite.url);
  await expect(admin.getByRole("alert")).toContainText("unavailable");
  await admin
    .getByRole("link", { name: "Back to my workspaces", exact: true })
    .click();
  await expect(admin).toHaveURL(/\/workspaces$/);

  await analyst.goto(staffInvite.url);
  await expect(
    analyst.getByLabel("Email address", { exact: true }),
  ).toHaveValue("analyst@example.test");
  await analyst
    .getByLabel("Password", { exact: true })
    .fill("test-password-123");
  await analyst
    .getByRole("button", { name: "Sign in and join", exact: true })
    .click();
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
  // Exercise the editor against real sessions and transactional MariaDB persistence.
  await admin.goto("/ra/new-ra/workspace");
  await admin.getByRole("link", { name: "Edit website", exact: true }).click();
  await expect(admin.getByLabel("Website name", { exact: true })).toHaveValue(
    "New RA Research",
  );
  await admin
    .getByLabel("Website name", { exact: true })
    .fill("New RA Published");
  await admin.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(admin.getByRole("status")).toContainText("Draft saved");
  const draftResponse = await admin.request.get(
    "/api/workspaces/new-ra/website",
  );
  const draft = await draftResponse.json();
  expect(draft.id).toBeTruthy();
  expect((await request.get("/ra/new-ra")).status()).toBe(404);
  const completed = await admin.request.post("/api/workspaces/new-ra/website", {
    headers: {
      origin: "http://127.0.0.1:3111",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      action: "save",
      id: draft.id,
      version: draft.version,
      snapshot: {
        ...draft.snapshot,
        languages: { default: "en", enabled: ["en", "hi"] },
        content: { en: englishWebsite, hi: hindiWebsite },
      },
    },
  });
  expect(completed.status()).toBe(200);
  await admin.reload();
  await admin.getByRole("button", { name: "Sections", exact: true }).click();
  await admin
    .getByLabel("Hero headline", { exact: true })
    .fill("Research with a clear perspective");
  await admin.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(admin.getByRole("status")).toContainText("Draft saved");
  await admin.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    admin
      .frameLocator('iframe[title="Website draft preview"]')
      .getByRole("heading", { level: 1 }),
  ).toHaveText("Research with a clear perspective");
  expect(
    (
      await request.get("/ra/new-ra/workspace/website/preview", {
        maxRedirects: 0,
      })
    ).status(),
  ).not.toBe(200);
  expect(
    (await analyst.request.get("/api/workspaces/new-ra/website")).status(),
  ).toBe(403);
  expect(
    (await owner.request.get("/api/workspaces/new-ra/website")).status(),
  ).not.toBe(200);
  for (const width of [1440, 768, 390]) {
    await admin.setViewportSize({ width, height: 900 });
    await admin.getByRole("button", { name: "Branding", exact: true }).click();
    expect(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page: admin }).analyze()).violations,
    ).toEqual([]);
    await admin.screenshot({
      path: `/tmp/stocksbuddha-editor-${width}.png`,
      fullPage: true,
    });
    await admin.getByRole("button", { name: "Sections", exact: true }).click();
  }
  await admin.setViewportSize({ width: 1440, height: 900 });
  admin.once("dialog", (dialog) => dialog.accept());
  await admin
    .getByRole("button", { name: "Publish website", exact: true })
    .click();
  await expect(admin.getByRole("status")).toContainText("Website published");
  await admin.goto("/ra/new-ra/workspace/team");
  const members = admin.getByRole("table", { name: "Organisation members" });
  await expect(
    members
      .getByRole("row")
      .filter({ hasText: "admin@example.test" })
      .getByRole("button", { name: "Revoke access" }),
  ).toHaveCount(0);
  admin.once("dialog", (dialog) => dialog.accept());
  await members
    .getByRole("row")
    .filter({ hasText: "analyst@example.test" })
    .getByRole("button", { name: "Revoke access" })
    .click();
  await expect(admin.getByRole("status")).toHaveText("Access revoked");
  expect(
    (await analystContext.request.get("/ra/new-ra/workspace")).status(),
  ).toBe(404);
  await admin.goto("/ra/new-ra");
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "Research with a clear perspective",
  );
  await admin.getByRole("link", { name: "हिन्दी", exact: true }).click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    hindiWebsite["site.hero"],
  );
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

test("a new invited RA Admin creates a verified account and joins without another email or acceptance", async ({
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
  await create
    .getByLabel("Full name", { exact: true })
    .fill("RA Administrator");
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
  // Email links can be opened in a browser already signed in as the inviter.
  await signIn(recipient, "/workspace/login", "owner@example.test");
  await recipient.goto(invitation.url);
  await expect(recipient.getByRole("alert")).toContainText("different account");
  await expect(
    recipient.getByRole("button", { name: "Accept invitation", exact: true }),
  ).toHaveCount(0);
  await recipient
    .getByRole("button", { name: "Switch account", exact: true })
    .click();
  await expect(recipient).toHaveURL(/\/invitation$/);
  await expect(recipient.getByLabel("Full name", { exact: true })).toHaveValue(
    "RA Administrator",
  );
  await expect(
    recipient.getByLabel("Email address", { exact: true }),
  ).toHaveValue("new-admin@example.test");
  await expect(
    recipient.getByLabel("Email address", { exact: true }),
  ).toHaveAttribute("readonly", "");
  for (const width of [1440, 390]) {
    await recipient.setViewportSize({ width, height: 900 });
    expect(
      (await new AxeBuilder({ page: recipient }).analyze()).violations,
    ).toEqual([]);
    await recipient.screenshot({
      path: `/tmp/stocksbuddha-invitation-setup-${width}.png`,
      fullPage: true,
    });
  }
  await recipient.setViewportSize({ width: 1440, height: 900 });
  await recipient.getByLabel("Full name", { exact: true }).fill("New RA Admin");
  await recipient
    .getByLabel("Password", { exact: true })
    .fill("test-password-123");
  await recipient
    .getByRole("button", { name: "Create account and join", exact: true })
    .click();
  await expect(recipient).toHaveURL(/\/ra\/activation-ra\/workspace$/);
  messages = await (await request.get("/__test/mail")).json();
  expect(
    messages.filter(
      (mail: { kind: string; to: string }) =>
        mail.kind === "verify" && mail.to === "new-admin@example.test",
    ),
  ).toHaveLength(0);
  expect((await recipient.request.get(invitation.url)).status()).toBe(404);
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

test("anonymous account pages never expose unpublished tenant branding in HTML or hydration", async ({
  page,
}) => {
  for (const route of [
    "login",
    "signup",
    "verify-email",
    "forgot-password",
    "reset-password",
  ]) {
    await page.goto(`/ra/beta/${route}?lang=hi`);
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    const html = await page.content();
    expect(html).not.toContain("UNPUBLISHED PRIVATE BETA");
    expect(html).not.toContain("PRIVATE LEGAL BETA");
    expect(html).not.toContain("PRIVATE-REG");
    expect(html).toContain("Beta Research");
  }
});

test("tenant logout still invalidates the global session after suspension", async ({
  page,
}) => {
  await signIn(page, "/ra/beta/login", "logout@example.test");
  await expect(page).toHaveURL(/\/ra\/beta\/account$/);
  expect((await page.request.get("/api/session")).status()).toBe(200);
  expect(
    (
      await page.request.post("/__test/suspend-beta", {
        headers: { origin: "http://127.0.0.1:3111" },
      })
    ).status(),
  ).toBe(204);
  expect((await page.request.get("/api/workspaces/beta")).status()).toBe(404);
  const response = await page.request.post("/ra/beta/logout", {
    headers: { origin: "http://127.0.0.1:3111" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect((await page.request.get("/api/session")).status()).toBe(401);
});

test("platform homepage reaches owner administration without acquiring an RA context", async ({
  page,
  request,
}) => {
  const home = await request.get("/");
  expect(home.status()).toBe(200);
  const html = await home.text();
  const bootstrap = JSON.parse(
    html.match(
      /<script id="page-data" type="application\/json">(.*?)<\/script>/s,
    )![1]!,
  );
  expect(bootstrap.tenant).toBeNull();
  expect(bootstrap.website).toBeNull();
  expect(
    (await request.get("/login", { maxRedirects: 0 })).headers().location,
  ).toBe("/?lang=en#access");
  expect(
    (await request.get("/workspaces", { maxRedirects: 0 })).headers().location,
  ).toBe("/#access");
  await page.goto("/");
  await page
    .getByRole("link", { name: "Platform owner sign in", exact: true })
    .click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(
    page.locator(".workspace-sidebar-footer a").first(),
  ).toHaveAttribute("href", "/");
  const response = await page.request.post("/logout", {
    headers: { origin: "http://127.0.0.1:3111" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe("/#access");
  expect(
    (await page.request.get("/workspace", { maxRedirects: 0 })).headers()
      .location,
  ).toBe("/workspace/login");
});

test("RA Admin cannot invite a subscriber as Analyst or Support and no email is sent", async ({
  browser,
  request,
}) => {
  const subscriberContext = await browser.newContext(),
    adminContext = await browser.newContext();
  const subscriber = await subscriberContext.newPage(),
    admin = await adminContext.newPage();
  await signIn(subscriber, "/ra/new-ra/login", "investor@example.test");
  await subscriber.getByRole("button", { name: /Join/ }).click();
  await expect(subscriber).toHaveURL(/\/account$/);
  await signIn(admin, "/ra/new-ra/login", "admin@example.test", true);
  await admin.getByRole("link", { name: "Team", exact: true }).click();
  const messages = await (await request.get("/__test/mail")).json();
  const before = messages.filter(
    (mail: { to: string; kind: string }) =>
      mail.to === "investor@example.test" && mail.kind === "invite",
  ).length;
  for (const role of ["analyst", "support"]) {
    const form = admin
      .getByRole("heading", { name: "Invite team member", exact: true })
      .locator("..");
    await form
      .getByLabel("Full name", { exact: true })
      .fill("Existing Subscriber");
    await form
      .getByLabel("Email address", { exact: true })
      .fill("investor@example.test");
    await form.getByLabel("Your role").selectOption(role);
    await form
      .getByRole("button", { name: "Send invitation", exact: true })
      .click();
    await expect(admin.getByRole("alert")).toContainText(
      "already listed as a subscriber",
    );
    await expect(admin.getByRole("alert")).toContainText(
      "Use a different email",
    );
  }
  for (const width of [1440, 390]) {
    await admin.setViewportSize({ width, height: 900 });
    expect(
      (await new AxeBuilder({ page: admin }).analyze()).violations,
    ).toEqual([]);
    if (width === 390) {
      await admin
        .getByRole("region", { name: "Invitations", exact: true })
        .focus();
      await expect(
        admin.getByRole("region", { name: "Invitations", exact: true }),
      ).toBeFocused();
    }
    await admin.screenshot({
      path: `/tmp/stocksbuddha-role-invite-conflict-${width}.png`,
      fullPage: true,
    });
  }
  const after = await (await request.get("/__test/mail")).json();
  expect(
    after.filter(
      (mail: { to: string; kind: string }) =>
        mail.to === "investor@example.test" && mail.kind === "invite",
    ),
  ).toHaveLength(before);
  await subscriber.goto("/ra/new-ra/login?audience=organisation");
  await subscriber
    .getByLabel("Email address", { exact: true })
    .fill("investor@example.test");
  await subscriber
    .getByLabel("Password", { exact: true })
    .fill("test-password-123");
  await subscriber
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(subscriber.getByRole("alert")).toContainText(
    "subscriber account",
  );
  expect((await subscriber.request.get("/ra/new-ra/workspace")).status()).toBe(
    403,
  );
  await subscriberContext.close();
  await adminContext.close();
});

test("every staff role is blocked from subscriber signup, login, direct URLs and forged enrollment", async ({
  browser,
  request,
}) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, "/ra/new-ra/login", "admin@example.test", true);
  const cases = [
    { email: "admin@example.test", role: "owner" },
    { email: "analyst-policy@example.test", role: "analyst" },
    { email: "support-policy@example.test", role: "support" },
  ];
  for (const entry of cases) {
    if (entry.role !== "owner") {
      await admin.goto("/ra/new-ra/workspace/team");
      const form = admin
        .getByRole("heading", { name: "Invite team member", exact: true })
        .locator("..");
      await form.getByLabel("Full name", { exact: true }).fill("Policy Staff");
      await form.getByLabel("Email address", { exact: true }).fill(entry.email);
      await form.getByLabel("Your role").selectOption(entry.role);
      await form
        .getByRole("button", { name: "Send invitation", exact: true })
        .click();
      await expect(admin.getByRole("status")).toHaveText("Invitation sent.");
    }
    const context = await browser.newContext();
    const staff = await context.newPage();
    if (entry.role !== "owner") {
      const messages = await (await request.get("/__test/mail")).json();
      const invitation = messages
        .filter(
          (mail: { to: string; kind: string }) =>
            mail.to === entry.email && mail.kind === "invite",
        )
        .at(-1);
      await staff.goto(invitation.url);
      await staff
        .getByLabel("Password", { exact: true })
        .fill("test-password-123");
      await staff
        .getByRole("button", { name: "Sign in and join", exact: true })
        .click();
    } else await signIn(staff, "/ra/new-ra/login", entry.email, true);
    await expect(staff).toHaveURL(/\/workspace$/);
    await staff.goto("/ra/new-ra/signup");
    await expect(staff.getByRole("alert")).toContainText(
      "already belongs to an organisation team account",
    );
    await expect(
      staff.getByRole("link", { name: "Sign in under Organisation" }),
    ).toBeVisible();
    if (entry.role === "owner") {
      await staff.setViewportSize({ width: 390, height: 900 });
      expect(
        (await new AxeBuilder({ page: staff }).analyze()).violations,
      ).toEqual([]);
      await staff.screenshot({
        path: "/tmp/stocksbuddha-role-signup-conflict-390.png",
        fullPage: true,
      });
    }
    const signup = await context.request.post("/ra/new-ra/signup", {
      headers: { origin: "http://127.0.0.1:3111" },
      form: {
        email: entry.email,
        password: "Different-password-123",
        name: "Forged",
      },
    });
    expect(signup.status()).toBe(409);
    expect((await context.request.get("/ra/new-ra/account")).status()).toBe(
      403,
    );
    expect((await context.request.get("/ra/new-ra/join")).status()).toBe(403);
    expect(
      (
        await context.request.post("/ra/new-ra/join", {
          headers: { origin: "http://127.0.0.1:3111" },
        })
      ).status(),
    ).toBe(403);
    const enrollment = await context.request.post(
      "/api/workspaces/new-ra/membership",
      {
        headers: {
          origin: "http://127.0.0.1:3111",
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: { role: "subscriber" },
      },
    );
    expect(enrollment.status()).toBe(403);
    expect((await enrollment.json()).error).toBe("staff_only");
    await staff.goto("/ra/new-ra/login?audience=investor");
    await staff.getByLabel("Email address", { exact: true }).fill(entry.email);
    await staff
      .getByLabel("Password", { exact: true })
      .fill("test-password-123");
    await staff.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(staff.getByRole("alert")).toContainText(
      "Please sign in under Organisation",
    );
    await context.close();
  }
  const roster: {
    id: string;
    role: string;
    status: string;
    version: number;
  }[] = (
    await (
      await adminContext.request.get("/api/workspaces/new-ra/members")
    ).json()
  ).members;
  for (const target of [
    roster.find(
      (member) => member.role === "subscriber" && member.status === "active",
    )!,
    roster.find(
      (member) => member.role === "analyst" && member.status === "active",
    )!,
  ]) {
    const changed = await adminContext.request.patch(
      `/api/workspaces/new-ra/members/${target.id}`,
      {
        headers: {
          origin: "http://127.0.0.1:3111",
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: {
          role: target.role === "subscriber" ? "support" : "subscriber",
          active: true,
          version: target.version,
        },
      },
    );
    expect(changed.status()).toBe(409);
    expect((await changed.json()).error).toBe("role_category_conflict");
  }
  await adminContext.close();
});

test("an invitation issued before subscriber enrollment cannot convert that subscriber", async ({
  browser,
  request,
}) => {
  const adminContext = await browser.newContext(),
    userContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    user = await userContext.newPage();
  await signIn(admin, "/ra/new-ra/login", "admin@example.test", true);
  await admin.getByRole("link", { name: "Team", exact: true }).click();
  const form = admin
    .getByRole("heading", { name: "Invite team member", exact: true })
    .locator("..");
  await form.getByLabel("Full name", { exact: true }).fill("Late Subscriber");
  await form
    .getByLabel("Email address", { exact: true })
    .fill("logout@example.test");
  await form
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(admin.getByRole("status")).toHaveText("Invitation sent.");
  const messages = await (await request.get("/__test/mail")).json();
  const invitation = messages
    .filter(
      (mail: { to: string; kind: string }) =>
        mail.to === "logout@example.test" && mail.kind === "invite",
    )
    .at(-1);
  await user.goto(invitation.url);
  await user.getByRole("radio", { name: "Investor", exact: true }).check();
  await user.getByLabel("Password", { exact: true }).fill("test-password-123");
  await user.getByRole("button", { name: "Sign in", exact: true }).click();
  await user.getByRole("button", { name: /Join/ }).click();
  await expect(user).toHaveURL(/\/account$/);
  await user.goto("/ra/new-ra/invitation");
  await expect(user.getByRole("alert")).toContainText(
    "already listed as a subscriber",
  );
  expect((await userContext.request.get("/ra/new-ra/workspace")).status()).toBe(
    403,
  );
  await adminContext.close();
  await userContext.close();
});

test("role exclusivity is scoped to one RA, not to the global email identity", async ({
  browser,
  request,
}) => {
  const adminContext = await browser.newContext(),
    userContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    user = await userContext.newPage();
  await signIn(
    admin,
    "/ra/activation-ra/login",
    "new-admin@example.test",
    true,
  );
  await admin.getByRole("link", { name: "Team", exact: true }).click();
  const form = admin
    .getByRole("heading", { name: "Invite team member", exact: true })
    .locator("..");
  await form.getByLabel("Full name", { exact: true }).fill("Other RA Staff");
  await form
    .getByLabel("Email address", { exact: true })
    .fill("investor@example.test");
  await form.getByLabel("Your role").selectOption("support");
  await form
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(admin.getByRole("status")).toHaveText("Invitation sent.");
  const messages = await (await request.get("/__test/mail")).json();
  const invitation = messages
    .filter(
      (mail: { to: string; kind: string }) =>
        mail.to === "investor@example.test" && mail.kind === "invite",
    )
    .at(-1);
  await signIn(user, "/ra/new-ra/login", "investor@example.test");
  await expect(user).toHaveURL(/\/account$/);
  await user.goto(invitation.url);
  await expect(user).toHaveURL(/\/ra\/activation-ra\/workspace$/);
  expect((await userContext.request.get("/ra/new-ra/account")).status()).toBe(
    200,
  );
  expect(
    (await userContext.request.get("/ra/activation-ra/account")).status(),
  ).toBe(403);
  await adminContext.close();
  await userContext.close();
});

test("anonymous duplicate signup does not disclose roles or overwrite an existing staff password", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/ra/new-ra/signup");
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Forged Replacement");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("analyst-policy@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Different-password-123");
  await page.getByLabel("Phone number", { exact: true }).fill("9876543210");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("Different-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText(/already belongs to an organisation team account/),
  ).toHaveCount(0);
  await signIn(page, "/ra/new-ra/login", "analyst-policy@example.test", true);
  await expect(page).toHaveURL(/\/workspace$/);
  await context.close();
});
