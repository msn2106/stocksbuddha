import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/App";
import { render as renderPage } from "../../src/entry-server";
import { makePage } from "../../../packages/contracts/tests/fixtures";
import type { AccountView, PageData } from "@ra/contracts";
import { resetDom } from "../dom";

afterEach(() => {
  cleanup();
  resetDom();
});
/** Build a resolved tenant account view without session or credential data. */
function page(account: AccountView): PageData {
  return { ...makePage(), page: "account", account };
}

test("tenant auth forms preserve context, support password visibility, validation hints and submission state", async () => {
  const user = userEvent.setup();
  let data = page({ mode: "login" });
  const view = render(<App data={data} />);
  assert.ok(screen.getByRole("heading", { name: "Welcome back" }));
  assert.equal(
    screen.getByRole("link", { name: "Create account" }).getAttribute("href"),
    "/ra/example/signup?lang=en",
  );
  const password = screen.getByLabelText("Password", { exact: true });
  assert.equal(password.getAttribute("type"), "password");
  await user.click(screen.getByRole("button", { name: "Show password" }));
  assert.equal(password.getAttribute("type"), "text");
  await user.click(screen.getByRole("button", { name: "Hide password" }));
  assert.equal(password.getAttribute("type"), "password");
  const form = password.closest("form")!;
  assert.equal(form.getAttribute("action"), "/ra/example/login?lang=en");
  fireEvent.submit(form);
  assert.ok(
    screen
      .getByRole("button", { name: "Please wait…" })
      .hasAttribute("disabled"),
  );
  view.unmount();
  data = page({
    mode: "signup",
    error: "credentials",
    email: "old@example.test",
    name: "Example User",
  });
  render(<App data={data} />);
  assert.ok(screen.getByRole("alert"));
  assert.equal(
    (screen.getByLabelText("Full name") as HTMLInputElement).value,
    "Example User",
  );
  assert.equal(
    (screen.getByLabelText("Email address") as HTMLInputElement).value,
    "old@example.test",
  );
  assert.equal(
    (screen.getByLabelText("Password", { exact: true }) as HTMLInputElement)
      .value,
    "",
  );
  assert.ok(screen.getByText("Use 8–128 characters."));
  assert.equal(
    screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    "/ra/example/login?lang=en",
  );
  assert.equal(
    screen
      .getByRole("button", { name: "Create account" })
      .closest("form")
      ?.getAttribute("action"),
    "/ra/example/signup?lang=en",
  );
});

test("account service failures disable credentials and Hindi account pages render complete localized labels", () => {
  const data = page({ mode: "signup", error: "service" });
  data.locale = "hi";
  const view = render(<App data={data} />);
  assert.ok(screen.getByRole("heading", { name: "अपना खाता बनाएँ" }));
  assert.ok(screen.getByRole("alert").textContent?.includes("उपलब्ध नहीं"));
  assert.ok(
    screen.getByRole("button", { name: "खाता बनाएँ" }).hasAttribute("disabled"),
  );
  assert.ok(screen.getByLabelText("पूरा नाम").hasAttribute("disabled"));
  assert.equal(
    screen.getByRole("link", { name: "साइन इन करें" }).getAttribute("href"),
    "/ra/example/login?lang=hi",
  );
  view.unmount();
  const signup = page({ mode: "signup" });
  signup.tenant!.profile.registration = null;
  signup.website = null;
  render(<App data={signup} />);
  assert.equal(screen.queryByText("INH0000000000"), null);
});

test("workspace states display human-readable permissions, tenant links, empty memberships and sign-out actions", () => {
  const data = page({
    mode: "workspace",
    role: "owner",
    capabilities: [
      "website:edit",
      "research:publish",
      "subscribers:read",
      "staff:manage",
    ],
  });
  let view = render(<App data={data} />);
  for (const label of [
    "Owner",
    "Website management",
    "Research publishing",
    "Subscriber management",
    "Team management",
  ])
    assert.ok(screen.getByText(label));
  assert.equal(
    screen
      .getByRole("button", { name: "Sign out" })
      .closest("form")
      ?.getAttribute("action"),
    "/ra/example/logout",
  );
  view.unmount();
  view = render(
    <App
      data={page({ mode: "workspace", role: "subscriber", capabilities: [] })}
    />,
  );
  assert.ok(screen.getByText("Workspace overview"));
  view.unmount();
  view = render(<App data={page({ mode: "unavailable" })} />);
  assert.ok(screen.getByText(/You don’t have an active membership/));
  view.unmount();
  const chooser = page({
    mode: "workspaces",
    workspaces: [{ slug: "alpha", name: "Alpha", role: "analyst" }],
  });
  chooser.tenant = null;
  chooser.website = null;
  view = render(<App data={chooser} />);
  assert.equal(
    screen.getByRole("link", { name: /Alpha/ }).getAttribute("href"),
    "/ra/alpha/workspace?lang=en",
  );
  assert.equal(
    screen
      .getByRole("button", { name: "Sign out" })
      .closest("form")
      ?.getAttribute("action"),
    "/logout",
  );
  view.unmount();
  chooser.account!.workspaces = [];
  render(<App data={chooser} />);
  assert.ok(screen.getByText(/no active workspace memberships/));
});

test("account SSR escapes fields, preserves locale and works without a published website", () => {
  const data = page({
    mode: "login",
    error: "credentials",
    email: '"><script>alert(1)</script>',
  });
  data.website = null;
  const rendered = renderPage(data);
  assert.match(rendered.head, /Welcome back/);
  assert.equal(rendered.html.includes("<script>alert(1)</script>"), false);
  assert.equal(rendered.data.includes("<script>alert(1)</script>"), false);
  data.tenant = null;
  data.account = { mode: "workspaces" };
  assert.match(renderPage(data).head, /Your workspaces/);
});

test("recovery and join forms use localized labels without exposing reset tokens", () => {
  for (const mode of [
    "verify-email",
    "forgot-password",
    "reset-password",
    "join",
  ] as const) {
    for (const locale of ["en", "hi"] as const) {
      const data = { ...page({ mode, notice: "sent" as const }), locale };
      const html = renderPage(data);
      assert.ok(!html.html.includes("undefined"));
      assert.ok(html.html.includes(`/ra/example/${mode}?lang=${locale}`));
      assert.ok(!html.data.includes("token"));
      const view = render(<App data={data} />);
      assert.ok(screen.getByRole("status"));
      if (mode === "reset-password")
        assert.equal(
          view.container.querySelector("input")?.getAttribute("autocomplete"),
          "new-password",
        );
      if (mode === "join")
        assert.equal(view.container.querySelector("input"), null);
      view.unmount();
    }
  }
  render(<App data={page({ mode: "login", notice: "reset" })} />);
  assert.match(
    screen.getByRole("status").textContent ?? "",
    /previous sessions/,
  );
});
