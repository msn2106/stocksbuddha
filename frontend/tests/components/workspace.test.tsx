import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/App";
import { makePage } from "../../../packages/contracts/tests/fixtures";
import { resetDom } from "../dom";
afterEach(() => {
  cleanup();
  resetDom();
});

test("organisation selector changes login intent without offering self-service staff signup", async () => {
  const user = userEvent.setup();
  render(
    <App
      data={{ ...makePage(), page: "account", account: { mode: "login" } }}
    />,
  );
  await user.click(screen.getByRole("radio", { name: "Organisation" }));
  assert.equal(screen.queryByRole("link", { name: "Create account" }), null);
  assert.ok(screen.getByText(/invited by your RA Admin/));
  assert.equal(
    (
      screen.getByRole("radio", {
        name: "Organisation",
      }) as HTMLInputElement
    ).checked,
    true,
  );
});

test("authenticated workspace is a blank shell with brand, placeholder sidebar and accessible top-right profile", async () => {
  const user = userEvent.setup();
  const data = makePage();
  render(
    <App
      data={{
        ...data,
        page: "account",
        account: {
          mode: "workspace",
          role: "owner",
          profile: {
            name: "Mayank Singh",
            email: "person@example.test",
            emailVerified: true,
          },
          area: "organisation",
        },
      }}
    />,
  );
  assert.ok(screen.getByRole("navigation", { name: "Workspace navigation" }));
  assert.ok(
    screen
      .getByRole("button", { name: /Research.*Coming soon/ })
      .hasAttribute("disabled"),
  );
  assert.equal(screen.queryByText("Website management"), null);
  await user.click(screen.getByRole("button", { name: /^Profile/ }));
  assert.ok(screen.getByRole("dialog", { name: "Your profile" }));
  assert.ok(screen.getByText("person@example.test"));
  assert.ok(screen.getAllByText("RA Admin").length);
  await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("dialog"), null);
});

test("platform management exposes organisation/admin invitations while tenant management limits roles to analyst and support", async () => {
  const data = makePage();
  const user = userEvent.setup();
  const view = render(
    <App
      data={{
        ...data,
        tenant: null,
        website: null,
        page: "account",
        account: {
          mode: "workspace",
          area: "platform",
          section: "organisations",
          role: "platform_owner",
          profile: {
            name: "Owner",
            email: "owner@example.test",
            emailVerified: true,
          },
          notice: "invited",
          organisations: [
            {
              id: "one",
              slug: "alpha",
              name: "Alpha",
              status: "draft",
              administrators: 0,
            },
            {
              id: "two",
              slug: "beta",
              name: "Beta",
              status: "active",
              administrators: 1,
            },
            {
              id: "three",
              slug: "inactive",
              name: "Inactive",
              status: "suspended",
              administrators: 0,
            },
          ],
        },
      }}
    />,
  );
  assert.ok(screen.getByRole("status"));
  assert.ok(screen.getByRole("heading", { name: "Create organisation" }));
  const organisation = screen.getByLabelText("Organisation name");
  assert.equal(organisation.getAttribute("maxlength"), "80");
  assert.ok(screen.getByText("Awaiting admin activation"));
  await user.click(
    screen.getByRole("button", { name: "Workspace navigation" }),
  );
  const forms = view.container.querySelectorAll("form");
  fireEvent.submit(forms[0]);
  fireEvent.submit(forms[1]);
  assert.ok(screen.getAllByRole("button", { name: "Please wait…" }).length);
  view.unmount();
  render(
    <App
      data={{
        ...data,
        page: "account",
        account: {
          mode: "workspace",
          area: "organisation",
          section: "team",
          role: "owner",
          profile: {
            name: "Admin",
            email: "admin@example.test",
            emailVerified: false,
          },
          error: "invitation",
          invitations: [
            {
              id: "one",
              email: "one@example.test",
              role: "analyst",
              delivery_status: "sent",
              expires_at: "2026-11-02",
              accepted_at: "2026-11-01",
              revoked_at: null,
            },
            {
              id: "two",
              email: "two@example.test",
              role: "support",
              delivery_status: "failed",
              expires_at: "2026-11-02",
              accepted_at: null,
              revoked_at: null,
            },
            {
              id: "three",
              email: "three@example.test",
              role: "support",
              delivery_status: "sent",
              expires_at: "2026-11-02",
              accepted_at: null,
              revoked_at: "2026-11-01",
            },
            {
              id: "four",
              email: "four@example.test",
              role: "support",
              delivery_status: "sent",
              expires_at: "2026-11-02",
              accepted_at: null,
              revoked_at: null,
            },
          ],
        },
      }}
    />,
  );
  assert.ok(screen.getByRole("alert"));
  assert.deepEqual(
    [...screen.getByRole("combobox").querySelectorAll("option")].map(
      (option) => option.value,
    ),
    ["analyst", "support"],
  );
  for (const status of [
    "Accepted",
    "Delivery failed — send again",
    "Replaced / revoked",
    "Pending acceptance",
  ])
    assert.ok(screen.getByText(status));
  fireEvent.submit(
    screen.getByRole("button", { name: "Send invitation" }).closest("form")!,
  );
  await user.click(screen.getByRole("button", { name: /^Profile/ }));
  assert.ok(screen.getByText("Not verified"));
});

test("investor shell and organisation invitation screens handle empty identity, guest, signed-in and invalid links", async () => {
  const data = makePage();
  let view = render(
    <App
      data={{
        ...data,
        page: "account",
        account: { mode: "workspace", area: "investor", role: "subscriber" },
      }}
    />,
  );
  assert.ok(screen.getByRole("button", { name: /^Profile/ }));
  view.unmount();
  for (const signedIn of [false, true]) {
    view = render(
      <App
        data={{
          ...data,
          page: "account",
          account: {
            mode: "invitation",
            invitedEmail: "person@example.test",
            invitedRole: "owner",
            signedIn,
          },
        }}
      />,
    );
    assert.ok(screen.getByText(/person@example.test/));
    if (signedIn)
      assert.ok(screen.getByRole("button", { name: "Accept invitation" }));
    else assert.ok(screen.getByRole("link", { name: "Create account" }));
    view.unmount();
  }
  view = render(
    <App
      data={{
        ...data,
        page: "account",
        account: { mode: "invitation", error: "invitation" },
      }}
    />,
  );
  assert.ok(screen.getByRole("alert"));
  view.unmount();
  view = render(
    <App
      data={{
        ...data,
        page: "account",
        account: { mode: "invitation", invitedRole: "support", signedIn: true },
      }}
    />,
  );
  assert.ok(screen.getByText(/Support/));
  view.unmount();
  render(
    <App
      data={{
        ...data,
        page: "account",
        account: { mode: "login", audience: "platform", error: "access" },
      }}
    />,
  );
  assert.ok(screen.getByRole("heading", { name: "Platform owner sign in" }));
  assert.equal(screen.queryByRole("radio"), null);
  assert.equal(screen.queryByRole("link", { name: "Create account" }), null);
});

test("platform login and recovery forms keep every link and action outside tenant URLs", () => {
  for (const mode of [
    "login",
    "verify-email",
    "forgot-password",
    "reset-password",
  ] as const) {
    const view = render(
      <App
        data={{
          ...makePage(),
          tenant: null,
          website: null,
          page: "account",
          account: { mode, audience: "platform" },
        }}
      />,
    );
    const form = view.container.querySelector("form")!;
    assert.equal(form.getAttribute("action"), `/workspace/${mode}?lang=en`);
    assert.equal(view.container.querySelector('a[href*="/ra/"]'), null);
    assert.equal(screen.queryByRole("link", { name: "Create account" }), null);
    if (mode === "login") {
      assert.equal(
        screen
          .getByRole("link", { name: "Verify your email" })
          .getAttribute("href"),
        "/workspace/verify-email?lang=en",
      );
      assert.equal(
        screen
          .getByRole("link", { name: "Forgot your password?" })
          .getAttribute("href"),
        "/workspace/forgot-password?lang=en",
      );
    } else {
      assert.equal(
        screen.queryByRole("heading", { name: "Platform owner sign in" }),
        null,
      );
      assert.ok(
        screen
          .getAllByRole("link", { name: "Sign in" })
          .every(
            (link) => link.getAttribute("href") === "/workspace/login?lang=en",
          ),
      );
    }
    view.unmount();
  }
});
