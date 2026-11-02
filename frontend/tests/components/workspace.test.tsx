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

test("team management shows personalized invitations and only admins see resend and revoke controls", () => {
  for (const role of ["owner", "analyst"]) {
    const view = render(
      <App
        data={{
          ...makePage(),
          page: "account",
          account: {
            mode: "workspace",
            area: "organisation",
            section: "team",
            role,
            invitations: [
              {
                id: "pending",
                full_name: "Ada Lovelace",
                email: "ada@example.test",
                role: "analyst",
                delivery_status: "sent",
                expires_at: "2026-12-01",
                accepted_at: null,
                revoked_at: null,
              },
            ],
            members: [
              {
                id: "other",
                name: "Other Person",
                email: "other@example.test",
                role: "support",
                status: "active",
                canRevoke: true,
              },
              {
                id: "self",
                name: "Admin",
                email: "admin@example.test",
                role: "owner",
                status: "active",
                canRevoke: false,
              },
            ],
          },
        }}
      />,
    );
    assert.ok(screen.getByText("Ada Lovelace"));
    assert.ok(screen.getByLabelText("Full name"));
    for (const label of [
      "Resend invitation",
      "Revoke invitation",
      "Revoke access",
    ]) {
      const button = screen.queryByRole("button", { name: label });
      assert.equal(!!button, role === "owner");
      if (button) {
        assert.equal(
          button.closest("form")?.getAttribute("action"),
          `/ra/${makePage().tenant!.slug}/workspace/team`,
        );
        assert.ok(
          button.closest("form")?.querySelector('input[name="action"]'),
        );
      }
    }
    view.unmount();
  }
});

test("table actions use named icons with hover and keyboard tooltips", async () => {
  const { WorkspaceActionButton } =
    await import("../../src/account/WorkspaceActionButton");
  const { Send } = await import("lucide-react");
  const user = userEvent.setup();
  render(<WorkspaceActionButton label="Resend invitation" icon={Send} />);
  const button = screen.getByRole("button", { name: "Resend invitation" });
  assert.equal(button.textContent, "");
  assert.ok(button.querySelector("svg"));
  await user.hover(button);
  assert.equal(screen.getByRole("tooltip").textContent, "Resend invitation");
  await user.unhover(button);
  assert.equal(screen.queryByRole("tooltip"), null);
  await user.tab();
  assert.equal(document.activeElement, button);
  assert.ok(screen.getByRole("tooltip"));
  await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("tooltip"), null);
  await user.tab();
  assert.notEqual(document.activeElement, button);
  assert.equal(screen.queryByRole("tooltip"), null);
});

test("invitation prerequisites offer account switching or verification instead of acceptance", () => {
  for (const invitationIdentity of ["different", "unverified"] as const) {
    const view = render(
      <App
        data={{
          ...makePage(),
          page: "account",
          account: {
            mode: "invitation",
            invitedEmail: "invited@example.test",
            signedIn: true,
            invitationIdentity,
          },
        }}
      />,
    );
    assert.equal(
      screen.queryByRole("button", { name: "Accept invitation" }),
      null,
    );
    if (invitationIdentity === "different")
      assert.ok(screen.getByRole("button", { name: "Switch account" }));
    else assert.ok(screen.getByRole("link", { name: "Verify invited email" }));
    view.unmount();
  }
});

test("signed-in users can leave both mismatched and unavailable invitations without switching accounts", () => {
  for (const unavailable of [false, true]) {
    const view = render(
      <App
        data={{
          ...makePage(),
          tenant: unavailable ? null : makePage().tenant,
          page: "account",
          account: {
            mode: "invitation",
            signedIn: true,
            ...(unavailable
              ? { error: "invitation" as const }
              : {
                  invitationIdentity: "different" as const,
                  invitedEmail: "other@example.test",
                }),
          },
        }}
      />,
    );
    assert.equal(
      screen
        .getByRole("link", { name: "Back to my workspaces" })
        .getAttribute("href"),
      "/workspaces",
    );
    assert.equal(
      screen.queryByRole("button", { name: "Accept invitation" }),
      null,
    );
    view.unmount();
  }
});

test("invitation setup prefills and locks the email, then capsule choice separates signing in from joining", async () => {
  const user = userEvent.setup();
  const data = { ...makePage(), page: "account" as const };
  const view = render(
    <App
      data={{
        ...data,
        account: {
          mode: "signup",
          audience: "organisation",
          email: "invited@example.test",
          invitedEmail: "invited@example.test",
          name: "Invited Person",
        },
      }}
    />,
  );
  const email = screen.getByLabelText("Email address") as HTMLInputElement;
  assert.equal(email.value, "invited@example.test");
  assert.equal(email.readOnly, true);
  assert.equal(
    (screen.getByLabelText("Full name") as HTMLInputElement).value,
    "Invited Person",
  );
  assert.ok(screen.getByRole("button", { name: "Create account and join" }));
  view.unmount();
  render(
    <App
      data={{
        ...data,
        account: {
          mode: "login",
          audience: "organisation",
          email: "invited@example.test",
          invitedEmail: "invited@example.test",
        },
      }}
    />,
  );
  assert.ok(screen.getByRole("button", { name: "Sign in and join" }));
  await user.click(screen.getByRole("radio", { name: "Investor" }));
  assert.ok(screen.getByRole("button", { name: "Sign in" }));
  assert.equal(
    (screen.getByLabelText("Email address") as HTMLInputElement).readOnly,
    false,
  );
});

test("an already authenticated matching invite posts acceptance automatically once, with a no-script fallback", (context) => {
  let submitted = 0;
  context.mock.method(
    window.HTMLFormElement.prototype,
    "requestSubmit",
    function () {
      submitted++;
    },
  );
  render(
    <App
      data={{
        ...makePage(),
        page: "account",
        account: {
          mode: "invitation",
          signedIn: true,
          invitedEmail: "invited@example.test",
          autoAcceptInvitation: true,
        },
      }}
    />,
  );
  assert.equal(submitted, 1);
  assert.ok(screen.getByRole("button", { name: "Continue to workspace" }));
  assert.equal(
    screen.queryByRole("button", { name: "Accept invitation" }),
    null,
  );
});

test("role conflicts give the account holder and administrator actionable guidance without dropping form controls", () => {
  for (const error of ["staff_only", "subscriber_only"] as const) {
    const view = render(
      <App
        data={{
          ...makePage(),
          page: "account",
          account: { mode: "login", error },
        }}
      />,
    );
    assert.match(screen.getByRole("alert").textContent!, /different email/);
    assert.ok(
      screen.getByRole("link", {
        name:
          error === "staff_only"
            ? "Sign in under Organisation"
            : "Sign in under Investor",
      }),
    );
    view.unmount();
  }
  for (const error of [
    "subscriber_conflict",
    "staff_role_conflict",
    "membership_revoked",
  ] as const) {
    const view = render(
      <App
        data={{
          ...makePage(),
          page: "account",
          account: {
            mode: "workspace",
            area: "organisation",
            section: "team",
            role: "owner",
            error,
          },
        }}
      />,
    );
    assert.ok(screen.getByRole("alert"));
    if (error !== "membership_revoked")
      assert.match(screen.getByRole("alert").textContent!, /different email/);
    assert.ok(screen.getByRole("button", { name: "Send invitation" }));
    view.unmount();
  }
});

test("resend and invitation cancellation retain their submitted action while disabling duplicate submissions", () => {
  for (const [label, action] of [
    ["Resend invitation", "resend"],
    ["Revoke invitation", "revokeInvitation"],
  ]) {
    const view = render(
      <App
        data={{
          ...makePage(),
          page: "account",
          account: {
            mode: "workspace",
            area: "organisation",
            section: "team",
            role: "owner",
            invitations: [
              {
                id: "pending-invite",
                full_name: "Invitee",
                email: "invitee@example.test",
                role: "analyst",
                delivery_status: "sent",
                expires_at: "2026-12-01",
                accepted_at: null,
                revoked_at: null,
              },
            ],
          },
        }}
      />,
    );
    const button = screen.getByRole("button", {
      name: label,
    }) as HTMLButtonElement;
    const form = button.closest("form")!;
    assert.equal(
      (form.querySelector('input[name="action"]') as HTMLInputElement).value,
      action,
    );
    assert.equal(
      (form.querySelector('input[name="id"]') as HTMLInputElement).value,
      "pending-invite",
    );
    fireEvent.submit(form);
    assert.equal(button.disabled, true);
    assert.equal(
      (
        screen.getByRole("button", {
          name: "Please wait…",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
    assert.equal(
      (form.querySelector('input[name="action"]') as HTMLInputElement).value,
      action,
    );
    view.unmount();
  }
});

test("membership revocation cancels safely, then confirms the exact member and blocks repeat submission", (context) => {
  let confirmed = false;
  const confirmations: string[] = [];
  context.mock.method(window, "confirm", (message: string) => {
    confirmations.push(message);
    return confirmed;
  });
  render(
    <App
      data={{
        ...makePage(),
        page: "account",
        account: {
          mode: "workspace",
          area: "organisation",
          section: "team",
          role: "owner",
          members: [
            {
              id: "target-member",
              name: "Target",
              email: "target@example.test",
              role: "analyst",
              status: "active",
              canRevoke: true,
            },
          ],
        },
      }}
    />,
  );
  const button = screen.getByRole("button", {
    name: "Revoke access",
  }) as HTMLButtonElement;
  const form = button.closest("form")!;
  assert.equal(fireEvent.submit(form), false);
  assert.equal(button.disabled, false);
  assert.match(confirmations[0], /target@example.test/);
  confirmed = true;
  assert.equal(fireEvent.submit(form), true);
  assert.equal(button.disabled, true);
  assert.equal(
    (form.querySelector('input[name="action"]') as HTMLInputElement).value,
    "revokeMember",
  );
  assert.equal(
    (form.querySelector('input[name="id"]') as HTMLInputElement).value,
    "target-member",
  );
});
