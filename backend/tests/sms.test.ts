import { verifyPassword } from "better-auth/crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  indianMobile,
  digest,
  matches,
  renderOtp,
  smsSettingsSchema,
  SmsError,
} from "../src/sms/policy";
import { horizonTransport } from "../src/sms/horizon";
import { SmsService } from "../src/sms/service";
import { requireVerifiedMobile } from "../src/sms/kyc";
import { seal, unseal } from "../src/onboarding/domain";
import { smsFixture } from "./sms-fixture";

test("mobile normalization rejects foreign/truncated, malformed and non-mobile destinations; templates restrict substitutions", () => {
  for (const phone of ["9599400141", "+91 (95994) 00141", "919599400141"])
    assert.equal(indianMobile(phone), "+919599400141");
  for (const phone of [
    null,
    "123",
    "+19599400141",
    "5599400141",
    "9599400141,9876543210",
    "00919599400141",
  ])
    assert.throws(() => indianMobile(phone), SmsError);
  assert.equal(
    renderOtp("Code {{otp}} / {{expiryMinutes}}", "123456"),
    "Code 123456 / 5",
  );
  assert.equal(matches(digest("key", "123"), digest("key", "123")), true);
  assert.equal(matches("a", "bb"), false);
  assert.equal(matches("aa", "bb"), false);
  assert.equal(smsSettingsSchema.safeParse({}).success, false);
});

test("vendor adapter uses fixed HTTPS, form encoding, bearer credentials, trial rejection and sanitized uncertain failures", async () => {
  const message = {
    username: "user",
    apiKey: "private",
    senderId: "HORIZN",
    templateId: "1234567890",
    mobile: "+919599400141",
    message: "Code 123456",
    encoding: "txt" as const,
  };
  let called = 0;
  const transport = horizonTransport({}, async (url, options) => {
    called++;
    assert.equal(String(url), "https://smshorizon.com/api/v2/sendsms");
    assert.equal(options?.redirect, "error");
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer private",
    );
    assert.equal(
      (options?.body as URLSearchParams).get("mobile"),
      "9599400141",
    );
    return Response.json({ msgid: "123", balance_after: "9" });
  });
  assert.deepEqual(await transport(message), {
    messageId: "123",
    balance: "9",
  });
  await assert.rejects(
    transport({ ...message, mobile: "9876543210" }),
    /sms_trial_destination/,
  );
  assert.equal(called, 1);
  assert.throws(() => horizonTransport({ SMS_MODE: "wrong" }));
  const live = horizonTransport({ SMS_MODE: "live" }, async () =>
    Response.json({ msgid: "123" }),
  );
  assert.equal(
    (await live({ ...message, mobile: "9876543210" })).balance,
    null,
  );
  for (const result of [
    null,
    {},
    { error: "secret" },
    { msgid: "wrong" },
    { msgid: 123 },
  ]) {
    await assert.rejects(
      horizonTransport({}, async () => Response.json(result))(message),
      /sms_delivery_uncertain/,
    );
  }
  await assert.rejects(
    horizonTransport({}, async () => {
      throw new Error("credential secret");
    })(message),
    /sms_delivery_uncertain/,
  );
  await assert.rejects(
    horizonTransport({}, async () =>
      Response.json({ msgid: "123" }, { status: 403 }),
    )(message),
    /sms_delivery_uncertain/,
  );
});

test("private RA settings enforce owner, version, key retention, encoding and schema without leaking secrets", async () => {
  const f = await smsFixture();
  try {
    assert.equal((await f.service.settings(f.admin)).configured, false);
    await assert.rejects(f.service.settings(f.investor), /forbidden/);
    await assert.rejects(
      f.service.saveSettings(f.admin, {}),
      /invalid_sms_settings/,
    );
    await assert.rejects(
      f.service.saveSettings(f.admin, { ...f.config, apiKey: undefined }),
      /sms_credentials_required/,
    );
    await assert.rejects(
      f.service.saveSettings(f.admin, {
        ...f.config,
        verification: {
          ...f.config.verification,
          text: "Code {{unknown}} {{otp}}",
        },
      }),
      /invalid_sms_settings/,
    );
    await assert.rejects(
      f.service.saveSettings(f.admin, {
        ...f.config,
        verification: { ...f.config.verification, text: "कोड {{otp}}" },
      }),
      /sms_encoding_mismatch/,
    );
    await f.service.saveSettings(f.admin, f.config);
    const saved = await f.service.settings(f.admin);
    assert.equal(saved.version, 1);
    assert.ok(!JSON.stringify(saved).includes("private-api-key"));
    await assert.rejects(
      f.service.saveSettings(f.admin, f.config),
      /version_conflict/,
    );
    await f.service.saveSettings(f.admin, {
      ...f.config,
      version: 1,
      apiKey: undefined,
    });
    await f.send();
    assert.equal(f.sent[0].apiKey, "private-api-key");
    assert.equal((await f.service.settings(f.admin)).events.length, 1);
    const [encrypted] = await f.query("SELECT config_cipher FROM sms_settings");
    assert.ok(!String(encrypted.config_cipher).includes("private-api-key"));
    await f.service.saveSettings(f.admin, {
      ...f.config,
      version: 2,
      encoding: "uni",
      verification: { ...f.config.verification, text: "आपका कोड {{otp}} है।" },
    });
  } finally {
    f.close();
  }
});

test("verification binds identity, tenant, purpose and number, consumes once, cancels unfinished quotes and retains encrypted communications", async () => {
  const f = await smsFixture();
  try {
    await f.service.saveSettings(f.admin, f.config);
    await assert.rejects(f.send("+19599400141"), /invalid_mobile/);
    await assert.rejects(f.send("9876543210"), /sms_trial_destination/);
    const challenge = await f.send();
    const [event] = await f.query("SELECT * FROM sms_events");
    assert.equal(event.status, "accepted");
    assert.equal(event.message_id, "123456");
    const evidence = unseal<{ message: string; templateId: string }>(
      f.env.ONBOARDING_DATA_KEY,
      String(event.evidence_cipher),
    );
    assert.ok(evidence.message.includes(f.code()));
    assert.equal(evidence.templateId, f.config.verification.id);
    assert.ok(
      !JSON.stringify(await f.query("SELECT * FROM sms_challenges")).includes(
        f.code(),
      ),
    );
    await assert.rejects(
      f.service.verify({
        context: f.other,
        challengeId: challenge.challengeId,
        code: f.code(),
        ip: "ip",
      }),
      /invalid_or_expired/,
    );
    await assert.rejects(
      f.service.verify({
        slug: "alpha",
        newPassword: "New-password-123!",
        challengeId: challenge.challengeId,
        code: f.code(),
        ip: "ip",
      }),
      /invalid_or_expired/,
    );
    await assert.rejects(
      f.service.verify({
        context: { ...f.investor, tenantId: f.otherTenantId },
        challengeId: challenge.challengeId,
        code: f.code(),
        ip: "ip",
      }),
      /forbidden/,
    );
    await f.verify(challenge.challengeId);
    assert.deepEqual(await f.service.mobile(f.investor), {
      mobile: "+919599400141",
      verified: true,
      recoveryEnabled: false,
      recoveryMobile: null,
    });
    await requireVerifiedMobile(
      f.db.manager ?? ({ query: f.query } as never),
      f.tenantId,
      f.memberId,
      "9599400141",
    );
    await assert.rejects(
      requireVerifiedMobile(
        { query: f.query } as never,
        f.tenantId,
        f.memberId,
        "9876543210",
      ),
      /mobile_verification_required/,
    );
    await assert.rejects(f.verify(challenge.challengeId), /invalid_or_expired/);
    await assert.rejects(f.verify("invalid", "123456"), /invalid_or_expired/);
    await assert.rejects(
      f.verify(randomUUID(), "123456"),
      /invalid_or_expired/,
    );
    await assert.rejects(f.verify(randomUUID(), "abcd"), /invalid_or_expired/);
  } finally {
    f.close();
  }
});

test("resends preserve wrong-attempt budget, invalidate old codes and enforce cooldown, flow maximum and expiry", async () => {
  const f = await smsFixture();
  try {
    await f.service.saveSettings(f.admin, f.config);
    const key = randomUUID(),
      first = await f.send(undefined, key),
      old = f.code();
    assert.equal((await f.send(undefined, key)).challengeId, first.challengeId);
    assert.equal(f.sent.length, 1);
    await assert.rejects(f.send(), /sms_rate_limited/);
    const wrong = old === "100000" ? "999999" : "100000";
    await assert.rejects(
      f.verify(first.challengeId, wrong),
      /invalid_or_expired/,
    );
    assert.equal(
      (await f.query("SELECT attempts FROM sms_challenges"))[0].attempts,
      1,
    );
    f.advance(60001);
    const second = await f.send();
    assert.equal(second.attemptsRemaining, 4);
    // Random codes can coincide, so assert the stored digest binds the current transport's value.
    const [flow] = await f.query("SELECT code_hash FROM sms_challenges");
    assert.equal(
      flow.code_hash,
      digest(f.env.ONBOARDING_DATA_KEY, `${first.challengeId}:${f.code()}`),
    );
    f.advance(60001);
    await f.send();
    f.advance(60001);
    await assert.rejects(f.send(), /sms_rate_limited/);
    f.advance(300001);
    await assert.rejects(f.verify(first.challengeId), /invalid_or_expired/);
    f.advance(1800001);
    const next = await f.send();
    for (let i = 0; i < 5; i++)
      await assert.rejects(
        f.verify(next.challengeId, f.code() === "100000" ? "999999" : "100000"),
        /invalid_or_expired/,
      );
    await assert.rejects(f.verify(next.challengeId), /invalid_or_expired/);
    f.advance(60001);
    await assert.rejects(f.send(), /sms_rate_limited/);
  } finally {
    f.close();
  }
});

test("shared quotas survive flow changes and failed sends; unknown recovery remains generic", async () => {
  const f = await smsFixture();
  try {
    await assert.rejects(f.send(), /sms_unavailable/);
    await assert.rejects(
      f.service.send({ context: f.investor, key: "invalid", ip: "ip" }),
      /invalid_request_key/,
    );
    await f.service.saveSettings(f.admin, { ...f.config, enabled: false });
    await assert.rejects(f.send(), /sms_unavailable/);
    await f.service.saveSettings(f.admin, { ...f.config, version: 1 });
    f.failure.sms = true;
    assert.ok("deliveryUncertain" in (await f.send()));
    assert.equal(
      (await f.query("SELECT status FROM sms_events"))[0].status,
      "uncertain",
    );
    await assert.rejects(f.send(), /sms_rate_limited/);
    const generic = await f.service.send({
      slug: "alpha",
      email: "missing@test.local",
      key: randomUUID(),
      ip: "ip",
    });
    assert.ok(generic.challengeId);
    assert.equal(generic.sendsRemaining, 0);
    assert.ok(
      (
        await f.service.send({
          slug: "alpha",
          email: null,
          key: randomUUID(),
          ip: "ip",
        })
      ).challengeId,
    );
    for (let i = 0; i < 30; i++) await f.service.throttle("same-ip");
    await assert.rejects(f.service.throttle("same-ip"), /sms_rate_limited/);
    f.advance(600001);
    await f.service.throttle("same-ip");
    for (const caps of [
      { SMS_TENANT_DAILY_CAP: "0" },
      { SMS_GLOBAL_DAILY_CAP: "10001" },
      { ONBOARDING_DATA_KEY: "bad" },
    ])
      assert.throws(
        () =>
          new SmsService(f.db, { ...f.env, ...caps }, async () => ({
            messageId: "1",
            balance: null,
          })),
      );
  } finally {
    f.close();
  }
});

test("global recovery requires explicit current-password enrollment, rejects staff and uses the stored contact, then queues security notices", async () => {
  const f = await smsFixture();
  try {
    await f.service.saveSettings(f.admin, f.config);
    const first = await f.send();
    await f.verify(first.challengeId);
    await assert.rejects(
      f.service.recoveryContact(f.investor, null, true),
      /invalid_fields/,
    );
    await assert.rejects(
      f.service.recoveryContact(f.investor, "wrong", true),
      /invalid_password/,
    );
    await f.service.recoveryContact(f.investor, f.password, true);
    assert.equal((await f.service.mobile(f.investor)).recoveryEnabled, true);
    const recovery = await f.service.send({
      slug: "alpha",
      email: "investor@example.test",
      key: randomUUID(),
      ip: "ip",
    });
    await assert.rejects(f.verify(recovery.challengeId), /invalid_or_expired/);
    const proof = await f.service.verify({
      slug: "alpha",
      newPassword: "New-password-123!",
      challengeId: recovery.challengeId,
      code: f.code(),
      ip: "ip",
    });
    assert.deepEqual(proof, { ok: true });
    assert.equal(
      await verifyPassword({
        hash: String(
          (await f.query("SELECT password FROM auth_accounts"))[0].password,
        ),
        password: "New-password-123!",
      }),
      true,
    );
    assert.equal(
      (await f.query("SELECT * FROM auth_sessions WHERE user_id=?", [f.userId]))
        .length,
      0,
    );
    await assert.rejects(
      f.service.verify({
        slug: "alpha",
        challengeId: recovery.challengeId,
        code: f.code(),
        ip: "ip",
        newPassword: "New-password-123!",
      }),
      /invalid_or_expired/,
    );
    assert.equal((await f.query("SELECT * FROM auth_verifications")).length, 0);
    await f.query(
      "INSERT INTO auth_sessions VALUES (?,?,?,'2099-01-01 00:00:00')",
      [randomUUID(), f.userId, "investor-token"],
    );
    f.failure.mail = true;
    assert.equal(await f.service.deliverNotice(), true);
    assert.equal(f.notices.length, 0);
    f.failure.mail = false;
    f.advance(300001);
    assert.equal(await f.service.deliverNotice(), true);
    assert.equal(await f.service.deliverNotice(), true);
    assert.equal(await f.service.deliverNotice(), false);
    assert.equal(f.notices.length, 2);
    await f.service.recoveryContact(f.investor, "New-password-123!", false);
    assert.equal((await f.service.mobile(f.investor)).recoveryEnabled, false);
    await f.query("UPDATE auth_users SET platform_role='owner' WHERE id=?", [
      f.userId,
    ]);
    await assert.rejects(
      f.service.recoveryContact(f.investor, "New-password-123!", true),
      /recovery_not_eligible/,
    );
    await f.query("UPDATE auth_users SET platform_role=NULL WHERE id=?", [
      f.userId,
    ]);
    await f.query(
      "UPDATE tenant_memberships SET mobile_verified_at=NULL WHERE id=?",
      [f.memberId],
    );
    await assert.rejects(
      f.service.recoveryContact(f.investor, "New-password-123!", true),
      /recovery_not_eligible/,
    );
  } finally {
    f.close();
  }
});

test("RA exports paginate retained communications and redact active OTPs, while excluding global recovery evidence", async () => {
  const f = await smsFixture();
  try {
    await f.service.saveSettings(f.admin, f.config);
    await f.send();
    const first = await f.service.records(f.admin);
    assert.equal(first.records.length, 1);
    assert.ok(first.records[0].message.includes("[REDACTED OTP]"));
    assert.ok(!JSON.stringify(first).includes(f.code()));
    await assert.rejects(f.service.records(f.investor), /forbidden/);
    await assert.rejects(f.service.records(f.admin, "bad"), /invalid_cursor/);
    await assert.rejects(
      f.service.records(f.admin, randomUUID()),
      /invalid_cursor/,
    );
    for (let index = 0; index < 51; index++)
      await f.query(
        "INSERT INTO sms_events(id,tenant_id,user_id,challenge_id,mobile_hash,ip_hash,kind,status,request_key,evidence_cipher,created_at) SELECT ?,tenant_id,user_id,challenge_id,mobile_hash,ip_hash,kind,status,?,evidence_cipher,created_at FROM sms_events LIMIT 1",
        [randomUUID(), randomUUID()],
      );
    const page = await f.service.records(f.admin);
    assert.equal(page.records.length, 50);
    assert.ok(page.nextCursor);
    assert.equal(
      (await f.service.records(f.admin, page.nextCursor!)).records.length,
      2,
    );
  } finally {
    f.close();
  }
});

test("platform recovery cannot reuse RA-owned credentials or bypass enrollment, role changes, phone caps or contact revocation", async () => {
  const f = await smsFixture();
  try {
    await assert.rejects(
      f.service.saveSettings(f.admin, { ...f.config, username: "platform" }),
      /sms_separate_accounts_required/,
    );
    await assert.rejects(
      f.service.saveSettings(f.admin, { ...f.config, username: "PLATFORM" }),
      /sms_separate_accounts_required/,
    );
    await f.service.saveSettings(f.admin, f.config);
    const challenge = await f.send();
    await f.verify(challenge.challengeId);
    await f.service.recoveryContact(f.investor, f.password, true);
    const request = () =>
      f.service.send({
        slug: "alpha",
        email: "investor@example.test",
        key: randomUUID(),
        ip: "ip",
      });
    const recovery = await request();
    assert.equal(f.sent.at(-1)!.username, "platform");
    assert.equal((await request()).sendsRemaining, 0); // Same generic response while cooling down.
    await f.service.recoveryContact(f.investor, f.password, false);
    await assert.rejects(
      f.service.verify({
        slug: "alpha",
        challengeId: recovery.challengeId,
        code: f.code(),
        ip: "ip",
        newPassword: "new-password-123",
      }),
      /invalid_or_expired/,
    );
    await f.service.recoveryContact(f.investor, f.password, true);
    await f.query("UPDATE auth_users SET platform_role='owner' WHERE id=?", [
      f.userId,
    ]);
    assert.equal((await request()).sendsRemaining, 0);
    await f.query("UPDATE auth_users SET platform_role=NULL WHERE id=?", [
      f.userId,
    ]);
    await f.query("UPDATE sms_settings SET vendor_user_hash=?", [
      digest(f.env.ONBOARDING_DATA_KEY, "platform"),
    ]);
    const before = f.sent.length;
    await request();
    assert.equal(f.sent.length, before);
    await f.query("UPDATE sms_settings SET vendor_user_hash=?", [
      digest(f.env.ONBOARDING_DATA_KEY, "test"),
    ]);
    const noRecovery = new SmsService(
      f.db,
      { ...f.env, SMS_RECOVERY_SETTINGS_JSON: undefined },
      async () => ({ messageId: "1", balance: null }),
    );
    await assert.rejects(
      noRecovery.recoveryContact(f.investor, f.password, true),
      /sms_recovery_unavailable/,
    );
    assert.equal(
      (
        await noRecovery.send({
          slug: "alpha",
          email: "investor@example.test",
          key: randomUUID(),
          ip: "ip",
        })
      ).sendsRemaining,
      0,
    );
    assert.throws(
      () =>
        new SmsService(
          f.db,
          { ...f.env, SMS_RECOVERY_SETTINGS_JSON: "{bad secret" },
          async () => ({ messageId: "1", balance: null }),
        ),
      /Invalid platform/,
    );
    await assert.rejects(
      f.service.verify({
        slug: "alpha",
        challengeId: "bad",
        code: "123456",
        ip: "ip",
      }),
      /invalid_password/,
    );
  } finally {
    f.close();
  }
});

test("hard rolling limits and wrong-guess budgets survive changed flows, and verification is blocked during payment", async () => {
  const f = await smsFixture();
  try {
    await f.service.saveSettings(f.admin, f.config);
    const challenge = await f.send();
    const [event] = await f.query("SELECT * FROM sms_events");
    for (let i = 0; i < 4; i++)
      await f.query(
        "INSERT INTO sms_events(id,tenant_id,user_id,challenge_id,mobile_hash,ip_hash,kind,status,request_key,created_at) VALUES (?,?,?,?,?,?,'send','reserved',?,?)",
        [
          randomUUID(),
          f.tenantId,
          f.userId,
          challenge.challengeId,
          event.mobile_hash,
          event.ip_hash,
          randomUUID(),
          f.clock.value,
        ],
      );
    f.advance(60001);
    await assert.rejects(f.send(), /sms_rate_limited/);
    await assert.rejects(
      f.service
        .send({
          context: f.investor,
          mobile: "9599400141",
          key: event.request_key as string,
          ip: "ip",
        })
        .then(() =>
          f.service.send({
            context: f.investor,
            mobile: "9876543210",
            key: event.request_key as string,
            ip: "ip",
          }),
        ),
      /sms_trial_destination/,
    );
    for (let i = 0; i < 10; i++)
      await f.query(
        "INSERT INTO sms_events(id,tenant_id,user_id,challenge_id,mobile_hash,ip_hash,kind,status,request_key,created_at) VALUES (?,?,?,?,?,?,'wrong','wrong',?,?)",
        [
          randomUUID(),
          f.tenantId,
          f.userId,
          challenge.challengeId,
          event.mobile_hash,
          event.ip_hash,
          randomUUID(),
          f.clock.value,
        ],
      );
    await assert.rejects(f.verify(challenge.challengeId), /invalid_or_expired/);
    await f.query("DELETE FROM sms_events WHERE kind='wrong'");
    await f.query(
      "INSERT INTO subscription_orders(id,tenant_id,membership_id,status) VALUES (?,?,?,'payment_pending')",
      [randomUUID(), f.tenantId, f.memberId],
    );
    await assert.rejects(
      f.verify(challenge.challengeId),
      /payment_in_progress/,
    );
    assert.equal(
      (
        await f.query("SELECT consumed_at FROM sms_challenges WHERE id=?", [
          challenge.challengeId,
        ])
      )[0].consumed_at,
      null,
    );
    await assert.rejects(
      requireVerifiedMobile(
        { query: async () => [] } as never,
        f.tenantId,
        f.memberId,
        "9599400141",
      ),
      /mobile_verification_required/,
    );
    await assert.rejects(
      requireVerifiedMobile(
        {
          query: async () => [{ mobile: "bad", mobile_verified_at: "today" }],
        } as never,
        f.tenantId,
        f.memberId,
        "9599400141",
      ),
      /mobile_verification_required/,
    );
  } finally {
    f.close();
  }
});

test("SMS startup defaults and durable notice failures remain bounded without configured SMTP", async () => {
  const f = await smsFixture();
  try {
    const service = new SmsService(
      f.db,
      { ...f.env, SMS_MODE: "live" },
      async () => ({ messageId: "1", balance: null }),
    );
    assert.equal(await service.deliverNotice(), false);
    await f.query(
      "INSERT INTO sms_security_notices(id,user_id,attempts,available_at) VALUES (?,?,9,?)",
      [randomUUID(), f.userId, new Date(Date.now() - 1000)],
    );
    assert.equal(await service.deliverNotice(), true);
    assert.equal(
      (await f.query("SELECT attempts FROM sms_security_notices"))[0].attempts,
      10,
    );
    assert.equal(await service.deliverNotice(), false);
  } finally {
    f.close();
  }
});

test("KYC gates reject unverified numbers and admin changes cannot preserve an unrelated verification stamp", async () => {
  const f = await smsFixture();
  try {
    const document = await f.evidence();
    await f.query(
      "UPDATE tenant_memberships SET mobile_verified_at=NULL WHERE id=?",
      [f.memberId],
    );
    assert.equal((await f.service.mobile(f.investor)).verified, false);
    await assert.rejects(f.service.settings(f.other), /forbidden/);
    await assert.rejects(f.service.mobile(f.admin), /forbidden/);
    await assert.rejects(
      f.service.recoveryContact(f.investor, "wrong", false),
      /invalid_password/,
    );
    const body = { ...f.profile, documentId: document.id, version: 0 };
    // The onboarding fixture service is distinct from the SMS fixture service.
    const { OnboardingService } = await import("../src/onboarding/service");
    const onboarding = new OnboardingService(f.db, f.options);
    await assert.rejects(
      onboarding.saveKyc(f.investor, body, true),
      /mobile_verification_required/,
    );
    await f.query(
      "UPDATE tenant_memberships SET mobile='9876543210',mobile_verified_at='2026-01-01' WHERE id=?",
      [f.memberId],
    );
    await onboarding.saveKyc(
      f.investor,
      { ...body, phone: "+91 (98765)43210" },
      true,
    );
    assert.equal(
      (
        await f.query(
          "SELECT mobile_verified_at FROM tenant_memberships WHERE id=?",
          [f.memberId],
        )
      )[0].mobile_verified_at,
      "2026-01-01",
    );
    await f.query(
      "UPDATE investor_kyc SET status='changes' WHERE membership_id=?",
      [f.memberId],
    );
    await onboarding.saveKyc(
      f.admin,
      { ...body, version: 1, customerId: f.memberId, phone: "+12025550123" },
      false,
    );
    assert.equal(
      (
        await f.query(
          "SELECT mobile_verified_at FROM tenant_memberships WHERE id=?",
          [f.memberId],
        )
      )[0].mobile_verified_at,
      null,
    );
    assert.equal(
      (await onboarding.read(f.investor)).customer!.mobileVerified,
      false,
    );
  } finally {
    f.close();
  }
});

test("re-verifying the KYC contact preserves approval; replacing it requires review and cannot interrupt paid service", async () => {
  const f = await smsFixture();
  try {
    await f.setup();
    await f.service.saveSettings(f.admin, f.config);
    f.env.SMS_MODE = "live";
    const unchanged = await f.send("9876543210");
    await f.verify(unchanged.challengeId);
    assert.equal(
      (await f.query("SELECT status FROM investor_kyc"))[0].status,
      "verified",
    );
    f.advance(60001);
    const changed = await f.send();
    await f.verify(changed.challengeId);
    assert.equal(
      (await f.query("SELECT status,version FROM investor_kyc"))[0].status,
      "changes",
    );
    assert.equal((await f.query("SELECT * FROM kyc_history")).length, 3);
    await f.query(
      "UPDATE investor_kyc SET profile_cipher=?,status='verified'",
      [seal(f.env.ONBOARDING_DATA_KEY, { ...f.profile, phone: "9599400141" })],
    );
    await f.query(
      "INSERT INTO subscription_orders(id,tenant_id,membership_id,status) VALUES (?,?,?,'paid')",
      [randomUUID(), f.tenantId, f.memberId],
    );
    const { OnboardingService } = await import("../src/onboarding/service");
    const onboarding = new OnboardingService(f.db, f.options);
    const [kyc] = await f.query("SELECT version FROM investor_kyc");
    const [document] = await f.query(
      "SELECT id FROM documents WHERE customer_id=? LIMIT 1",
      [f.memberId],
    );
    await assert.rejects(
      onboarding.saveKyc(
        f.admin,
        {
          ...f.profile,
          phone: "9876543210",
          version: kyc.version,
          documentId: document.id,
          customerId: f.memberId,
        },
        false,
      ),
      /paid_identity_change_requires_compliance_review/,
    );
    f.advance(60001);
    const paidChange = await f.send("9876543210");
    await assert.rejects(
      f.verify(paidChange.challengeId),
      /paid_mobile_change_requires_review/,
    );
    assert.equal((await f.service.mobile(f.investor)).mobile, "+919599400141");
    assert.equal(
      (await f.query("SELECT status FROM investor_kyc"))[0].status,
      "verified",
    );
  } finally {
    f.close();
  }
});

test("SMS rechecks current capability overrides and fails closed if the serialization row is missing", async () => {
  const f = await smsFixture();
  try {
    await f.query(
      "UPDATE tenant_memberships SET capabilities_json=? WHERE id=?",
      [JSON.stringify({ deny: ["website:edit"] }), f.adminMemberId],
    );
    await assert.rejects(f.service.settings(f.admin), /forbidden/);
    await f.query("DELETE FROM sms_mutex");
    await assert.rejects(f.service.mobile(f.investor), /sms_unavailable/);
  } finally {
    f.close();
  }
});

test("an intervening email reset or password change invalidates an already issued SMS recovery proof", async () => {
  const f = await smsFixture();
  try {
    await f.service.saveSettings(f.admin, f.config);
    const mobile = await f.send();
    await f.verify(mobile.challengeId);
    await f.service.recoveryContact(f.investor, f.password, true);
    const reset = await f.service.send({
      slug: "alpha",
      email: "investor@example.test",
      key: randomUUID(),
      ip: "ip",
    });
    const code = f.code();
    const { hashPassword } = await import("better-auth/crypto");
    await f.query("UPDATE auth_accounts SET password=? WHERE user_id=?", [
      await hashPassword("email-reset-password-123"),
      f.userId,
    ]);
    await assert.rejects(
      f.service.verify({
        slug: "alpha",
        challengeId: reset.challengeId,
        code,
        ip: "ip",
        newPassword: "must-not-apply-123",
      }),
      /invalid_or_expired/,
    );
    assert.equal(
      await verifyPassword({
        hash: String(
          (await f.query("SELECT password FROM auth_accounts"))[0].password,
        ),
        password: "email-reset-password-123",
      }),
      true,
    );
  } finally {
    f.close();
  }
});

test("SMS password recovery allows only three sends per rolling day across RAs, numbers and flows, without blocking KYC", async () => {
  const f = await smsFixture();
  try {
    await f.service.saveSettings(f.admin, f.config);
    const proof = await f.send();
    await f.verify(proof.challengeId);
    await f.service.recoveryContact(f.investor, f.password, true);
    const foreign = { token: "foreign-token", tenantId: f.otherTenantId };
    await f.service.saveSettings(foreign, f.config);
    await f.query(
      "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,status,capabilities_json) VALUES (?,?,?,'subscriber','active','{}')",
      [randomUUID(), f.otherTenantId, f.userId],
    );
    const request = (slug: string) =>
      f.service.send({
        slug,
        email: "investor@example.test",
        key: randomUUID(),
        ip: randomUUID(),
      });
    const first = await request("alpha");
    assert.ok(first.challengeId);
    assert.equal(f.sent.length, 2);
    await request("beta");
    assert.equal(f.sent.length, 2); // Account cooldown applies across RAs/IPs.
    f.advance(60000);
    await request("beta");
    assert.equal(f.sent.length, 3);
    f.advance(60000);
    await request("alpha");
    assert.equal(f.sent.length, 4);
    // A changed recovery number/new flow cannot replenish the global recovery budget.
    f.advance(60000);
    f.env.SMS_MODE = "live";
    await f.query(
      "UPDATE sms_challenges SET consumed_at=? WHERE purpose='recover'",
      [f.clock.value],
    );
    const { seal } = await import("../src/onboarding/domain");
    await f.query(
      "UPDATE account_recovery_mobiles SET mobile_cipher=?,mobile_hash=? WHERE user_id=?",
      [
        seal(f.env.ONBOARDING_DATA_KEY, "+919876543210"),
        digest(f.env.ONBOARDING_DATA_KEY, "+919876543210"),
        f.userId,
      ],
    );
    const blocked = await request("beta");
    assert.ok(blocked.challengeId);
    assert.equal(blocked.sendsRemaining, 0);
    assert.equal(f.sent.length, 4);
    await f.send("9876543210");
    assert.equal(f.sent.length, 5); // KYC has its own purpose, still under combined safety caps.
    f.advance(86400000);
    await request("beta");
    assert.equal(f.sent.length, 6);
  } finally {
    f.close();
  }
});

test("RA SMS template arrays preserve legacy Login mappings, starter recovery entries and arbitrary additional registered copies", async () => {
  const f = await smsFixture();
  try {
    assert.equal((await f.service.settings(f.admin)).templates.length, 2);
    const templates = [
      { key: "login", name: "Login", ...f.config.verification },
      {
        key: "password-reset",
        name: "Reset/Forgot Password",
        id: "",
        text: "",
      },
      {
        key: "reminder",
        name: "Subscription reminder",
        id: "110100000000009",
        text: "Your research subscription expires soon.",
      },
    ];
    await f.service.saveSettings(f.admin, { ...f.config, templates });
    assert.equal((await f.service.settings(f.admin)).templates.length, 3);
    await f.send();
    assert.equal(f.sent.at(-1)!.templateId, f.config.verification.id);
    for (const invalid of [
      [templates[0], templates[0]],
      templates.slice(1),
      [templates[0], templates[2]],
      [{ ...templates[0], text: "Different {{otp}}" }, templates[1]],
    ])
      await assert.rejects(
        f.service.saveSettings(f.admin, {
          ...f.config,
          version: 1,
          templates: invalid,
        }),
        /invalid_sms_settings/,
      );
  } finally {
    f.close();
  }
});
