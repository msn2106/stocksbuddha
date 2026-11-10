import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { onboardingFixture } from "./onboarding-fixture";
import { OnboardingService } from "../src/onboarding/service";
import { qrFile } from "../src/onboarding/qr";
import { unseal } from "../src/onboarding/domain";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const proof = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\nSynthetic payment evidence\n%%EOF").toString("base64")}`;
const settings = {
  version: 0,
  enabled: true,
  payee: "Alpha Research",
  upiId: "alpha@bank",
  instructions: "Check payee before paying.",
  image,
};
type Fixture = ReturnType<typeof onboardingFixture>;
/** Produce a signed checkout through the complete KYC, email-code and consent boundary. */
async function order(f: Fixture, planId: string, code = "") {
  const result = await f.service.quote(f.investor, {
    planId,
    key: randomUUID(),
    code,
  });
  await f.service.sendCode(f.investor, result.id);
  const view = await f.service.read(f.investor);
  await f.service.sign(f.investor, {
    orderId: result.id,
    name: f.profile.fullName,
    code: f.messages.at(-1)!.code,
    consent: true,
    hash: view.orders.find((entry) => entry.id === result.id)!.hash,
  });
  return result.id;
}
/** Submit reproducible synthetic proof bound to an existing manual payment. */
const claim = (id: string, reference = "123456789012") => ({
  orderId: id,
  reference,
  paidAt: new Date().toISOString(),
  proof,
});
/** Record the required explicit receiving-bank check for either review decision. */
const review = (id: string, version = 2, approve = true) => ({
  orderId: id,
  version,
  approve,
  fundsChecked: true,
  reason: "Checked exact amount in receiving bank account.",
});

test("QR files reject wrong types, signatures, sizes and malformed base64", () => {
  assert.equal(qrFile(image).mime, "image/png");
  assert.equal(qrFile(proof, true).mime, "application/pdf");
  assert.equal(qrFile("data:image/jpeg;base64,/9j/AA==").mime, "image/jpeg");
  for (const value of [
    proof,
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,YmFk",
    "data:image/png;base64,YQ=",
    `data:image/png;base64,${Buffer.alloc(1024 * 1024 + 1).toString("base64")}`,
  ])
    assert.throws(() => qrFile(value), /invalid_payment_file/);
  assert.throws(
    () =>
      qrFile(
        `data:application/pdf;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64")}`,
        true,
      ),
    /invalid_payment_file/,
  );
});

test("QR settings require the RA owner, validate image and metadata, retain versions and remove independently", async () => {
  const f = onboardingFixture();
  try {
    assert.equal((await f.service.qrSettings(f.admin)).enabled, false);
    await assert.rejects(f.service.qrSettings(f.investor), /forbidden/);
    await assert.rejects(
      f.service.qrSettings(f.admin, { ...settings, upiId: "bad" }),
      /invalid_qr_settings/,
    );
    await assert.rejects(
      f.service.qrSettings(f.admin, { ...settings, image: undefined }),
      /qr_image_required/,
    );
    await f.service.qrSettings(f.admin, settings);
    assert.equal((await f.service.read(f.investor)).qrEnabled, true);
    const raw = (await f.query("SELECT config_cipher FROM ra_qr_settings"))[0]
      .config_cipher;
    assert.ok(!String(raw).includes("alpha@bank"));
    await assert.rejects(
      f.service.qrSettings(f.admin, settings),
      /version_conflict/,
    );
    assert.equal(
      (
        await f.service.qrSettings(f.admin, {
          ...settings,
          image: undefined,
          version: 1,
        })
      ).image,
      image,
    );
    await f.service.qrSettings(f.admin, {
      ...settings,
      enabled: false,
      version: 2,
      removeImage: true,
    });
    assert.equal((await f.service.qrSettings(f.admin)).image, "");
    assert.equal((await f.service.read(f.investor)).qrEnabled, false);
  } finally {
    f.close();
  }
});

test("QR payment archives consent, freezes payee, locks switching, retains evidence and activates exactly once after owner approval", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup();
    await f.service.qrSettings(f.admin, settings);
    const id = await order(f, planId);
    await f.service.startQr(f.investor, id);
    await f.service.startQr(f.investor, id);
    const view = await f.service.read(f.investor);
    assert.equal(view.orders[0].paymentMethod, "qr");
    assert.ok(view.orders[0].agreementId);
    await assert.rejects(
      f.service.payment(f.investor, id),
      /payment_method_locked/,
    );
    await assert.rejects(
      f.service.confirm(f.investor, id),
      /payment_method_locked/,
    );
    await assert.rejects(
      f.service.cancel(f.investor, id),
      /payment_in_progress/,
    );
    await assert.rejects(
      f.service.retryJob(f.admin, { orderId: id }),
      /qr_manual_review_required/,
    );
    assert.equal(await f.service.canUseResearch(f.investor), false);
    await f.service.qrSettings(f.admin, {
      ...settings,
      version: 1,
      payee: "New payee",
      enabled: false,
    });
    assert.equal(
      (await f.service.qrPayment(f.investor, id)).config.payee,
      "Alpha Research",
    );
    await assert.rejects(f.service.qrPayment(f.other, id), /order_not_found/);
    await assert.rejects(
      f.service.qrPayment(
        { token: "foreign-token", tenantId: f.otherTenantId },
        id,
      ),
      /order_not_found/,
    );
    await assert.rejects(f.service.qrQueue(f.investor), /forbidden/);
    await assert.rejects(f.service.qrProof(f.admin, id), /qr_proof_required/);
    await assert.rejects(
      f.service.reviewQr(f.admin, review(id, 1)),
      /qr_proof_required/,
    );
    const data = claim(id);
    await f.service.submitQr(f.investor, data);
    await f.service.submitQr(f.investor, data);
    await assert.rejects(
      f.service.submitQr(f.investor, { ...data, reference: "OTHER12345" }),
      /qr_already_submitted/,
    );
    await assert.rejects(f.service.submitQr(f.admin, data), /forbidden/);
    const queue = await f.service.qrQueue(f.admin);
    assert.equal(queue[0].status, "submitted");
    const saved = await f.service.qrPayment(f.admin, id);
    assert.equal(saved.reference, data.reference);
    assert.equal(
      (await f.service.qrProof(f.investor, id)).mime,
      "application/pdf",
    );
    await assert.rejects(f.service.qrProof(f.other, id), /order_not_found/);
    await assert.rejects(
      f.service.reviewQr(f.investor, review(id)),
      /forbidden/,
    );
    await assert.rejects(
      f.service.reviewQr(f.admin, { ...review(id), fundsChecked: false }),
      /invalid_qr_review/,
    );
    await assert.rejects(
      f.service.reviewQr(f.admin, review(id, 1)),
      /version_conflict/,
    );
    // Genuine payments can be reviewed after the quote window; the paid service period begins at approval.
    await f.query(
      "UPDATE subscription_orders SET expires_at='2000-01-01' WHERE id=?",
      [id],
    );
    await f.service.reviewQr(f.admin, review(id));
    assert.equal((await f.service.read(f.investor)).orders[0].status, "paid");
    assert.equal(await f.service.canUseResearch(f.investor), true);
    assert.equal((await f.service.qrQueue(f.admin)).length, 0);
    assert.equal(
      (await f.service.qrPayment(f.investor, id)).status,
      "approved",
    );
    await assert.rejects(
      f.service.reviewQr(f.admin, review(id)),
      /version_conflict/,
    );
    await assert.rejects(
      f.service.reviewQr(f.admin, review(id, 3)),
      /qr_already_reviewed/,
    );
    assert.equal(
      (await f.query("SELECT * FROM onboarding_deliveries")).length,
      1,
    );
    assert.equal(await f.service.deliverOne(), true);
    const paidView = await f.service.read(f.investor);
    assert.ok(paidView.orders[0].invoiceId);
    assert.ok(f.messages.some((entry) => entry.kind === "receipt"));
    assert.equal(
      (
        await f.query(
          "SELECT * FROM audit_events WHERE action='qr.payment.approved'",
        )
      ).length,
      1,
    );
  } finally {
    f.close();
  }
});

test("QR requires consent, configured method, valid claim date and tenant-unique reference; rejection retains history", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup();
    const quoted = await f.service.quote(f.investor, {
      planId,
      key: randomUUID(),
      code: "",
    });
    await assert.rejects(
      f.service.startQr(f.investor, quoted.id),
      /agreement_required/,
    );
    await f.service.cancel(f.investor, quoted.id);
    const id = await order(f, planId);
    await assert.rejects(f.service.startQr(f.investor, id), /qr_unavailable/);
    await f.service.qrSettings(f.admin, settings);
    await f.service.startQr(f.investor, id);
    await assert.rejects(
      f.service.submitQr(f.investor, { ...claim(id), reference: "x" }),
      /invalid_qr_submission/,
    );
    await assert.rejects(
      f.service.submitQr(f.investor, {
        ...claim(id),
        paidAt: "2099-01-01T00:00:00.000Z",
      }),
      /invalid_payment_date/,
    );
    await assert.rejects(
      f.service.submitQr(f.investor, {
        ...claim(id),
        paidAt: "2000-01-01T00:00:00.000Z",
      }),
      /invalid_payment_date/,
    );
    await f.query(
      "UPDATE subscription_orders SET expires_at='2000-01-01' WHERE id=?",
      [id],
    );
    await f.service.startQr(f.investor, id);
    await f.service.submitQr(f.investor, claim(id, "abc12345678"));
    assert.equal(
      (await f.service.qrPayment(f.admin, id)).reference,
      "ABC12345678",
    );
    await f.service.reviewQr(f.admin, review(id, 2, false));
    const rejected = await f.service.qrPayment(f.investor, id);
    assert.equal(rejected.status, "rejected");
    assert.match(rejected.reason, /receiving bank/);
    assert.equal(
      (await f.service.read(f.investor)).orders[0].status,
      "cancelled",
    );
    assert.equal(await f.service.canUseResearch(f.investor), false);
    const second = await order(f, planId);
    await f.service.startQr(f.investor, second);
    await assert.rejects(
      f.service.submitQr(f.investor, claim(second, "ABC12345678")),
      /payment_reference_used/,
    );
    await f.service.reviewQr(f.admin, review(second, 1, false));
    assert.equal((await f.service.qrQueue(f.admin)).length, 0);
    assert.equal(
      (await f.service.qrProof(f.admin, id)).mime,
      "application/pdf",
    );
    assert.ok(
      unseal(
        f.env.ONBOARDING_DATA_KEY,
        String(
          (
            await f.query(
              "SELECT reason_cipher FROM qr_payment_attempts WHERE order_id=?",
              [id],
            )
          )[0].reason_cipher,
        ),
      ),
    );
  } finally {
    f.close();
  }
});

test("Cashfree pending orders cannot start QR; zero-total checkout and production gates remain enforced", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup();
    await f.service.qrSettings(f.admin, settings);
    const id = await order(f, planId);
    const gated = new OnboardingService(f.db, {
      ...f.options,
      env: {
        ...f.env,
        NODE_ENV: "production",
        DB_ENV: "prod",
        ONBOARDING_PRODUCTION_APPROVED: "false",
      },
    });
    await assert.rejects(
      gated.startQr(f.investor, id),
      /development_evidence_forbidden/,
    );
    await f.query("UPDATE subscription_orders SET dev=0 WHERE id=?", [id]);
    await assert.rejects(
      gated.startQr(f.investor, id),
      /production_payments_not_approved/,
    );
    assert.equal((await gated.read(f.investor)).qrEnabled, false);
    await f.service.payment(f.investor, id);
    assert.equal(
      (await f.service.read(f.investor)).orders[0].paymentMethod,
      "cashfree",
    );
    await assert.rejects(
      f.service.startQr(f.investor, id),
      /agreement_required/,
    );
    // Background reconciliation must not send QR order IDs to Cashfree.
    f.setTerminal(true);
    await f.service.reconcilePending();
    const second = await order(f, planId);
    await f.service.startQr(f.investor, second);
    await f.service.reconcilePending();
    assert.equal(
      (await f.service.read(f.investor)).orders.find(
        (entry) => entry.id === second,
      )!.status,
      "payment_pending",
    );
    await f.service.reviewQr(f.admin, review(second, 1, false));
    await f.service.manage(f.admin, "coupon", {
      version: 0,
      code: "FREE",
      type: "percent",
      value: 100,
      planId: null,
      startsAt: "2020-01-01T00:00:00Z",
      endsAt: "2099-01-01T00:00:00Z",
      limit: 10,
      perUser: 1,
      active: true,
    });
    const free = await order(f, planId, "FREE");
    await assert.rejects(
      f.service.startQr(f.investor, free),
      /payment_method_locked/,
    );
    assert.deepEqual(await f.service.payment(f.investor, free), { paid: true });
  } finally {
    f.close();
  }
});
