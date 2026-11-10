import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import {
  MobileVerification,
  smsError,
} from "../../src/account/MobileVerification";
import { SmsRecovery } from "../../src/account/SmsRecovery";
const originalFetch = globalThis.fetch,
  originalFormData = globalThis.FormData;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.FormData = originalFormData;
});

/** Capture browser requests while controlling server-owned verification and failures. */
function mobileFixture() {
  globalThis.FormData = window.FormData;
  const state = {
    mobile: "9599400141",
    verified: false,
    recoveryEnabled: false,
    recoveryMobile: "******0141",
  };
  const calls: { action: string; body: Record<string, unknown> }[] = [];
  let failure = "",
    uncertain = false;
  globalThis.fetch = async (url, init) => {
    const action = String(url).split("/").at(-1)!;
    if (failure) return Response.json({ error: failure }, { status: 409 });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ action, body });
    if (action === "verify") state.verified = true;
    if (action === "recovery-contact") state.recoveryEnabled = body.enabled;
    if (action === "send")
      return Response.json({
        challengeId: "challenge",
        retryAfter: 60,
        expiresIn: 300,
        sendsRemaining: 2,
        attemptsRemaining: 5,
        deliveryUncertain: uncertain,
      });
    return Response.json(state);
  };
  return {
    state,
    calls,
    fail: (value: string) => {
      failure = value;
    },
    uncertain: () => {
      uncertain = true;
    },
  };
}

test("mobile verification requests OTP, counts down, verifies and explicitly enables/disables recovery without retaining passwords", async (context) => {
  const f = mobileFixture();
  let verified = 0;
  context.mock.timers.enable({ apis: ["setInterval"] });
  render(
    <MobileVerification
      slug="alpha"
      hi={false}
      onVerified={() => {
        verified++;
      }}
    />,
  );
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: "Send mobile code" })
        .hasAttribute("disabled"),
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText("Mobile number"), {
    target: { value: "+919599400141" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Send mobile code" }).closest("form")!,
  );
  await screen.findByLabelText("Six-digit mobile code");
  assert.equal(
    f.calls.find((call) => call.action === "send")!.body.mobile,
    "+919599400141",
  );
  assert.ok(
    screen
      .getByRole("button", { name: "Resend in 60s" })
      .hasAttribute("disabled"),
  );
  await act(async () => context.mock.timers.tick(61000));
  fireEvent.change(screen.getByLabelText("Six-digit mobile code"), {
    target: { value: "123456" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Verify mobile" }).closest("form")!,
  );
  await screen.findByLabelText("Current password");
  assert.equal(verified, 1);
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "secret-password" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Enable SMS recovery" })
      .closest("form")!,
  );
  await screen.findByRole("button", { name: "Disable SMS recovery" });
  assert.equal(
    (screen.getByLabelText("Current password") as HTMLInputElement).value,
    "",
  );
  assert.ok(screen.getByText(/Recovery mobile:/));
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "secret-password" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Disable SMS recovery" })
      .closest("form")!,
  );
  await screen.findByRole("button", { name: "Enable SMS recovery" });
});

test("mobile errors retain uncertain codes, count guesses and localize failure and expiry states", async (context) => {
  const f = mobileFixture();
  f.uncertain();
  context.mock.timers.enable({ apis: ["setInterval"] });
  render(<MobileVerification slug="alpha" hi={true} onVerified={() => {}} />);
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: "कोड भेजें" })
        .hasAttribute("disabled"),
      false,
    ),
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "कोड भेजें" }).closest("form")!,
  );
  await screen.findByLabelText("छह अंकों का कोड");
  assert.ok(screen.getByText(/डिलीवरी की पुष्टि नहीं हुई/));
  f.fail("invalid_or_expired_sms_code");
  fireEvent.change(screen.getByLabelText("छह अंकों का कोड"), {
    target: { value: "000000" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "मोबाइल सत्यापित करें" })
      .closest("form")!,
  );
  await screen.findByRole("alert");
  await act(async () => context.mock.timers.tick(301000));
  assert.ok(
    screen
      .getByRole("button", { name: "मोबाइल सत्यापित करें" })
      .hasAttribute("disabled"),
  );
  fireEvent.change(screen.getByLabelText("मोबाइल नंबर"), {
    target: { value: "9876543210" },
  });
  assert.equal(screen.queryByLabelText("छह अंकों का कोड"), null);
  f.fail("sms_trial_destination");
  fireEvent.submit(
    screen.getByRole("button", { name: "कोड भेजें" }).closest("form")!,
  );
  await screen.findByText(/परीक्षण एसएमएस/);
});

test("mobile initial failures and recovery enrollment failures are visible, including English and Hindi feedback", async () => {
  const f = mobileFixture();
  f.fail("sms_unavailable");
  render(<MobileVerification slug="alpha" hi={false} onVerified={() => {}} />);
  await screen.findByRole("alert");
  cleanup();
  f.fail("");
  f.state.verified = true;
  render(<MobileVerification slug="alpha" hi={true} onVerified={() => {}} />);
  await screen.findByLabelText("वर्तमान पासवर्ड");
  f.fail("invalid_password");
  fireEvent.change(screen.getByLabelText("वर्तमान पासवर्ड"), {
    target: { value: "wrong-password" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "एसएमएस रिकवरी सक्षम करें" })
      .closest("form")!,
  );
  await screen.findByRole("alert");
  assert.equal(
    (screen.getByLabelText("वर्तमान पासवर्ड") as HTMLInputElement).value,
    "",
  );
  cleanup();
  f.fail("");
  f.state.recoveryEnabled = true;
  render(<MobileVerification slug="alpha" hi={true} onVerified={() => {}} />);
  await screen.findByRole("button", { name: "एसएमएस रिकवरी बंद करें" });
  for (const code of [
    "invalid_mobile",
    "sms_trial_destination",
    "sms_rate_limited",
    "invalid_or_expired_sms_code",
    "invalid_password",
    "recovery_not_eligible",
    "recovery_mobile_unavailable",
    "version_conflict",
    "invalid_sms_settings",
    "sms_delivery_uncertain",
    "unknown",
  ])
    for (const hi of [false, true]) assert.ok(smsError(code, hi).length > 10);
});

test("SMS recovery never accepts a destination number, submits code and matching new password and supports retry and localized errors", async (context) => {
  context.mock.timers.enable({
    apis: ["Date", "setInterval"],
    now: new Date("2026-11-09T00:00:00Z"),
  });
  const f = mobileFixture();
  render(<SmsRecovery slug="alpha" hi={false} />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "investor@test.local" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Request recovery code" })
      .closest("form")!,
  );
  await screen.findByLabelText("SMS code");
  assert.equal(screen.queryByLabelText("Mobile number"), null);
  f.fail("invalid_or_expired_sms_code");
  fireEvent.change(screen.getByLabelText("SMS code"), {
    target: { value: "123456" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-password-123" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "new-password-123" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Reset password with code" })
      .closest("form")!,
  );
  await screen.findByRole("alert");
  f.fail("");
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  await act(async () => context.mock.timers.tick(60000));
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Request recovery code" })
      .closest("form")!,
  );
  await screen.findByLabelText("SMS code");
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Reset password with code" })
      .closest("form")!,
  );
  await screen.findByText(/Password changed/);
  cleanup();
  render(<SmsRecovery slug="alpha" hi={true} />);
  fireEvent.submit(
    screen.getByRole("button", { name: "रिकवरी कोड माँगें" }).closest("form")!,
  );
  await screen.findByLabelText("एसएमएस कोड");
  fireEvent.submit(
    screen.getByRole("button", { name: "पासवर्ड रीसेट करें" }).closest("form")!,
  );
  await screen.findByText(/पासवर्ड बदल गया/);
});

test("SMS recovery offers email from the start, enforces cooldown and directs to email after three requests without losing the last code", async (context) => {
  context.mock.timers.enable({
    apis: ["Date", "setInterval"],
    now: new Date("2026-11-09T00:00:00Z"),
  });
  const f = mobileFixture();
  render(<SmsRecovery slug="alpha" hi={false} />);
  assert.equal(
    screen
      .getByRole("link", { name: "Use email recovery" })
      .getAttribute("href"),
    "#account-email",
  );
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "investor@example.test" },
  });
  for (let i = 0; i < 3; i++) {
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Request recovery code" })
        .closest("form")!,
    );
    await screen.findByLabelText("SMS code");
    if (i === 2) assert.ok(screen.getByText(/You have requested 3 SMS codes/));
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    assert.ok(
      screen
        .getByRole("button", { name: "Request code in 60s" })
        .hasAttribute("disabled"),
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Request code in 60s" })
        .closest("form")!,
    );
    assert.equal(
      f.calls.filter((call) => call.action === "send").length,
      i + 1,
    );
    await act(async () => context.mock.timers.tick(60000));
  }
  assert.ok(
    screen
      .getByRole("button", { name: "Request recovery code" })
      .hasAttribute("disabled"),
  );
  assert.equal(f.calls.filter((call) => call.action === "send").length, 3);
  await act(async () => context.mock.timers.tick(86400000));
  assert.equal(
    screen
      .getByRole("button", { name: "Request recovery code" })
      .hasAttribute("disabled"),
    false,
  );
  cleanup();
  render(<SmsRecovery slug="alpha" hi={true} />);
  for (let i = 0; i < 3; i++) {
    fireEvent.submit(
      screen
        .getByRole("button", { name: "रिकवरी कोड माँगें" })
        .closest("form")!,
    );
    await screen.findByLabelText("एसएमएस कोड");
    fireEvent.click(screen.getByRole("button", { name: "फिर शुरू करें" }));
    await act(async () => context.mock.timers.tick(60000));
  }
  assert.ok(screen.getByText(/3 एसएमएस कोड/));
  assert.ok(screen.getByRole("link", { name: "ईमेल से पासवर्ड रीसेट करें" }));
});

test("verified mobiles hide the send-code form on load and after verification; changing a number is explicit and cancellable", async () => {
  const f = mobileFixture();
  f.state.verified = true;
  render(<MobileVerification slug="alpha" hi={false} onVerified={() => {}} />);
  assert.equal(screen.queryByLabelText("Mobile number"), null);
  await screen.findByRole("heading", { name: "Mobile verified" });
  assert.equal(
    screen.queryByRole("button", { name: "Send mobile code" }),
    null,
  );
  assert.equal(screen.queryByLabelText("Mobile number"), null);
  assert.ok(screen.getByText(/This is separate from KYC/));
  fireEvent.click(screen.getByRole("button", { name: "Change mobile number" }));
  fireEvent.change(screen.getByLabelText("Mobile number"), {
    target: { value: "9876543210" },
  });
  assert.ok(screen.getByRole("button", { name: "Send mobile code" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel number change" }));
  assert.equal(screen.queryByLabelText("Mobile number"), null);
  assert.equal(f.calls.filter((entry) => entry.action === "send").length, 0);
  cleanup();
  render(<MobileVerification slug="alpha" hi={true} onVerified={() => {}} />);
  await screen.findByRole("heading", { name: "मोबाइल सत्यापित है" });
  fireEvent.click(screen.getByRole("button", { name: "मोबाइल नंबर बदलें" }));
  fireEvent.click(screen.getByRole("button", { name: "नंबर बदलना रद्द करें" }));
  assert.equal(screen.queryByRole("button", { name: "कोड भेजें" }), null);
});
