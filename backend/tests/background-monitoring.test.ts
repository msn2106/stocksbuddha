import { test } from "node:test";
import assert from "node:assert/strict";
import * as Sentry from "@sentry/node";
import type { Event } from "@sentry/node";
import { reportBackground } from "../src/background-monitoring";

test("background reporting emits only fixed classifications and IDs, isolated from ambient identity and breadcrumbs", async () => {
  const events: Event[] = [];
  Sentry.init({
    dsn: "https://public@example.test/1",
    defaultIntegrations: false,
    beforeSend(event) {
      events.push(event);
      return null;
    },
  });
  try {
    Sentry.setUser({ email: "private@example.test" });
    Sentry.setExtra("provider", "secret body");
    Sentry.addBreadcrumb({ message: "private PAN" });
    for (const stage of [
      "delivery",
      "reconciliation",
      "worker",
      "delivery_queue_age",
      "payment_queue_age",
      "storage_orphan",
      "sms_low_balance",
      "sms_security_notice_failed",
    ] as const)
      reportBackground(
        stage,
        stage === "delivery" ? "internal-order-id" : undefined,
      );
    await Sentry.flush(1000);
    assert.equal(events.length, 8);
    assert.equal(events[6].level, "warning");
    assert.equal(events[0].tags?.order_id, "internal-order-id");
    assert.equal(events[3].level, "warning");
    const json = JSON.stringify(events);
    for (const value of ["private@example.test", "secret body", "private PAN"])
      assert.equal(json.includes(value), false);
  } finally {
    await Sentry.close(1000);
  }
});
