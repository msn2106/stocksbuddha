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
import { DeliveryStatus } from "../../src/account/DeliveryStatus";
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test("administrators can inspect pending, leased and sent jobs, refresh and request a bounded retry", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let fail = false;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (fail) return Response.json({}, { status: 503 });
    return Response.json(
      init?.method === "POST"
        ? { ok: true }
        : [
            {
              id: "pending",
              paymentStatus: "payment_pending",
              deliveryStatus: null,
              attempts: 0,
              queuedAt: "2026-11-01",
              availableAt: null,
            },
            {
              id: "delivery",
              paymentStatus: "paid",
              deliveryStatus: "pending",
              attempts: 2,
              queuedAt: "2026-11-02",
              availableAt: "2026-11-03",
            },
            {
              id: "leased",
              paymentStatus: "paid",
              deliveryStatus: "sending",
              attempts: 3,
              queuedAt: "2026-11-02",
              availableAt: null,
            },
            {
              id: "sent",
              paymentStatus: "paid",
              deliveryStatus: "sent",
              attempts: 1,
              queuedAt: "2026-11-02",
              availableAt: null,
            },
          ],
    );
  };
  render(<DeliveryStatus api="/api/workspaces/alpha/onboarding" hi={false} />);
  await screen.findByText("pending: payment_pending / —");
  assert.equal(screen.getAllByRole("button", { name: "Retry" }).length, 3);
  fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]!);
  await waitFor(() =>
    assert.ok(calls.some((call) => call.init?.method === "POST")),
  );
  assert.equal(
    calls.find((call) => call.init?.method === "POST")?.init?.body,
    JSON.stringify({ orderId: "pending" }),
  );
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: "Refresh delivery status" })
        .hasAttribute("disabled"),
      false,
    ),
  );
  fail = true;
  fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[1]!);
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh delivery status" }),
  );
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: "Refresh delivery status" })
        .hasAttribute("disabled"),
      false,
    ),
  );
  fail = false;
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh delivery status" }),
  );
  await waitFor(() => assert.equal(screen.queryByRole("alert"), null));
});

test("Hindi queue status recovers from an initial failure and displays the empty queue", async () => {
  let fail = true;
  globalThis.fetch = async () =>
    fail ? Response.json({}, { status: 503 }) : Response.json([]);
  render(<DeliveryStatus api="/api/workspaces/alpha/onboarding" hi />);
  await screen.findByRole("alert");
  fail = false;
  fireEvent.click(
    screen.getByRole("button", { name: "वितरण स्थिति रीफ़्रेश करें" }),
  );
  await waitFor(() => assert.equal(screen.queryByRole("alert"), null));
  assert.ok(screen.getByText("कोई भुगतान या वितरण कार्य नहीं।"));
});

test("Hindi queued jobs expose localized recovery controls", async () => {
  globalThis.fetch = async () =>
    Response.json([
      {
        id: "paid",
        paymentStatus: "paid",
        deliveryStatus: "pending",
        attempts: 1,
        queuedAt: "today",
        availableAt: null,
      },
    ]);
  render(<DeliveryStatus api="/jobs" hi />);
  await screen.findByRole("button", { name: "पुनः प्रयास" });
});
