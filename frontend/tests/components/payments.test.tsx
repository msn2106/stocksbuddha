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
import type { OnboardingView, OrderView } from "@ra/contracts";
import {
  PaymentChooser,
  QrReviewQueue,
  paymentFile,
} from "../../src/account/Payments";
import { PaymentSettings } from "../../src/websites/PaymentSettings";
const originalFetch = globalThis.fetch,
  originalForm = globalThis.FormData,
  originalReader = globalThis.FileReader;
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const api = "/api/workspaces/alpha/onboarding";
const config = {
  version: 1,
  enabled: true,
  payee: "Alpha Research",
  upiId: "alpha@bank",
  instructions: "Check payee",
  image,
};
const order = {
  id: "order",
  status: "signed",
  total: 200000,
  expiresAt: "2099-01-01",
  dev: false,
} as OrderView;
const view = { qrEnabled: true, paymentEnabled: true } as OnboardingView;
const started = {
  orderId: "order",
  total: 200000,
  config,
  status: "started",
  version: 1,
  reference: "",
  paidAt: null,
  reason: "",
};
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.FormData = originalForm;
  globalThis.FileReader = originalReader;
});
/** Collect action outcomes while matching the parent's busy/error boundary. */
function controls() {
  const calls: { name: string; body: Record<string, unknown> }[] = [],
    failures: unknown[] = [],
    sessions: string[] = [];
  const action = async (name: string, body: Record<string, unknown>) => {
    calls.push({ name, body });
    return name === "payment"
      ? { session: "session", mode: "sandbox" }
      : { paid: true };
  };
  const run = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (error) {
      failures.push(error);
    }
  };
  const checkout = async (session: string) => {
    sessions.push(session);
  };
  return { calls, action, run, failures, checkout, sessions };
}
/** Use the same file-reading and form APIs as the browser. */
function files() {
  globalThis.FormData = window.FormData;
  globalThis.FileReader = window.FileReader;
}

test("investor selects QR by default, can choose Cashfree, and unavailable methods remain disabled", async () => {
  const f = controls();
  const rendered = render(
    <PaymentChooser
      order={order}
      view={view}
      api={api}
      hi={false}
      pending={false}
      {...f}
    />,
  );
  assert.equal(
    (screen.getByRole("radio", { name: /QR Code/ }) as HTMLInputElement)
      .checked,
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show QR and pay" }));
  await waitFor(() => assert.equal(f.calls[0].name, "qr-start"));
  fireEvent.click(screen.getByRole("radio", { name: /Cashfree/ }));
  fireEvent.click(screen.getByRole("radio", { name: /QR Code/ }));
  fireEvent.click(screen.getByRole("radio", { name: /Cashfree/ }));
  fireEvent.click(screen.getByRole("button", { name: "Pay with Cashfree" }));
  await waitFor(() => assert.deepEqual(f.sessions, ["session"]));
  rendered.unmount();
  render(
    <PaymentChooser
      order={{ ...order, status: "payment_pending", paymentMethod: "cashfree" }}
      view={view}
      api={api}
      hi
      pending={false}
      {...f}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
  await waitFor(() => assert.equal(f.calls.at(-1)!.name, "confirm"));
  cleanup();
  render(
    <PaymentChooser
      order={order}
      view={{ ...view, qrEnabled: false, paymentEnabled: false }}
      api={api}
      hi={false}
      pending={false}
      {...f}
    />,
  );
  assert.equal(
    (screen.getByRole("radio", { name: /QR Code/ }) as HTMLInputElement)
      .disabled,
    true,
  );
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Pay with Cashfree",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
});

test("expired and free checkouts preserve boundaries; failed provider confirmation is surfaced", async () => {
  const f = controls();
  render(
    <PaymentChooser
      order={{ ...order, expiresAt: "2000-01-01" }}
      view={view}
      api={api}
      hi
      pending={false}
      {...f}
    />,
  );
  assert.equal(
    (
      screen.getByRole("button", {
        name: "QR दिखाएँ और भुगतान करें",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  cleanup();
  render(
    <PaymentChooser
      order={{ ...order, total: 0 }}
      view={view}
      api={api}
      hi={false}
      pending={false}
      {...f}
    />,
  );
  assert.equal(screen.queryByRole("radio"), null);
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm no-charge subscription" }),
  );
  await waitFor(() => assert.equal(f.calls[0].name, "payment"));
  cleanup();
  render(
    <PaymentChooser
      order={{ ...order, status: "payment_pending" }}
      view={view}
      api={api}
      hi={false}
      pending={false}
      {...f}
      action={async () => ({ paid: false })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
  await waitFor(() =>
    assert.match(String(f.failures[0]), /payment_in_progress/),
  );
  cleanup();
  render(
    <PaymentChooser
      order={{ ...order, status: "cancelled" }}
      view={view}
      api={api}
      hi={false}
      pending={false}
      {...f}
    />,
  );
  assert.equal(screen.queryByRole("button"), null);
});

test("investor recovers QR instructions, submits proof after expiry and sees manual review without a second payment action", async () => {
  files();
  const f = controls();
  let fail = true,
    payment = { ...started };
  globalThis.fetch = async () =>
    fail
      ? Response.json({ error: "offline" }, { status: 503 })
      : Response.json(payment);
  render(
    <PaymentChooser
      order={{
        ...order,
        status: "payment_pending",
        paymentMethod: "qr",
        dev: true,
        expiresAt: "2000-01-01",
      }}
      view={view}
      api={api}
      hi={false}
      pending={false}
      {...f}
      action={async (name, body) => {
        f.calls.push({ name, body });
        payment = {
          ...payment,
          status: "submitted",
          reference: String(body.reference),
        };
        return {};
      }}
    />,
  );
  await screen.findByRole("alert");
  fail = false;
  fireEvent.click(
    screen.getByRole("button", { name: "Retry payment details" }),
  );
  await screen.findByText("Alpha Research");
  assert.ok(screen.getByText(/checkout window has ended/));
  assert.equal(
    screen.queryByRole("button", { name: "Pay with Cashfree" }),
    null,
  );
  fireEvent.change(screen.getByLabelText("UTR / transaction reference"), {
    target: { value: "123456789012" },
  });
  fireEvent.change(screen.getByLabelText("Payment date and time"), {
    target: { value: "2026-11-10T12:00" },
  });
  fireEvent.change(screen.getByLabelText(/Payment proof/), {
    target: {
      files: [
        new window.File(["%PDF-1.4"], "proof.pdf", { type: "application/pdf" }),
      ],
    },
  });
  globalThis.FormData = class extends window.FormData {
    override get(name: string) {
      return name === "proof"
        ? new window.File(["%PDF-1.4"], "proof.pdf", {
            type: "application/pdf",
          })
        : super.get(name);
    }
  };
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Submit payment proof" })
      .closest("form")!,
  );
  await screen.findByText("Awaiting payment verification");
  assert.match(String(f.calls[0].body.proof), /^data:application\/pdf;base64,/);
  assert.equal(
    screen.queryByRole("button", { name: "Submit payment proof" }),
    null,
  );
  cleanup();
  globalThis.fetch = async () =>
    Response.json({
      ...payment,
      status: "rejected",
      reason: "No payment received",
    });
  render(
    <PaymentChooser
      order={{ ...order, status: "cancelled", paymentMethod: "qr" }}
      view={view}
      api={api}
      hi={false}
      pending={false}
      {...f}
    />,
  );
  await screen.findByText("Payment claim closed");
  assert.ok(screen.getByText("No payment received"));
});

test("local payment files reject invalid types and sizes, and support raster uploads", async () => {
  files();
  await assert.rejects(
    paymentFile(new window.File(["svg"], "qr.svg", { type: "image/svg+xml" })),
    /invalid_payment_file/,
  );
  await assert.rejects(
    paymentFile(
      new window.File([new Uint8Array(1048577)], "qr.png", {
        type: "image/png",
      }),
    ),
    /invalid_payment_file/,
  );
  assert.match(
    await paymentFile(
      new window.File(["image"], "qr.jpg", { type: "image/jpeg" }),
    ),
    /^data:image\/jpeg;base64,/,
  );
});

test("RA QR settings save, preview and removal remain independent of locked merchant credentials and dirty guards", async () => {
  files();
  let saved = { ...config },
    fail = false;
  const bodies: Record<string, unknown>[] = [],
    dirty: boolean[] = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).endsWith("/qr-settings"))
      return Response.json({
        version: 1,
        configured: true,
        locked: true,
        clientId: "TEST_merchant",
        mode: "sandbox",
      });
    if (fail)
      return Response.json({ error: "version_conflict" }, { status: 409 });
    if (init) {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      saved = {
        ...body,
        image: body.removeImage ? "" : body.image,
        version: saved.version + 1,
      };
    }
    return Response.json(saved);
  };
  render(
    <PaymentSettings
      slug="alpha"
      onDirtyChange={(value) => dirty.push(value)}
      onBusyChange={() => {}}
    />,
  );
  await screen.findByLabelText("Payee name");
  await screen.findByLabelText("Client ID");
  assert.equal(screen.getByLabelText("Client ID").matches(":disabled"), true);
  fireEvent.change(screen.getByLabelText("UPI ID"), {
    target: { value: "updated@bank" },
  });
  fireEvent.change(screen.getByLabelText("Payment instructions"), {
    target: { value: "Check account name" },
  });
  fireEvent.click(screen.getByLabelText("Enable QR payments"));
  fireEvent.click(screen.getByLabelText("Enable QR payments"));
  fireEvent.change(screen.getByLabelText("Payee name"), {
    target: { value: "Updated Research" },
  });
  await waitFor(() => assert.equal(dirty.at(-1), true));
  fireEvent.submit(
    screen.getByRole("button", { name: "Save QR settings" }).closest("form")!,
  );
  await screen.findByText("QR payment settings saved.");
  assert.equal(bodies[0].payee, "Updated Research");
  assert.equal(dirty.at(-1), false);
  fireEvent.click(screen.getByRole("button", { name: "Remove QR image" }));
  assert.equal(
    (screen.getByLabelText("Enable QR payments") as HTMLInputElement).checked,
    false,
  );
  assert.equal(screen.queryByAltText("Saved RA payment QR preview"), null);
  fail = true;
  fireEvent.submit(
    screen.getByRole("button", { name: "Save QR settings" }).closest("form")!,
  );
  await screen.findByRole("alert");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Reload QR settings" }));
  await screen.findByAltText("Saved RA payment QR preview");
  fireEvent.change(screen.getByLabelText(/Upload QR code/), {
    target: {
      files: [new window.File(["bad"], "bad.svg", { type: "image/svg+xml" })],
    },
  });
  await screen.findByText(/Use a valid PNG or JPEG/);
});

test("RA review queue recovers, downloads proof, records bank confirmation and prevents approval without proof", async () => {
  files();
  const f = controls(),
    bodies: Record<string, unknown>[] = [];
  let fail = true,
    payment = {
      ...started,
      status: "submitted",
      version: 2,
      reference: "123456789012",
      paidAt: "2026-11-10T00:00:00Z",
    },
    empty = false;
  globalThis.fetch = async (url, init) => {
    if (fail) return Response.json({ error: "down" }, { status: 503 });
    if (init) {
      bodies.push(JSON.parse(String(init.body)));
      empty = true;
      return Response.json({ ok: true });
    }
    return Response.json(
      String(url).endsWith("/qr-payments")
        ? empty
          ? []
          : [
              {
                orderId: "order",
                status: payment.status,
                total: 200000,
                customerId: "investor",
                createdAt: "2026-11-10",
                version: payment.version,
              },
            ]
        : payment,
    );
  };
  render(<QrReviewQueue api={api} run={f.run} pending={false} />);
  await screen.findByRole("alert");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Reload reviews" }));
  await screen.findByText("Proof submitted");
  fireEvent.click(screen.getByRole("button", { name: "Refresh QR reviews" }));
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: "Refresh QR reviews" })
        .hasAttribute("disabled"),
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review payment" }));
  await screen.findByRole("link", { name: "Download payment proof" });
  assert.equal(
    screen.getByRole("link", { name: "View investor" }).getAttribute("href"),
    "/ra/alpha/workspace/users/investor",
  );
  fireEvent.change(
    screen.getByLabelText("Review reason / bank verification note"),
    { target: { value: "Received exact amount" } },
  );
  fireEvent.click(screen.getByLabelText(/I checked the receiving bank/));
  const button = screen.getByRole("button", {
    name: "Approve received payment",
  });
  fireEvent(
    button.closest("form")!,
    new window.SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: button,
    }),
  );
  await screen.findByText("No QR payments awaiting review.");
  assert.equal(bodies[0].approve, true);
  assert.equal(bodies[0].fundsChecked, true);
  cleanup();
  empty = false;
  payment = { ...payment, status: "started", reference: "" };
  render(<QrReviewQueue api={api} run={f.run} pending={false} />);
  await screen.findByText("Awaiting investor proof");
  fireEvent.click(screen.getByRole("button", { name: "Review payment" }));
  await screen.findByText(/UTR: Not submitted/);
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Approve received payment",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Close review" }));
  assert.equal(
    screen.queryByRole("button", { name: "Approve received payment" }),
    null,
  );
});

test("QR settings recover from initial load failure and save uploaded replacements and removal", async () => {
  files();
  let fail = true,
    settings = { ...config, enabled: false, image: "" };
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).endsWith("/qr-settings"))
      return Response.json({ version: 0, configured: false });
    if (fail) return Response.json({}, { status: 503 });
    if (init) {
      const data = JSON.parse(String(init.body));
      bodies.push(data);
      settings = { ...data, version: settings.version + 1 };
    }
    return Response.json(settings);
  };
  render(
    <PaymentSettings
      slug="alpha"
      onDirtyChange={() => {}}
      onBusyChange={() => {}}
    />,
  );
  await screen.findByText("Reload QR settings to continue.");
  // A failed reload remains recoverable.
  fireEvent.click(screen.getByRole("button", { name: "Reload QR settings" }));
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: "Reload QR settings" })
        .closest("section")!
        .getAttribute("aria-busy"),
      "false",
    ),
  );
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Reload QR settings" }));
  await screen.findByLabelText("Payee name");
  fireEvent.change(screen.getByLabelText(/Upload QR code/), {
    target: { files: [] },
  });
  fireEvent.change(screen.getByLabelText(/Upload QR code/), {
    target: {
      files: [
        new window.File(["synthetic image"], "qr.png", { type: "image/png" }),
      ],
    },
  });
  await screen.findByAltText("Saved RA payment QR preview");
  fireEvent.click(screen.getByLabelText("Enable QR payments"));
  fireEvent.submit(
    screen.getByRole("button", { name: "Save QR settings" }).closest("form")!,
  );
  await screen.findByText("QR payment settings saved.");
  assert.match(String(bodies[0].image), /^data:image\/png;base64,/);
  fireEvent.click(screen.getByRole("button", { name: "Remove QR image" }));
  fireEvent.submit(
    screen.getByRole("button", { name: "Save QR settings" }).closest("form")!,
  );
  await waitFor(() => assert.equal(bodies.length, 2));
  assert.equal(bodies[1].removeImage, true);
});
