import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { onboardingFixture } from "./onboarding-fixture";
import {
  OnboardingService,
  iso,
  planView,
  couponView,
} from "../src/onboarding/service";
import { seal, unseal } from "../src/onboarding/domain";

/** Quote and sign through the real service with its captured email code. */
async function signed(
  f: ReturnType<typeof onboardingFixture>,
  planId: string,
  code = "",
) {
  const order = await f.service.quote(f.investor, {
    planId,
    key: randomUUID(),
    code,
  });
  await f.service.sendCode(f.investor, order.id);
  const view = await f.service.read(f.investor);
  const message = [...f.messages]
    .reverse()
    .find((entry) => entry.kind === "signing")!;
  await f.service.sign(f.investor, {
    orderId: order.id,
    name: f.profile.fullName,
    code: message.code,
    hash: view.orders[0].hash,
    consent: true,
  });
  return order.id;
}

test("private onboarding reads use current sessions and scoped roles; projections mask admin-list identity", async () => {
  const f = onboardingFixture();
  try {
    const view = await f.service.read(f.investor);
    assert.equal(view.customer?.status, "not_started");
    assert.equal(view.customer?.profile.phone, "9876543210");
    assert.equal(view.settings, null);
    await assert.rejects(
      f.service.read({ ...f.investor, token: "bad" }),
      /unauthorized/,
    );
    await assert.rejects(
      f.service.read({ ...f.investor, tenantId: f.otherTenantId }),
      /forbidden/,
    );
    await assert.rejects(
      f.service.read(f.investor, f.otherMemberId),
      /forbidden/,
    );
    await assert.rejects(
      f.service.read(f.admin, randomUUID()),
      /customer_not_found/,
    );
    await assert.rejects(
      f.service.read(f.admin, undefined, "bad"),
      /invalid_id/,
    );
    await f.setup();
    const list = await f.service.read(f.admin);
    assert.equal(list.users.length, 2);
    assert.ok(
      list.users
        .find((user) => user.id === f.memberId)
        ?.profile.pan.startsWith("******"),
    );
    const detail = await f.service.read(f.admin, f.memberId);
    assert.equal(detail.customer?.profile.pan, f.profile.pan);
    assert.ok(detail.customer?.checkedAt);
    await f.query("UPDATE auth_users SET email_verified=0 WHERE id=?", [
      f.userId,
    ]);
    await assert.rejects(f.service.read(f.investor), /unauthorized/);
    await f.query("UPDATE auth_users SET email_verified=1 WHERE id=?", [
      f.userId,
    ]);
    await f.query(
      "UPDATE tenant_memberships SET capabilities_json=? WHERE id=?",
      ['{"allow":["anything"]}', f.memberId],
    );
    await assert.rejects(f.service.read(f.investor), /forbidden/);
    await f.query(
      "UPDATE tenant_memberships SET capabilities_json='{}',status='revoked' WHERE id=?",
      [f.memberId],
    );
    await assert.rejects(f.service.read(f.investor), /forbidden/);
    assert.equal(
      iso(new Date("2026-01-01T00:00:00Z")),
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(
      planView({
        id: "id",
        name: "name",
        description: "d",
        days: 30,
        price: 100,
        tax_bps: 0,
        active: 0,
        version: 1,
      }).active,
      false,
    );
    assert.equal(
      couponView({
        id: "id",
        code: "CODE",
        type: "percent",
        value: 10,
        plan_id: "plan",
        starts_at: "2026-01-01 00:00:00",
        ends_at: "2027-01-01 00:00:00",
        usage_limit: 1,
        per_user: 1,
        active: 0,
        version: 1,
      }).planId,
      "plan",
    );
  } finally {
    f.close();
  }
});
test("RA offer management checks role, versions, scope, caps and transactional audit rollback", async () => {
  const f = onboardingFixture();
  try {
    const input = {
      version: 0,
      name: "Plan",
      description: "Research reports",
      days: 30,
      price: 10000,
      taxBps: 0,
      active: true,
    };
    await assert.rejects(
      f.service.manage(f.investor, "plan", input),
      /forbidden/,
    );
    await assert.rejects(
      f.service.manage(f.admin, "other", input),
      /invalid_action/,
    );
    const created = await f.service.manage(f.admin, "plan", input);
    await assert.rejects(
      f.service.manage(f.admin, "plan", {
        ...input,
        id: created.id,
        version: 9,
      }),
      /version_conflict/,
    );
    await f.service.manage(f.admin, "plan", {
      ...input,
      id: created.id,
      version: 1,
      active: false,
    });
    const list = await f.service.read(f.admin);
    assert.equal(list.plans[0].active, false);
    assert.equal(list.plans[0].version, 2);
    const coupon = {
      version: 0,
      code: "TEN",
      type: "fixed",
      value: 100,
      planId: created.id,
      startsAt: "2020-01-01T00:00:00Z",
      endsAt: "2099-01-01T00:00:00Z",
      limit: 1,
      perUser: 1,
      active: true,
    };
    const saved = await f.service.manage(f.admin, "coupon", coupon);
    await f.service.manage(f.admin, "coupon", {
      ...coupon,
      id: saved.id,
      version: 1,
      active: false,
    });
    await assert.rejects(
      f.service.manage(f.admin, "coupon", {
        ...coupon,
        code: "FOREIGN",
        planId: randomUUID(),
      }),
      /plan_unavailable/,
    );
    f.memory.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
    await assert.rejects(
      f.service.manage(f.admin, "plan", { ...input, name: "Must rollback" }),
      /audit unavailable/,
    );
    assert.equal(
      (
        await f.query(
          "SELECT * FROM subscription_plans WHERE name='Must rollback'",
        )
      ).length,
      0,
    );
  } finally {
    f.close();
  }
});
test("KYC submissions, admin-assisted changes and manual evidence retain separate review history", async () => {
  const f = onboardingFixture();
  try {
    const evidence = await f.evidence();
    const body = { ...f.profile, version: 0, documentId: evidence.id };
    await assert.rejects(
      f.service.saveKyc(
        f.investor,
        { ...body, documentId: randomUUID() },
        true,
      ),
      /pan_document_required/,
    );
    await f.service.saveKyc(f.investor, body, false);
    assert.equal((await f.service.read(f.investor)).customer?.status, "draft");
    await assert.rejects(
      f.service.saveKyc(f.investor, body, true),
      /version_conflict/,
    );
    await f.service.saveKyc(f.investor, { ...body, version: 1 }, true);
    await assert.rejects(
      f.service.saveKyc(f.investor, { ...body, version: 2 }, true),
      /kyc_locked/,
    );
    const decision = {
      customerId: f.memberId,
      version: 2,
      status: "verified",
      reference: "KFIN-TEST",
      providerStatus: "KYC VALIDATED",
      evidenceId: evidence.id,
    };
    await assert.rejects(f.service.review(f.investor, decision), /forbidden/);
    await assert.rejects(
      f.service.review(f.admin, { ...decision, version: 1 }),
      /version_conflict/,
    );
    await assert.rejects(
      f.service.review(f.admin, { ...decision, status: "bad" }),
      /invalid_action/,
    );
    await assert.rejects(
      f.service.review(f.admin, {
        ...decision,
        providerStatus: "KYC REGISTERED",
      }),
      /kra_remediation_required/,
    );
    for (const evidenceId of [undefined, "", "not-a-document-id"]) {
      await assert.rejects(
        f.service.review(f.admin, { ...decision, evidenceId }),
        { message: "verification_evidence_required", status: 400 },
      );
    }
    await assert.rejects(
      f.service.review(f.admin, decision),
      /verification_evidence_required/,
    );
    await assert.rejects(
      f.service.review(f.admin, { ...decision, evidenceId: randomUUID() }),
      /verification_evidence_required/,
    );
    await f.service.review(f.admin, {
      customerId: f.memberId,
      version: 2,
      status: "changes",
      reason: "Correct your name",
    });
    assert.equal(
      (await f.service.read(f.investor)).customer?.reason,
      "Correct your name",
    );
    await f.service.saveKyc(
      f.admin,
      { ...body, customerId: f.memberId, version: 3 },
      true,
    );
    await f.service.review(f.admin, {
      customerId: f.memberId,
      version: 4,
      status: "rejected",
      reason: "Unable to verify identity",
    });
    assert.equal(
      (await f.service.read(f.investor)).customer?.status,
      "rejected",
    );
    assert.equal((await f.query("SELECT * FROM kyc_history")).length, 5);
    const raw = await f.query("SELECT profile_cipher FROM investor_kyc");
    assert.ok(!String(raw[0].profile_cipher).includes(f.profile.pan));
  } finally {
    f.close();
  }
});
test("checkout freezes discounts and reviewed terms, scopes retries, and reserves coupon/family limits", async () => {
  const f = onboardingFixture();
  try {
    await assert.rejects(
      f.service.quote(f.investor, { planId: randomUUID(), key: randomUUID() }),
      /kyc_required/,
    );
    const { planId } = await f.setup();
    const coupon = {
      version: 0,
      code: "TEN",
      type: "percent",
      value: 10,
      planId,
      startsAt: "2020-01-01T00:00:00Z",
      endsAt: "2099-01-01T00:00:00Z",
      limit: 1,
      perUser: 1,
      active: true,
    };
    await f.service.manage(f.admin, "coupon", coupon);
    await assert.rejects(
      f.service.quote(f.admin, { planId, key: randomUUID() }),
      /forbidden/,
    );
    await assert.rejects(
      f.service.quote(f.investor, { planId: randomUUID(), key: randomUUID() }),
      /plan_unavailable/,
    );
    await assert.rejects(
      f.service.quote(f.investor, { planId, key: randomUUID(), code: "BAD" }),
      /coupon_unavailable/,
    );
    const key = randomUUID(),
      quote = await f.service.quote(f.investor, { planId, key, code: "ten" });
    assert.equal(
      (await f.service.quote(f.investor, { planId, key, code: "TEN" })).id,
      quote.id,
    );
    await assert.rejects(
      f.service.quote(f.investor, { planId, key, code: "other" }),
      /idempotency_conflict/,
    );
    const order = (await f.service.read(f.investor)).orders[0];
    assert.equal(order.total, 180000);
    assert.ok(order.text.includes("INR 1800.00"));
    await f.service.manage(f.admin, "plan", {
      id: planId,
      version: 1,
      name: "Changed",
      description: "Changed offering",
      days: 60,
      price: 300000,
      taxBps: 0,
      active: true,
    });
    assert.equal((await f.service.read(f.investor)).orders[0].text, order.text);
    await assert.rejects(
      f.service.quote(f.investor, { planId, key: randomUUID() }),
      /existing_checkout_or_subscription/,
    );
    await assert.rejects(
      f.service.payment(f.investor, quote.id),
      /agreement_required/,
    );
    await assert.rejects(
      f.service.cancel(f.other, quote.id),
      /order_not_found/,
    );
    await f.service.cancel(f.investor, quote.id);
    await f.service.cancel(f.investor, quote.id);
    await f.query("UPDATE ra_agreement_settings SET annual_limit=100");
    await assert.rejects(
      f.service.quote(f.investor, { planId, key: randomUUID() }),
      /family_fee_limit/,
    );
    await f.query("UPDATE ra_agreement_settings SET reviewed=0");
    await assert.rejects(
      f.service.quote(f.investor, { planId, key: randomUUID() }),
      /agreement_not_ready/,
    );
  } finally {
    f.close();
  }
});
test("agreement codes bind investor, hash, consent, name and expiry; invalid attempts commit and archived bytes remain canonical", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup(),
      quote = await f.service.quote(f.investor, { planId, key: randomUUID() });
    await f.service.sendCode(f.investor, quote.id);
    await assert.rejects(
      f.service.sendCode(f.investor, quote.id),
      /code_rate_limited/,
    );
    const view = await f.service.read(f.investor),
      hash = view.orders[0].hash,
      code = [...f.messages]
        .reverse()
        .find((entry) => entry.kind === "signing")!.code;
    const body = {
      orderId: quote.id,
      name: f.profile.fullName,
      consent: true,
      hash,
      code,
    };
    await assert.rejects(
      f.service.sign(f.investor, { ...body, hash: "forged" }),
      /agreement_consent_required/,
    );
    await assert.rejects(
      f.service.sign(f.investor, { ...body, name: "Someone else" }),
      /signature_name_mismatch/,
    );
    await assert.rejects(
      f.service.sign(f.investor, { ...body, code: "000000" }),
      /invalid_or_expired_code/,
    );
    assert.equal(
      (await f.query("SELECT otp_attempts FROM subscription_orders"))[0]
        .otp_attempts,
      1,
    );
    await f.query(
      "UPDATE subscription_orders SET otp_expires_at='2000-01-01 00:00:00'",
    );
    await assert.rejects(
      f.service.sign(f.investor, body),
      /invalid_or_expired_code/,
    );
    await f.query(
      "UPDATE subscription_orders SET otp_expires_at='2099-01-01 00:00:00'",
    );
    await f.service.sign(f.investor, body);
    await f.service.sign(f.investor, body);
    const bytes = await f.service.archive(quote.id);
    assert.deepEqual(bytes, await f.service.archive(quote.id));
    assert.equal(
      (await f.query("SELECT * FROM documents WHERE kind='mitc'")).length,
      1,
    );
    await assert.rejects(
      f.service.sendCode(f.investor, quote.id),
      /invalid_order_state/,
    );
    await assert.rejects(
      f.service.archive(randomUUID()),
      /agreement_not_signed/,
    );
  } finally {
    f.close();
  }
});
test("payments activate once from provider confirmation, recover late events, and retry document/email delivery", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup(),
      id = await signed(f, planId);
    const payment = await f.service.payment(f.investor, id);
    assert.equal(payment.session, `session-${id}`);
    assert.equal(
      (await f.service.payment(f.investor, id)).session,
      payment.session,
    );
    await assert.rejects(
      f.service.cancel(f.investor, id),
      /payment_in_progress/,
    );
    await assert.rejects(
      f.service.saveKyc(
        f.admin,
        {
          ...f.profile,
          customerId: f.memberId,
          version: 2,
          documentId: (await f.service.read(f.investor)).customer!.profile
            .documentId,
        },
        true,
      ),
      /payment_in_progress/,
    );
    assert.equal((await f.service.confirm(f.investor, id)).paid, false);
    await assert.rejects(
      f.service.webhook("alpha", Buffer.from("{}"), "timestamp", "bad"),
      /invalid_webhook_signature/,
    );
    assert.deepEqual(
      await f.service.webhook(
        "alpha",
        Buffer.from('{"type":"PAYMENT_FAILED_WEBHOOK"}'),
        "timestamp",
        "valid",
      ),
      { received: true },
    );
    f.paid.add(id);
    await f.query(
      "UPDATE subscription_orders SET expires_at='2000-01-01 00:00:00'",
    );
    assert.deepEqual(
      await f.service.webhook(
        "alpha",
        Buffer.from(
          JSON.stringify({
            type: "PAYMENT_SUCCESS_WEBHOOK",
            data: { order: { order_id: id } },
          }),
        ),
        "timestamp",
        "valid",
      ),
      { paid: true },
    );
    assert.equal((await f.service.confirm(f.investor, id)).paid, true);
    assert.equal((await f.service.payment(f.investor, id)).paid, true);
    assert.equal(
      (await f.query("SELECT * FROM onboarding_deliveries")).length,
      1,
    );
    const archived = await f.service.archive(id);
    f.setMailFail(true);
    assert.equal(await f.service.deliverOne(), false);
    const state = await f.service.read(f.investor);
    assert.equal(state.orders[0].status, "paid");
    assert.ok(state.orders[0].invoiceId);
    await f.query(
      "UPDATE onboarding_deliveries SET available_at='2000-01-01 00:00:00'",
    );
    f.setMailFail(false);
    assert.equal(await f.service.deliverOne(), true);
    assert.equal(await f.service.deliverOne(), false);
    const receipt = [...f.messages]
      .reverse()
      .find((entry) => entry.kind === "receipt")!;
    assert.equal(receipt.attachments?.length, 2);
    assert.deepEqual(receipt.attachments?.[0].content, archived);
    assert.equal(
      (
        await f.query(
          "SELECT * FROM audit_events WHERE action='subscription.activated'",
        )
      ).length,
      1,
    );
    assert.equal(
      (await f.query("SELECT * FROM documents WHERE kind='mitc'")).length,
      2,
    );
    await assert.rejects(
      f.service.quote(f.investor, { planId, key: randomUUID() }),
      /existing_checkout_or_subscription/,
    );
  } finally {
    f.close();
  }
});
test("zero-charge subscriptions still require consent, and development skips cannot enter production", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup();
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
    const id = await signed(f, planId, "FREE");
    assert.equal((await f.service.payment(f.investor, id)).paid, true);
    const production = new OnboardingService(f.db, {
      ...f.options,
      env: {
        ...f.env,
        NODE_ENV: "production",
        DB_ENV: "prod",
        ONBOARDING_PRODUCTION_APPROVED: "true",
      },
    });
    await assert.rejects(
      production.skip(f.investor, { step: "kyc" }),
      /development_skip_forbidden/,
    );
    assert.equal((await production.read(f.investor)).devSkip, false);
    const gated = new OnboardingService(f.db, {
      ...f.options,
      env: { ...f.env, NODE_ENV: "production", DB_ENV: "prod" },
    });
    assert.equal((await gated.read(f.investor)).signingEnabled, false);
    await assert.rejects(f.service.skip(f.admin, { step: "kyc" }), /forbidden/);
    await assert.rejects(
      f.service.skip(f.investor, { step: "kyc" }),
      /kyc_already_verified/,
    );
  } finally {
    f.close();
  }
});
test("development simulations remain visibly separate and no live gateway can process their evidence", async () => {
  const f = onboardingFixture();
  try {
    await f.setup();
    await f.query("DELETE FROM investor_kyc WHERE membership_id=?", [
      f.memberId,
    ]);
    await f.service.skip(f.investor, { step: "kyc" });
    assert.equal(
      (await f.service.read(f.investor)).customer?.status,
      "skipped_dev",
    );
    const planId = (await f.service.read(f.admin)).plans[0].id;
    const quote = await f.service.quote(f.investor, {
      planId,
      key: randomUUID(),
    });
    await f.service.skip(f.investor, { step: "mitc", orderId: quote.id });
    await f.service.archive(quote.id);
    f.gateway.mode = "production";
    await assert.rejects(
      f.service.payment(f.investor, quote.id),
      /development_evidence_forbidden/,
    );
    await assert.rejects(
      f.service.skip(f.investor, { step: "other" }),
      /invalid_action/,
    );
    assert.ok((await f.service.read(f.investor)).orders[0].dev);
    const encrypted = (
      await f.query("SELECT signature_cipher FROM subscription_orders")
    )[0].signature_cipher;
    assert.equal(
      unseal<{ method: string }>(f.env.ONBOARDING_DATA_KEY, String(encrypted))
        .method,
      "skipped_dev",
    );
  } finally {
    f.close();
  }
});
test("expired checkouts, corrupted agreements and gateway-terminal orders fail closed and recover safely", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup(),
      id = await signed(f, planId);
    const raw = (
      await f.query("SELECT snapshot_cipher FROM subscription_orders")
    )[0].snapshot_cipher;
    const snapshot = unseal<{ text: string }>(
      f.env.ONBOARDING_DATA_KEY,
      String(raw),
    );
    await f.query(
      "UPDATE subscription_orders SET agreement_id=NULL,snapshot_cipher=?",
      [seal(f.env.ONBOARDING_DATA_KEY, { ...snapshot, text: "tampered" })],
    );
    await assert.rejects(f.service.archive(id), /agreement_integrity_failed/);
    await f.query(
      "UPDATE subscription_orders SET snapshot_cipher=?,expires_at='2000-01-01 00:00:00'",
      [raw],
    );
    await assert.rejects(f.service.payment(f.investor, id), /checkout_expired/);
    await f.query(
      "UPDATE subscription_orders SET expires_at='2099-01-01 00:00:00'",
    );
    await f.service.payment(f.investor, id);
    f.setTerminal(true);
    await f.service.reconcilePending();
    assert.equal(
      (await f.service.read(f.investor)).orders[0].status,
      "cancelled",
    );
    await assert.rejects(
      f.service.reconcile("missing", id),
      /payments_unavailable/,
    );
    await assert.rejects(
      f.service.reconcile("alpha", randomUUID()),
      /order_not_found/,
    );
    assert.throws(
      () =>
        new OnboardingService(f.db, {
          ...f.options,
          env: { AUTH_SECRET: "short" },
        }),
      /invalid_onboarding_secret/,
    );
  } finally {
    f.close();
  }
});

test("research entitlement needs current KYC, active paid dates, evidence and a live membership", async () => {
  const f = onboardingFixture();
  try {
    assert.equal(await f.service.canUseResearch(f.investor), false);
    assert.equal(await f.service.canUseResearch(f.admin), false);
    const { planId } = await f.setup();
    assert.equal(await f.service.canUseResearch(f.investor), false);
    const id = await signed(f, planId);
    await f.service.payment(f.investor, id);
    f.paid.add(id);
    await f.service.confirm(f.investor, id);
    assert.equal(await f.service.canUseResearch(f.investor), true);
    const prod = new OnboardingService(f.db, {
      ...f.options,
      env: {
        ...f.env,
        NODE_ENV: "production",
        DB_ENV: "prod",
        ONBOARDING_PRODUCTION_APPROVED: "true",
      },
    });
    assert.equal(await prod.canUseResearch(f.investor), false);
    const profile = (await f.service.read(f.investor)).customer!;
    await assert.rejects(
      f.service.saveKyc(
        f.admin,
        {
          ...profile.profile,
          fullName: "Changed identity",
          customerId: f.memberId,
          version: profile.version,
        },
        true,
      ),
      /paid_identity_change_requires_compliance_review/,
    );
    await f.query(
      "UPDATE subscription_orders SET ends_at='2000-01-01 00:00:00'",
    );
    assert.equal(await f.service.canUseResearch(f.investor), false);
  } finally {
    f.close();
  }
});
