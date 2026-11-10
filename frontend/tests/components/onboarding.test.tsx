import { sampleResearchAgreement } from "@ra/contracts";
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
import { App } from "../../src/App";
import {
  paise,
  rupees,
  status,
  hostedCheckout,
} from "../../src/account/Onboarding";
import { makePage } from "../../../packages/contracts/tests/fixtures";
import type { OnboardingView, OrderView, PageData } from "@ra/contracts";
const originalFetch = globalThis.fetch,
  originalFormData = globalThis.FormData;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.FormData = originalFormData;
  delete (window as typeof window & { Cashfree?: unknown }).Cashfree;
});
/** Synthetic projections exercise UI behavior without persisting personal information in the browser. */
function fixture(admin = false) {
  const customer = {
    id: "customer-id",
    name: "Example Investor",
    email: "investor@example.test",
    status: "not_started" as const,
    mobileVerified: true,
    version: 0,
    profile: {
      fullName: "Example Investor",
      phone: "9876543210",
      pan: "ABCPD1234E",
      dob: "1990-01-01",
      documentId: "",
      familyPan: "",
      declaration: false,
    },
    reason: "",
    provider: "kfin_manual",
    checkedAt: null,
  };
  const view: OnboardingView = {
    admin,
    devSkip: true,
    signingEnabled: true,
    paymentEnabled: true,
    plans: [
      {
        id: "plan-id",
        name: "Monthly research",
        description: "Research reports",
        days: 30,
        price: 200000,
        taxBps: 0,
        active: true,
        version: 1,
      },
    ],
    coupons: [],
    settings: null,
    users: [],
    customer: admin ? null : customer,
    orders: [],
    nextCursor: null,
  };
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  let failure = "",
    loadingFailure = false,
    result: Record<string, unknown> = { id: "new-id" };
  globalThis.FormData = window.FormData;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/letterhead"))
      return Response.json({
        version: 0,
        name: "",
        pdf: null,
        sha256: null,
        margins: { top: 56, bottom: 20, left: 21, right: 21 },
      });
    if (String(url).endsWith("/jobs") || String(url).endsWith("/qr-payments"))
      return Response.json([]);
    if (init?.method === "POST") {
      const name = String(url).split("/").at(-1)!;
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      calls.push({ name, body });
      if (failure) return Response.json({ error: failure }, { status: 409 });
      return Response.json(result);
    }
    if (loadingFailure)
      return Response.json({ error: "down" }, { status: 503 });
    return Response.json(view);
  };
  const data: PageData = {
    ...makePage(),
    page: "account",
    account: {
      mode: "workspace",
      section: admin ? "plans" : "onboarding",
      role: admin ? "owner" : "subscriber",
      area: admin ? "organisation" : "investor",
      onboardingEnabled: true,
      profile: {
        name: customer.name,
        email: customer.email,
        emailVerified: true,
      },
    },
  };
  return {
    view,
    calls,
    data,
    customer,
    setFailure: (value: string) => {
      failure = value;
    },
    setLoadingFailure: (value: boolean) => {
      loadingFailure = value;
    },
    setResult: (value: Record<string, unknown>) => {
      result = value;
    },
  };
}
/** Submit the named form after filling only fields material to a given interaction. */
function submit(button: string) {
  fireEvent.submit(
    screen.getByRole("button", { name: button }).closest("form")!,
  );
}
/** Build a complete server-returned checkout snapshot. */
function order(change: Partial<OrderView> = {}): OrderView {
  return {
    id: "order-id",
    status: "quoted",
    planName: "Monthly research",
    subtotal: 200000,
    discount: 20000,
    tax: 0,
    total: 180000,
    days: 30,
    text: "Research service terms and MITC for Example Investor",
    hash: "agreement-hash",
    expiresAt: "2099-01-01T00:00:00Z",
    signedAt: null,
    startsAt: null,
    endsAt: null,
    agreementId: null,
    invoiceId: null,
    dev: true,
    ...change,
  };
}

test("investor overview and KYC collect evidence, declarations and family details; pending/verified states preserve progression", async () => {
  const f = fixture();
  const root = render(<App data={f.data} />);
  await screen.findByRole("heading", { name: "Complete your KYC" });
  fireEvent.change(
    screen.getByLabelText("PAN document (PDF, JPEG, PNG; maximum 10 MiB)"),
    {
      target: {
        files: [new File(["%PDF-1.4"], "pan.pdf", { type: "application/pdf" })],
      },
    },
  );
  await screen.findByText("PAN document uploaded.");
  fireEvent.click(
    screen.getByLabelText(
      "I confirm these identity and family details are correct and consent to their use for KYC verification.",
    ),
  );
  submit("Submit for verification");
  await waitFor(() =>
    assert.ok(f.calls.some((call) => call.name === "kyc-submit")),
  );
  const body = f.calls.find((call) => call.name === "kyc-submit")!.body;
  assert.equal(body.documentId, "new-id");
  assert.equal(body.pan, "ABCPD1234E");
  fireEvent.click(screen.getByRole("button", { name: "Skip KYC — DEV only" }));
  await waitFor(() => assert.ok(f.calls.some((call) => call.name === "skip")));
  root.unmount();
  f.view.customer = {
    ...f.customer,
    status: "pending",
    reason: "Review pending",
    checkedAt: "2026-11-08T00:00:00Z",
  };
  render(<App data={f.data} />);
  await screen.findByText("Review pending");
  assert.equal(
    screen.queryByRole("button", { name: "Submit for verification" }),
    null,
  );
  cleanup();
  f.view.customer = { ...f.customer, status: "verified" };
  f.data.account!.section = "overview";
  render(<App data={f.data} />);
  await screen.findByRole("link", { name: "Continue onboarding" });
  assert.equal(
    screen.queryByRole("heading", { name: "Choose your plan" }),
    null,
  );
});
test("admin creates/edits plans and discounts and versioned agreement settings", async () => {
  const f = fixture(true);
  f.view.coupons = [
    {
      id: "coupon-id",
      code: "TEN",
      type: "fixed",
      value: 10000,
      planId: "plan-id",
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2027-01-01T00:00:00Z",
      limit: 100,
      perUser: 1,
      active: false,
      version: 1,
    },
  ];
  f.view.settings = {
    terms: "Reviewed legal wording. ".repeat(30),
    version: 1,
    reviewed: true,
    contact: "ra@example.test",
    address: "RA office",
    gstin: "",
    annualLimit: 15100000,
  };
  render(<App data={f.data} />);
  await screen.findByRole("heading", { name: "Subscription plans" });
  fireEvent.click(
    screen.getByRole("button", { name: "Edit Monthly research" }),
  );
  submit("Save plan");
  await waitFor(() => assert.ok(f.calls.some((call) => call.name === "plan")));
  assert.equal(
    f.calls.find((call) => call.name === "plan")!.body.id,
    "plan-id",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Edit Monthly research" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "New plan" }));
  fireEvent.change(screen.getByLabelText("Plan name", { exact: true }), {
    target: { value: "New research" },
  });
  fireEvent.change(screen.getByLabelText("Base fee (INR)", { exact: true }), {
    target: { value: "1000" },
  });
  submit("Save plan");
  await waitFor(() =>
    assert.equal(f.calls.filter((call) => call.name === "plan").length, 2),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit TEN" }));
  submit("Save discount");
  await waitFor(() =>
    assert.ok(f.calls.some((call) => call.name === "coupon")),
  );
  assert.equal(
    f.calls.find((call) => call.name === "coupon")!.body.value,
    10000,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit TEN" }));
  fireEvent.click(screen.getByRole("button", { name: "New code" }));
  fireEvent.change(screen.getByLabelText("Discount code", { exact: true }), {
    target: { value: "WELCOME" },
  });
  fireEvent.change(screen.getByLabelText("Discount value", { exact: true }), {
    target: { value: "10" },
  });
  submit("Save discount");
  await waitFor(() =>
    assert.equal(f.calls.filter((call) => call.name === "coupon").length, 2),
  );
  submit("Save agreement details");
  await waitFor(() =>
    assert.ok(f.calls.some((call) => call.name === "settings")),
  );
  assert.equal(
    f.calls.find((call) => call.name === "settings")!.body.version,
    1,
  );
  const codeInput = screen.getByLabelText("Discount code", {
    exact: true,
  }) as HTMLInputElement;
  fireEvent.change(codeInput, { target: { value: "Diwali Offer" } });
  assert.equal(codeInput.validity.patternMismatch, true);
  assert.ok(
    screen.getByText(
      "For example: DIWALI10 or DIWALI-OFFER. No spaces; codes are saved in uppercase.",
    ),
  );
  f.setFailure("invalid_coupon");
  submit("Save discount");
  await screen.findByText(
    "Use 3–32 letters, numbers, hyphens or underscores for the discount code, with no spaces. For example: DIWALI10 or DIWALI-OFFER.",
  );
});
test("admin roster paginates without resetting accumulated rows and opens scoped detail; KFIN review uploads separate evidence", async () => {
  const f = fixture(true);
  f.data.account!.section = "users";
  f.view.users = [{ ...f.customer, status: "pending" }];
  f.view.nextCursor = "cursor";
  const root = render(<App data={f.data} />);
  await screen.findByRole("link", { name: "Edit user" });
  assert.ok(
    screen
      .getByRole("link", { name: "Edit user" })
      .getAttribute("href")
      ?.endsWith("/users/customer-id"),
  );
  f.view.users = [{ ...f.customer, id: "second", name: "Second Investor" }];
  f.view.nextCursor = null;
  fireEvent.click(screen.getByRole("button", { name: "Load more users" }));
  await screen.findByText("Second Investor");
  assert.ok(screen.getByRole("cell", { name: "Example Investor" }));
  root.unmount();
  f.view.customer = {
    ...f.customer,
    status: "pending",
    profile: {
      ...f.customer.profile,
      documentId: "pan-id",
      familyPan: "ZYXPQ4321A",
    },
  };
  f.data.account!.customerId = "customer-id";
  render(<App data={f.data} />);
  await screen.findByRole("heading", { name: "KFIN review" });
  const kfin = screen.getByRole("link", { name: "Open KFIN KRA" });
  assert.ok(kfin.classList.contains("button"));
  assert.ok(kfin.classList.contains("secondary"));
  assert.equal(kfin.getAttribute("target"), "_blank");
  fireEvent.change(screen.getByRole("combobox", { name: "Decision" }), {
    target: { value: "verified" },
  });
  const proofInput = screen.getByLabelText(
    "Separate KFIN verification evidence",
  ) as HTMLInputElement;
  assert.equal(proofInput.required, true);
  const reasonInput = screen.getByLabelText(
    "Reason / message to investor",
  ) as HTMLTextAreaElement;
  assert.equal(reasonInput.required, false);

  submit("Save review decision");
  await screen.findByText(
    "Upload separate KFIN verification evidence for this investor.",
  );
  assert.equal(f.calls.filter((call) => call.name === "review").length, 0);
  fireEvent.change(screen.getByRole("combobox", { name: "Decision" }), {
    target: { value: "changes" },
  });
  assert.equal(proofInput.required, false);
  assert.equal(reasonInput.required, true);
  assert.equal(reasonInput.minLength, 5);

  fireEvent.change(
    screen.getByLabelText("Separate KFIN verification evidence"),
    {
      target: {
        files: [
          new File(["%PDF-1.4"], "evidence.pdf", { type: "application/pdf" }),
        ],
      },
    },
  );
  await screen.findByText("Verification evidence uploaded.");
  fireEvent.change(screen.getByRole("combobox", { name: "Decision" }), {
    target: { value: "verified" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "KFIN result" }), {
    target: { value: "KYC VALIDATED" },
  });
  submit("Save review decision");
  await waitFor(() =>
    assert.ok(f.calls.some((call) => call.name === "review")),
  );
  assert.equal(
    f.calls.find((call) => call.name === "review")!.body.evidenceId,
    "new-id",
  );
});
test("investor quotes final price, confirms consent/code and can cancel or use explicit development signing", async () => {
  const f = fixture();
  f.view.customer = { ...f.customer, status: "verified" };
  const root = render(<App data={f.data} />);
  await screen.findByRole("heading", { name: "Choose your plan" });
  fireEvent.click(screen.getByRole("radio"));
  submit("Review final price and agreement");
  await waitFor(() => assert.ok(f.calls.some((call) => call.name === "quote")));
  assert.equal(f.calls[0].body.planId, "plan-id");
  root.unmount();
  f.view.orders = [order()];
  render(<App data={f.data} />);
  await screen.findByRole("button", { name: "Sign and continue" });
  fireEvent.click(
    screen.getByRole("button", { name: "Send email confirmation code" }),
  );
  await screen.findByText(
    "A confirmation code was sent to your verified email.",
  );
  fireEvent.change(
    screen.getByLabelText("Full name for signature", { exact: true }),
    { target: { value: "Example Investor" } },
  );
  fireEvent.change(
    screen.getByLabelText("Email confirmation code", { exact: true }),
    { target: { value: "123456" } },
  );
  fireEvent.click(
    screen.getByLabelText(
      "I have read and agree to the service terms, MITC and final payable amount.",
    ),
  );
  submit("Sign and continue");
  await waitFor(() => assert.ok(f.calls.some((call) => call.name === "sign")));
  assert.equal(
    f.calls.find((call) => call.name === "sign")!.body.hash,
    "agreement-hash",
  );
  fireEvent.click(screen.getByRole("button", { name: "Skip MITC — DEV only" }));
  await waitFor(() => assert.ok(f.calls.some((call) => call.name === "skip")));
  fireEvent.click(screen.getByRole("button", { name: "Cancel checkout" }));
  await waitFor(() =>
    assert.ok(f.calls.some((call) => call.name === "cancel")),
  );
});
test("signed/pending/paid checkouts resume payment and expose immutable agreement/invoice downloads", async () => {
  const f = fixture();
  f.view.customer = { ...f.customer, status: "verified" };
  f.view.orders = [
    order({
      status: "signed",
      signedAt: "2026-11-08T00:00:00Z",
      agreementId: "agreement-id",
    }),
  ];
  f.setResult({ session: "session", mode: "sandbox" });
  let checkout: unknown;
  (window as typeof window & { Cashfree: unknown }).Cashfree = () => ({
    checkout: async (value: unknown) => {
      checkout = value;
    },
  });
  const root = render(<App data={f.data} />);
  await screen.findByRole("button", { name: "Pay with Cashfree" });
  fireEvent.click(screen.getByRole("button", { name: "Pay with Cashfree" }));
  await waitFor(() => assert.ok(checkout));
  root.unmount();
  f.view.orders = [
    order({
      status: "payment_pending",
      agreementId: "agreement-id",
      signedAt: "2026-11-08T00:00:00Z",
    }),
  ];
  f.setResult({ paid: false });
  render(<App data={f.data} />);
  await screen.findByRole("button", { name: "Check payment status" });
  fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
  await screen.findByRole("alert");
  f.setResult({ paid: true });
  fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
  await screen.findByText("Payment confirmed.");
  cleanup();
  f.view.orders = [
    order({
      status: "paid",
      agreementId: "agreement-id",
      invoiceId: "invoice-id",
      signedAt: "2026-11-08T00:00:00Z",
      startsAt: "2026-11-08T00:00:00Z",
      endsAt: "2099-01-01T00:00:00Z",
    }),
    order({
      id: "old-order",
      status: "paid",
      invoiceId: null,
      startsAt: "2020-01-01T00:00:00Z",
      endsAt: "2020-02-01T00:00:00Z",
    }),
  ];
  render(<App data={f.data} />);
  await screen.findByRole("link", { name: "Download invoice" });
  assert.ok(
    screen
      .getByRole("link", { name: "Download signed agreement" })
      .getAttribute("href")
      ?.includes("agreement-id"),
  );
  await screen.findByText(
    "Your invoice and email are being prepared. Refresh shortly to download your documents.",
  );
  cleanup();
  f.view.orders = [order({ status: "signed", total: 0 })];
  f.view.paymentEnabled = false;
  f.setResult({ paid: true });
  render(<App data={f.data} />);
  await screen.findByRole("button", { name: "Confirm no-charge subscription" });
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm no-charge subscription" }),
  );
  await waitFor(() =>
    assert.ok(f.calls.filter((call) => call.name === "payment").length >= 2),
  );
});
test("loading failures and action conflicts recover; Hindi, empty, disabled and expired states remain accessible", async () => {
  const f = fixture();
  f.setLoadingFailure(true);
  const root = render(<App data={f.data} />);
  await screen.findByRole("alert");

  f.setLoadingFailure(false);
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await screen.findByText("Status refreshed.");

  f.setFailure("version_conflict");
  fireEvent.click(screen.getByRole("button", { name: "Skip KYC — DEV only" }));
  await screen.findByText(
    "This record changed. Refresh and review it before saving again.",
  );

  root.unmount();
  f.setFailure("unknown");
  f.view.customer = { ...f.customer, status: "verified" };
  f.view.orders = [
    order({ expiresAt: "2000-01-01T00:00:00Z", status: "signed" }),
  ];
  f.view.paymentEnabled = false;
  f.view.devSkip = false;
  f.data.locale = "hi";
  render(<App data={f.data} />);
  await screen.findByRole("heading", { name: "आपकी निवेशक यात्रा" });
  assert.equal(
    screen.queryByRole("button", { name: "Skip KYC — DEV only" }),
    null,
  );

  cleanup();
  f.view.admin = true;
  f.view.customer = null;
  f.view.users = [];
  f.data.account!.role = "owner";
  f.data.account!.section = "users";
  f.data.account!.area = "organisation";
  render(<App data={f.data} />);
  await screen.findByText("अभी कोई निवेशक नहीं है।");

  assert.equal(status("unknown", false), "unknown");
  assert.equal(paise("10.25"), 1025);
  assert.throws(() => paise("bad"));
  assert.throws(() => paise(null));
  assert.ok(rupees(100).includes("1.00"));
});
test("hosted SDK loading handles network errors and rejects a script that does not provide Cashfree", async () => {
  const failed = hostedCheckout("session", "sandbox");
  const script = document.querySelector(
    'script[src="https://sdk.cashfree.com/js/v3/cashfree.js"]',
  ) as HTMLScriptElement;
  script.onerror!(new Event("error"));
  await assert.rejects(failed, /payments_unavailable/);

  const missing = hostedCheckout("session", "sandbox");
  const next = document.querySelector(
    'script[src="https://sdk.cashfree.com/js/v3/cashfree.js"]',
  ) as HTMLScriptElement;
  next.onload!(new Event("load"));
  await assert.rejects(missing, /payments_unavailable/);
  next.remove();
});

test("English and Hindi cover every published/admin/detail and investor progression state", async () => {
  for (const hi of [false, true]) {
    for (const scene of [
      "plans-empty",
      "plans-configured",
      "users-empty",
      "users-list",
      "detail-pending",
      "detail-changes",
      "investor-empty",
      "investor-quoted",
      "investor-signed",
      "investor-expired",
      "investor-paid",
      "overview",
    ]) {
      const admin =
          scene.startsWith("plans") ||
          scene.startsWith("users") ||
          scene.startsWith("detail"),
        f = fixture(admin);
      f.data.locale = hi ? "hi" : "en";
      if (scene === "plans-empty") {
        f.view.plans = [];
      }
      if (scene === "plans-configured") {
        f.view.plans[0].active = false;
        f.view.coupons = [
          {
            id: "c",
            code: "WELCOME",
            type: "percent",
            value: 10,
            planId: null,
            startsAt: "2026-01-01T00:00:00Z",
            endsAt: "2027-01-01T00:00:00Z",
            limit: 1,
            perUser: 1,
            active: true,
            version: 1,
          },
        ];
        f.view.settings = {
          terms: "Research services",
          version: 2,
          reviewed: false,
          contact: "ra@example.test",
          address: "Address",
          gstin: "",
          annualLimit: 15100000,
        };
      }
      if (scene.startsWith("users") || scene.startsWith("detail"))
        f.data.account!.section = "users";
      if (scene === "users-list") {
        f.view.users = [
          {
            ...f.customer,
            profile: { ...f.customer.profile, phone: "", pan: "" },
          },
        ];
        f.view.nextCursor = "cursor";
      }
      if (scene.startsWith("detail")) {
        f.data.account!.customerId = "customer-id";
        f.view.customer = {
          ...f.customer,
          status: scene === "detail-pending" ? "pending" : "changes",
          reason: "Please correct details",
          checkedAt: "2026-11-08T00:00:00Z",
          profile: {
            ...f.customer.profile,
            documentId: "pan-document",
            familyPan: f.customer.profile.pan,
            declaration: true,
          },
        };
      }
      if (scene === "investor-empty") {
        f.view.customer = { ...f.customer, status: "verified" };
        f.view.plans = [];
      }
      if (scene === "investor-quoted") {
        f.view.customer = { ...f.customer, status: "verified" };
        f.view.signingEnabled = false;
        f.view.orders = [order({ dev: false })];
      }
      if (scene === "investor-signed") {
        f.view.customer = { ...f.customer, status: "skipped_dev" };
        f.view.orders = [
          order({ status: "signed", signedAt: "2026-11-08T00:00:00Z" }),
        ];
        f.view.paymentEnabled = false;
      }
      if (scene === "investor-expired") {
        f.view.customer = { ...f.customer, status: "verified" };
        f.view.orders = [
          order({ status: "quoted", expiresAt: "2000-01-01T00:00:00Z" }),
        ];
      }
      if (scene === "investor-paid") {
        f.view.customer = { ...f.customer, status: "verified" };
        f.view.orders = [
          order({
            status: "paid",
            startsAt: null,
            endsAt: null,
            invoiceId: null,
          }),
        ];
      }
      if (scene === "overview") {
        f.data.account!.section = "overview";
      }
      const root = render(<App data={f.data} />);
      await waitFor(() =>
        assert.ok(
          screen.queryByText(/Loading your workspace|लोड हो रहा/) === null,
        ),
      );
      assert.ok(screen.getByRole("heading", { level: 1 }));
      root.unmount();
    }
  }
});

test("agreement editor prefills an unreviewed sample, preserves custom saved wording and clears approval when wording changes", async () => {
  const f = fixture(true);
  const root = render(<App data={f.data} />);
  const terms = (await screen.findByLabelText("Approved terms and MITC", {
    exact: true,
  })) as HTMLTextAreaElement;
  assert.equal(terms.value, sampleResearchAgreement);
  const reviewed = screen.getByLabelText(
    "These research-service terms and MITC have been reviewed and approved.",
  ) as HTMLInputElement;
  assert.equal(reviewed.checked, false);
  fireEvent.change(screen.getByLabelText("Contact details", { exact: true }), {
    target: { value: "ra@example.test" },
  });
  fireEvent.click(reviewed);
  fireEvent.change(terms, {
    target: { value: "Custom RA terms. ".repeat(40) },
  });
  assert.equal(reviewed.checked, false);
  fireEvent.click(reviewed);
  fireEvent.click(
    screen.getByRole("button", { name: "Load sample agreement" }),
  );
  assert.equal(terms.value, sampleResearchAgreement);
  assert.equal(reviewed.checked, false);
  assert.equal(
    (
      screen.getByLabelText("Contact details", {
        exact: true,
      }) as HTMLInputElement
    ).value,
    "ra@example.test",
  );
  submit("Save agreement details");
  await waitFor(() =>
    assert.ok(f.calls.some((call) => call.name === "settings")),
  );
  const saved = f.calls.find((call) => call.name === "settings")!.body;
  assert.equal(saved.terms, sampleResearchAgreement);
  assert.equal(saved.reviewed, false);
  root.unmount();
  f.view.settings = {
    terms: "Existing approved custom agreement. ".repeat(30),
    version: 3,
    reviewed: true,
    contact: "existing@example.test",
    address: "RA office",
    gstin: "",
    annualLimit: 15100000,
  };
  render(<App data={f.data} />);
  const custom = (await screen.findByLabelText("Approved terms and MITC", {
    exact: true,
  })) as HTMLTextAreaElement;
  assert.equal(custom.value, f.view.settings.terms);
  assert.equal(
    (
      screen.getByLabelText(
        "These research-service terms and MITC have been reviewed and approved.",
      ) as HTMLInputElement
    ).checked,
    true,
  );
});

test("investors read the letterhead PDF inline before consent, with an optional text fallback in both languages", async () => {
  for (const hi of [false, true]) {
    const f = fixture();
    f.data.locale = hi ? "hi" : "en";
    f.view.orders = [order()];
    render(<App data={f.data} />);
    const frame = await screen.findByRole("region", {
      name: hi ? "अनुबंध और MITC के पृष्ठ" : "Agreement and MITC pages",
    });
    assert.ok(frame.closest("details")?.hasAttribute("open"));
    const fallback = screen
      .getByText("Research service terms and MITC for Example Investor")
      .closest("details");
    assert.equal(fallback?.hasAttribute("open"), false);
    assert.ok(
      screen.getByRole("link", {
        name: hi
          ? "अनुबंध PDF नई विंडो में खोलें"
          : "Open agreement PDF in a new tab",
      }),
    );
    cleanup();
  }
});

test("new checkouts submit the selected visual signature with the unchanged email verification fields", async () => {
  const f = fixture();
  f.view.orders = [
    order({ signatureBox: { x: 355, y: 686, width: 180, height: 54 } }),
  ];
  render(<App data={f.data} />);
  const name = await screen.findByLabelText("Full name for signature");
  fireEvent.change(name, { target: { value: "Example Investor" } });
  fireEvent.change(screen.getByLabelText("Signature font"), {
    target: { value: "caveat" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I have read and agree/ }),
  );
  fireEvent.change(screen.getByLabelText("Email confirmation code"), {
    target: { value: "123456" },
  });
  submit("Sign and continue");
  await waitFor(() => assert.ok(f.calls.some((call) => call.name === "sign")));
  assert.deepEqual(f.calls.find((call) => call.name === "sign")!.body.mark, {
    mode: "typed",
    font: "caveat",
  });
});
