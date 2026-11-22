import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { TelegramConnection } from "../../src/account/TelegramConnection";
const original = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = original;
});

test("investor Telegram flow issues personal invites, refreshes a completed link and disconnects", async () => {
  let linked = false;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/invite")) {
      assert.equal(init?.method, "POST");
      return Response.json({
        url: "https://t.me/example_ra_bot?start=private_invite",
      });
    }
    if (String(url).endsWith("/unlink")) linked = false;
    return Response.json({
      connected: true,
      username: "example_ra_bot",
      mobileVerified: true,
      linked,
    });
  };
  render(<TelegramConnection slug="alpha" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Connect Telegram" }),
  );
  assert.equal(
    (
      await screen.findByRole("link", { name: "Open personal Telegram invite" })
    ).getAttribute("href"),
    "https://t.me/example_ra_bot?start=private_invite",
  );
  linked = true;
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh Telegram status" }),
  );
  await screen.findByRole("button", { name: "Replace Telegram account" });
  assert.equal(
    screen.queryByRole("link", { name: "Open personal Telegram invite" }),
    null,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Replace Telegram account" }),
  );
  await screen.findByRole("link", { name: "Open personal Telegram invite" });
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Telegram" }));
  await screen.findByRole("button", { name: "Connect Telegram" });
  assert.ok(calls.includes("/api/workspaces/alpha/telegram/unlink"));
});

test("Telegram exposes loading recovery, mobile requirements and actionable bot activation failures", async () => {
  let fail = true;
  globalThis.fetch = async () =>
    fail
      ? Response.json({}, { status: 503 })
      : Response.json({ connected: true, mobileVerified: false });
  const view = render(<TelegramConnection slug="alpha" />);
  await screen.findByRole("alert");
  fail = false;
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh Telegram status" }),
  );
  assert.ok(
    (
      await screen.findByRole("button", { name: "Connect Telegram" })
    ).hasAttribute("disabled"),
  );
  view.unmount();
  globalThis.fetch = async (_url, init) =>
    init
      ? Response.json({ error: "telegram_https_required" }, { status: 422 })
      : Response.json({ connected: false });
  render(<TelegramConnection slug="alpha" owner />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Connect bot to site" }),
  );
  await screen.findByText(/public HTTPS address/);
});
