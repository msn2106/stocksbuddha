import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { SmsSettings } from "../../src/websites/SmsSettings";
import { IntegrationSettings } from "../../src/websites/IntegrationSettings";
import { settingsError } from "../../src/websites/settings-ui";
const originalFetch = globalThis.fetch,
  originalFormData = globalThis.FormData;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.FormData = originalFormData;
});
/** Model sanitized server responses and record complete versioned requests without returning stored secrets. */
function fixture(kind = "sms") {
  globalThis.FormData = window.FormData;
  const state: Record<string, unknown> = {
    version: 0,
    configured: false,
    trial: true,
    events: [],
    verification: {
      id: "110100000000002",
      text: "Your code is {{otp}}, valid {{expiryMinutes}} minutes.",
    },
  };
  const calls: Record<string, unknown>[] = [];
  let failure = "";
  globalThis.fetch = async (_url, init) => {
    if (failure) return Response.json({ error: failure }, { status: 409 });
    if (init) {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      const { apiKey, botToken, clientSecret, ...safe } = body;
      Object.assign(state, safe, {
        version: Number(state.version) + 1,
        configured: !!(state.configured || apiKey || botToken || clientSecret),
      });
      if (kind === "sms")
        state.events = [
          {
            id: "event",
            status: "accepted",
            message_id: "123",
            balance: "10",
            created_at: "2026-11-09",
          },
          {
            id: "other",
            status: "uncertain",
            message_id: null,
            balance: null,
            created_at: "2026-11-09",
          },
        ];
    }
    return Response.json(state);
  };
  return {
    state,
    calls,
    fail: (value: string) => {
      failure = value;
    },
  };
}
/** Submit through the current panel's primary save action. */
function submit(name: string) {
  fireEvent.submit(screen.getByRole("button", { name }).closest("form")!);
}
/** Enter real user-facing field values rather than manipulating component state. */
function change(name: string, value: string) {
  fireEvent.change(screen.getByLabelText(name, { exact: true }), {
    target: { value },
  });
}

test("SMS panel starts with two workflows, edits a growing library, previews DLT messages and privately retains credentials", async () => {
  const f = fixture();
  const dirty: boolean[] = [];
  render(
    <SmsSettings slug="alpha" onDirtyChange={(value) => dirty.push(value)} />,
  );
  await screen.findByLabelText("Vendor username");
  assert.ok(screen.getByRole("button", { name: /^Login / }));
  assert.ok(screen.getByRole("button", { name: /Reset\/Forgot Password/ }));
  for (const input of screen.getAllByRole("textbox"))
    assert.ok(input.getAttribute("placeholder"));
  change("Vendor username", "ra-user");
  change("API key (leave blank to retain saved key)", "private-api-key");
  change("Approved sender ID", "HORIZN");
  change("DLT entity ID", "110100000000001");
  const secret = screen.getByLabelText(
    "API key (leave blank to retain saved key)",
  ) as HTMLInputElement;
  assert.equal(secret.type, "password");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Show API key (leave blank to retain saved key)",
    }),
  );
  assert.equal(secret.type, "text");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Hide API key (leave blank to retain saved key)",
    }),
  );
  change(
    "Approved message",
    "Your code {{otp}} expires in {{expiryMinutes}} minutes.",
  );
  await screen.findByText("Your code 123456 expires in 5 minutes.");
  fireEvent.click(screen.getByLabelText("Enable SMS verification"));
  fireEvent.click(
    screen.getByRole("button", { name: /Reset\/Forgot Password/ }),
  );
  assert.ok(
    screen.getByText(/Global password resets use the platform-managed sender/),
  );
  change("DLT template ID", "110100000000003");
  change("Approved message", "Reset code {{otp}}.");
  fireEvent.click(screen.getByRole("button", { name: "Add SMS template" }));
  change("Template name", "Subscription reminder");
  change("DLT template ID", "110100000000004");
  change("Approved message", "Your research subscription expires soon.");
  submit("Save SMS settings");
  await screen.findByText("SMS settings saved.");
  assert.equal((f.calls[0].templates as unknown[]).length, 3);
  assert.equal(f.calls[0].apiKey, "private-api-key");
  assert.ok(dirty.includes(true));
  assert.equal(dirty.at(-1), false);
  assert.equal(
    (
      screen.getByLabelText(
        "API key (leave blank to retain saved key)",
      ) as HTMLInputElement
    ).value,
    "",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Subscription reminder" }),
  );
  submit("Save SMS settings");
  await waitFor(() => assert.equal(f.calls.length, 2));
  assert.equal("apiKey" in f.calls[1], false);
  assert.equal((f.calls[1].templates as unknown[]).length, 2);
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: "Save SMS settings" })
        .hasAttribute("disabled"),
      false,
    ),
  );
  f.fail("version_conflict");
  submit("Save SMS settings");
  await screen.findByRole("alert");
  f.fail("integration_unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Refresh SMS status" }));
  await screen.findByText(/Settings could not be saved or loaded/);
});

test("SMS loading failures recover and incomplete template names and empty previews remain editable", async () => {
  const f = fixture();
  f.fail("unavailable");
  render(<SmsSettings slug="alpha" />);
  await screen.findByRole("alert");
  f.fail("");
  fireEvent.click(screen.getByRole("button", { name: "Reload settings" }));
  await screen.findByLabelText("Vendor username");
  fireEvent.click(
    screen.getByRole("button", { name: /Reset\/Forgot Password/ }),
  );
  await screen.findByText(
    "Your approved message will appear here with an example code.",
  );
  change("Template name", "");
  assert.ok(screen.getByRole("heading", { name: "Untitled template" }));
  change("Template name", "Reset/Forgot Password");
  fireEvent.click(screen.getByRole("button", { name: "Add SMS template" }));
  change("Template name", "");
  assert.ok(
    screen.getByRole("button", {
      name: /^Untitled template /,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Remove/ }));
});

test("Telegram settings save a private connection, retain blank secrets and distinguish configuration from delivery", async () => {
  const f = fixture("telegram"),
    dirty: boolean[] = [];
  render(
    <IntegrationSettings
      slug="alpha"
      kind="telegram"
      onDirtyChange={(value) => dirty.push(value)}
    />,
  );
  await screen.findByLabelText("Bot token");
  assert.ok(
    screen.getByText(
      /Automated Telegram delivery and investor channel access are not enabled yet/,
    ),
  );
  change("Bot token", "123456789:private-bot-token");
  change("Channel / chat ID", "-1001234567890");
  change("Investor invite link (optional)", "https://t.me/+testInvite");
  submit("Save Telegram settings");
  await screen.findByText(/Telegram settings saved/);
  assert.equal(f.calls[0].botToken, "123456789:private-bot-token");
  assert.equal(dirty.at(-1), false);
  assert.equal(
    (screen.getByLabelText("Bot token") as HTMLInputElement).value,
    "",
  );
  submit("Save Telegram settings");
  await waitFor(() => assert.equal(f.calls.length, 2));
  assert.equal("botToken" in f.calls[1], false);
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: "Save Telegram settings" })
        .hasAttribute("disabled"),
      false,
    ),
  );
  f.fail("invalid_integration_settings");
  submit("Save Telegram settings");
  await screen.findByRole("alert");
});

test("payment settings expose sandbox/live selection, merchant ownership and lock unsafe credential rotation", async () => {
  const f = fixture("payment");
  render(<IntegrationSettings slug="alpha" kind="payment" />);
  await screen.findByLabelText("Client ID");
  change("Client ID", "TEST_client");
  change("Client secret", "private-client-secret");
  fireEvent.click(screen.getByLabelText(/Enable this payment connection/));
  fireEvent.change(screen.getByLabelText("Environment"), {
    target: { value: "production" },
  });
  submit("Save payment settings");
  await screen.findByText("Payment gateway settings saved.");
  assert.equal(f.calls[0].provider, "cashfree");
  assert.equal(f.calls[0].mode, "production");
  submit("Save payment settings");
  await waitFor(() => assert.equal(f.calls.length, 2));
  assert.equal("clientSecret" in f.calls[1], false);
  cleanup();
  f.state.locked = true;
  render(<IntegrationSettings slug="alpha" kind="payment" />);
  await screen.findByText(/A checkout or payment already uses this merchant/);
  assert.ok(
    screen
      .getByRole("button", { name: "Save payment settings" })
      .hasAttribute("disabled") ||
      (
        screen.getByRole("button", {
          name: "Save payment settings",
        }) as HTMLButtonElement
      ).disabled ||
      screen
        .getByRole("button", { name: "Save payment settings" })
        .closest("fieldset")!.disabled,
  );
});

test("integration loading errors can be reloaded, changing provider kinds resets fields, and errors remain specific", async () => {
  const f = fixture("telegram");
  f.fail("unavailable");
  const view = render(<IntegrationSettings slug="alpha" kind="telegram" />);
  await screen.findByRole("alert");
  f.fail("");
  fireEvent.click(screen.getByRole("button", { name: "Reload settings" }));
  await screen.findByLabelText("Bot token");
  view.rerender(<IntegrationSettings slug="alpha" kind="payment" />);
  await screen.findByLabelText("Client ID");
  for (const code of [
    "version_conflict",
    "invalid_sms_settings",
    "sms_encoding_mismatch",
    "sms_credentials_required",
    "sms_separate_accounts_required",
    "invalid_integration_settings",
    "integration_credentials_required",
    "payment_settings_locked",
    "sandbox_forbidden_in_production",
    "production_payments_not_approved",
    "forbidden",
    "unknown",
  ])
    assert.ok(settingsError(code).length > 20);
});

test("unmounted private settings reads never repopulate a panel", async () => {
  let resolve!: (value: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((done) => {
      resolve = done;
    });
  const sms = render(<SmsSettings slug="alpha" />);
  sms.unmount();
  resolve(Response.json({ version: 0, events: [] }));
  await Promise.resolve();
  const telegram = render(<IntegrationSettings slug="alpha" kind="telegram" />);
  telegram.unmount();
  resolve(Response.json({ version: 0 }));
  await Promise.resolve();
});
