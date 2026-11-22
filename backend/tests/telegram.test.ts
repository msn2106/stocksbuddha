import { test } from "node:test";
import assert from "node:assert/strict";
import { telegramFixture } from "./telegram-fixture";
import { TelegramError, telegramApi } from "../src/telegram/api";
import { TelegramService } from "../src/telegram/service";
import { randomUUID } from "node:crypto";

test("Telegram plan and group audiences intersect the publisher's paid offering eligibility", async (t) => {
  for (const mode of ["plans", "groups"] as const)
    await t.test(mode, async () => {
      const f = await telegramFixture();
      try {
        await f.telegram.connect(f.admin);
        const group = randomUUID();
        if (mode === "groups")
          await f.research.saveGroup(f.admin, {
            id: group,
            version: 0,
            name: "Selected clients",
            membershipIds: [f.memberId, f.otherMemberId],
          });
        f.draft.audience = { mode, ids: [mode === "plans" ? f.planId : group] };
        await f.publish();
        const deliveries = await f.query(
          "SELECT membership_id FROM telegram_deliveries",
        );
        assert.equal(deliveries.length, 1);
        assert.equal(deliveries[0].membership_id, f.memberId);
      } finally {
        await f.cleanup();
      }
    });
});

test("queued recommendations superseded by an update or closure are skipped", async () => {
  const f = await telegramFixture();
  try {
    await f.telegram.connect(f.admin);
    await f.link();
    const id = await f.publish();
    await f.research.close(f.admin, id, {
      version: 2,
      status: "withdrawn",
      reason: "Withdrawn after new evidence",
      sendTelegram: true,
    });
    while (await f.telegram.deliverOne()) {
      /* Drain both durable revisions. */
    }
    const sends = f.calls.filter((call) => call.body.protect_content);
    assert.equal(sends.length, 1);
    assert.match(String(sends[0].body.text), /WITHDRAWN/);
    assert.equal(
      (
        await f.query(
          "SELECT COUNT(*) AS n FROM telegram_deliveries WHERE status='skipped'",
        )
      )[0].n,
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test("Telegram activation checks current ownership, HTTPS, unique bot identity and saved token changes", async () => {
  const f = await telegramFixture();
  try {
    assert.throws(() => new TelegramService(f.db, {}), /telegram_key_required/);
    assert.equal((await f.telegram.status(f.admin, true)).connected, false);
    await assert.rejects(
      f.telegram.webhook(f.tenantId, "unregistered-secret", {}),
      /forbidden/,
    );
    await assert.rejects(f.telegram.connect(f.investor), /forbidden/);
    await assert.rejects(
      f.telegram.connect({ ...f.admin, token: "expired" }),
      /unauthorized/,
    );
    await assert.rejects(
      f.telegram.connect({ ...f.admin, tenantId: f.otherTenantId }),
      /forbidden/,
    );
    f.env.AUTH_BASE_URL = "http://localhost";
    await assert.rejects(
      f.telegram.connect(f.admin),
      /telegram_https_required/,
    );
    delete (f.env as NodeJS.ProcessEnv).AUTH_BASE_URL;
    await assert.rejects(
      f.telegram.connect(f.admin),
      /telegram_https_required/,
    );
    f.env.AUTH_BASE_URL = "https://site.example.test";
    await f.telegram.connect(f.admin);
    const webhook = f.calls.find((c) => c.method === "setWebhook")!.body;
    assert.equal(
      webhook.url,
      `https://site.example.test/api/telegram/${f.tenantId}/webhook`,
    );
    assert.equal(String(webhook.secret_token).length, 64);
    assert.equal((await f.telegram.status(f.admin, true)).connected, true);
    assert.equal(
      (await f.integrations.read(f.admin, "telegram")).deliveryAvailable,
      true,
    );
    const beta = { token: "foreign-token", tenantId: f.otherTenantId };
    await f.integrations.save(beta, "telegram", {
      version: 0,
      botToken: "123456789:same_bot",
    });
    await assert.rejects(f.telegram.connect(beta), /telegram_bot_in_use/);
    await f.integrations.save(f.admin, "telegram", {
      version: 1,
      botToken: "123456789:rotated",
    });
    assert.equal((await f.telegram.status(f.admin, true)).connected, false);
    await assert.rejects(
      f.telegram.invite(f.investor),
      /telegram_not_connected/,
    );
    await f.telegram.connect(f.admin);
    await f.link();
    f.setBot(999999);
    const oldSecret = await f.secret();
    await f.telegram.connect(f.admin);
    assert.equal((await f.telegram.status(f.investor)).linked, false);
    assert.notEqual(await f.secret(), oldSecret);
    await assert.rejects(
      f.telegram.webhook(f.tenantId, oldSecret, {}),
      /forbidden/,
    );
  } finally {
    await f.cleanup();
  }
});

test("personal invites expire, replace prior invites and require the sender's own verified mobile", async () => {
  const f = await telegramFixture();
  try {
    await f.telegram.connect(f.admin);
    const first = await f.telegram.invite(f.investor);
    const second = await f.telegram.invite(f.investor);
    const token = (url: string) => new URL(url).searchParams.get("start");
    await f.message(101, { text: `/start ${token(first.url)}` });
    assert.match(String(f.calls.at(-1)!.body.text), /expired/);
    await f.message(101, { text: `/start ${token(second.url)}` });
    assert.deepEqual(f.calls.at(-1)!.body.reply_markup, {
      keyboard: [[{ text: "Share my phone number", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    await f.message(101, {
      contact: { user_id: 102, phone_number: "919876543210" },
    });
    assert.equal((await f.telegram.status(f.investor)).linked, false);
    await f.message(101, {
      contact: { user_id: 101, phone_number: "919999999999" },
    });
    assert.equal((await f.telegram.status(f.investor)).linked, false);
    await f.message(101, {
      contact: { user_id: 101, phone_number: "not a number" },
    });
    await f.message(101, {
      contact: { user_id: 101, phone_number: "919876543210" },
    });
    assert.equal((await f.telegram.status(f.investor)).linked, true);
    assert.equal((await f.query("SELECT * FROM telegram_invites")).length, 0);
    const row = (await f.query("SELECT * FROM telegram_links"))[0];
    assert.ok(!String(row.contact_cipher).includes("9876543210"));
    await f.link(102);
    assert.equal(
      (await f.query("SELECT * FROM telegram_links"))[0].telegram_user_id,
      "102",
    );
    await f.message(101, { text: "/stop" });
    assert.equal((await f.telegram.status(f.investor)).linked, true);
    await f.telegram.unlink(f.investor);
    assert.equal((await f.telegram.status(f.investor)).linked, false);
    const expired = await f.telegram.invite(f.investor);
    f.advance(11 * 60000);
    await f.message(101, { text: `/start ${token(expired.url)}` });
    assert.match(String(f.calls.at(-1)!.body.text), /expired/);
    await f.query(
      "UPDATE tenant_memberships SET mobile_verified_at=NULL WHERE id=?",
      [f.memberId],
    );
    await assert.rejects(
      f.telegram.invite(f.investor),
      /mobile_verification_required/,
    );
  } finally {
    await f.cleanup();
  }
});

test("webhooks reject forged secrets, ignore groups and duplicates, and prevent sharing a Telegram identity", async () => {
  const f = await telegramFixture();
  try {
    await f.telegram.connect(f.admin);
    await assert.rejects(
      f.telegram.webhook(f.tenantId, "wrong", {}),
      /forbidden/,
    );
    await f.telegram.webhook(f.tenantId, await f.secret(), {
      update_id: 0,
      message: {
        chat: { id: -1, type: "group" },
        from: { id: 101, is_bot: false },
      },
    });
    await f.link();
    await f.link(101, f.other);
    assert.equal((await f.telegram.status(f.other)).linked, false);
    await f.message(101, { text: "/stop" }, 500);
    assert.equal((await f.telegram.status(f.investor)).linked, false);
    await f.link();
    const count = f.calls.length;
    await f.message(101, { text: "/stop" }, 500);
    assert.equal(f.calls.length, count);
    assert.equal((await f.telegram.status(f.investor)).linked, true);
    await f.query(
      "UPDATE tenant_memberships SET mobile='9999999999' WHERE id=?",
      [f.memberId],
    );
    assert.equal((await f.telegram.status(f.investor)).linked, false);
  } finally {
    await f.cleanup();
  }
});

test("webhooks ignore malformed updates, non-private chats and unmatched contacts", async () => {
  const f = await telegramFixture();
  try {
    await f.telegram.connect(f.admin);
    await f.telegram.webhook(f.tenantId, await f.secret(), {});
    await f.message(101, { text: "/start unknown-token" });
    await f.message(101, {
      contact: { user_id: 999, phone_number: "919876543210" },
    });
    await f.message(101, {
      contact: { user_id: 101, phone_number: "not-a-mobile" },
    });
    await f.message(101, {
      contact: { user_id: 101, phone_number: "919999999999" },
    });
    await f.telegram.webhook(f.tenantId, await f.secret(), {
      update_id: 99,
      message: {
        from: { id: 101, is_bot: false },
        chat: { id: 202, type: "private" },
        text: "/start",
      },
    });
    assert.equal(
      (await f.query("SELECT COUNT(*) AS n FROM telegram_links"))[0].n,
      0,
    );
    assert.equal(
      (await f.query("SELECT COUNT(*) AS n FROM telegram_updates"))[0].n,
      4,
    );
  } finally {
    await f.cleanup();
  }
});

test("publication and manual send queue the same eligible frozen audience once and use the latest linked chat", async () => {
  const f = await telegramFixture();
  try {
    await f.telegram.connect(f.admin);
    await f.link();
    const id = await f.publish();
    const before = await f.research.detail(f.admin, id);
    assert.deepEqual(before.telegramDelivery, { pending: 1 });
    await assert.rejects(
      f.research.sendTelegram(f.investor, id, before.version),
      /forbidden/,
    );
    await assert.rejects(
      f.research.sendTelegram(f.admin, id, 1),
      /version_conflict/,
    );
    await f.research.sendTelegram(f.admin, id, before.version);
    assert.equal(
      (await f.query("SELECT * FROM telegram_deliveries")).length,
      1,
    );
    await f.link(202);
    assert.equal(await f.telegram.deliverOne(), true);
    const sent = f.calls.at(-1)!.body;
    assert.equal(sent.chat_id, "202");
    assert.equal(sent.protect_content, true);
    assert.match(String(sent.text), /EXAMPLE/);
    assert.match(String(sent.text), /disclosures/);
    assert.equal(await f.telegram.deliverOne(), false);
    assert.deepEqual((await f.research.detail(f.admin, id)).telegramDelivery, {
      delivered: 1,
    });
    assert.equal(
      (await f.research.detail(f.investor, id)).telegramDelivery,
      undefined,
    );
    await f.research.close(f.admin, id, {
      version: before.version,
      status: "closed",
      reason: "Research view is complete",
      sendTelegram: true,
    });
    await f.telegram.deliverOne();
    assert.match(String(f.calls.at(-1)!.body.text), /CLOSED/);
  } finally {
    await f.cleanup();
  }
});

test("Telegram opt-in failures roll back publication and dashboard-only publication can be sent later", async () => {
  const f = await telegramFixture();
  try {
    await assert.rejects(f.publish(), /telegram_not_connected/);
    assert.equal((await f.query("SELECT * FROM research_revisions")).length, 0);
    const id = await f.publish(false);
    assert.equal(
      (await f.query("SELECT * FROM telegram_deliveries")).length,
      0,
    );
    await f.telegram.connect(f.admin);
    await f.research.sendTelegram(f.admin, id, 2);
    await f.telegram.deliverOne();
    assert.deepEqual((await f.research.detail(f.admin, id)).telegramDelivery, {
      skipped: 1,
    });
  } finally {
    await f.cleanup();
  }
});

test("delivery rechecks revocation, mobile verification and saved token before calling Telegram", async (t) => {
  for (const change of ["revoked", "mobile", "token", "capabilities"])
    await t.test(change, async () => {
      const f = await telegramFixture();
      try {
        await f.telegram.connect(f.admin);
        await f.link();
        await f.publish();
        if (change === "revoked")
          await f.query(
            "UPDATE tenant_memberships SET status='revoked' WHERE id=?",
            [f.memberId],
          );
        if (change === "mobile")
          await f.query(
            "UPDATE tenant_memberships SET mobile_verified_at=NULL WHERE id=?",
            [f.memberId],
          );
        if (change === "capabilities")
          await f.query(
            "UPDATE tenant_memberships SET capabilities_json=? WHERE id=?",
            [JSON.stringify({ deny: ["research:read"] }), f.memberId],
          );
        if (change === "token")
          await f.integrations.save(f.admin, "telegram", {
            version: 1,
            botToken: "123456789:changed",
          });
        const count = f.calls.length;
        await f.telegram.deliverOne();
        assert.equal(f.calls.length, count);
        assert.equal(
          (await f.query("SELECT status FROM telegram_deliveries"))[0].status,
          "skipped",
        );
      } finally {
        await f.cleanup();
      }
    });
});

test("rate limits retry with delay; blocked accounts disconnect; uncertain and abandoned sends never replay", async (t) => {
  for (const code of [429, 403, 0, 500])
    await t.test(String(code), async () => {
      const f = await telegramFixture();
      try {
        await f.telegram.connect(f.admin);
        await f.link();
        await f.publish();
        f.fail(new TelegramError(code, 60));
        await f.telegram.deliverOne();
        assert.equal(
          (await f.query("SELECT status FROM telegram_deliveries"))[0].status,
          code === 429 ? "pending" : code === 403 ? "failed" : "unknown",
        );
        assert.equal(await f.telegram.deliverOne(), false);
        if (code === 429) {
          f.advance(61000);
          f.fail();
          assert.equal(await f.telegram.deliverOne(), true);
        }
        if (code === 403)
          assert.equal((await f.telegram.status(f.investor)).linked, false);
        await f.query(
          "UPDATE telegram_deliveries SET status='sending',lease_until='2020-01-01'",
        );
        assert.equal(await f.telegram.deliverOne(), false);
        assert.equal(
          (await f.query("SELECT status FROM telegram_deliveries"))[0].status,
          "unknown",
        );
      } finally {
        await f.cleanup();
      }
    });
});

test("Telegram transport uses fixed origin, protected body and generic failures without token leakage", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.telegram.org/bot123:secret/getMe");
      assert.equal(init?.redirect, "error");
      return Response.json({ ok: true, result: { id: 123 } });
    };
    assert.deepEqual(await telegramApi("123:secret", "getMe"), { id: 123 });
    globalThis.fetch = async () =>
      Response.json(
        { ok: false, error_code: 429, parameters: { retry_after: 5 } },
        { status: 429 },
      );
    await assert.rejects(
      telegramApi("secret", "sendMessage"),
      (e: TelegramError) =>
        e.providerCode === 429 &&
        e.retryAfter === 5 &&
        !e.message.includes("secret"),
    );
    globalThis.fetch = async () =>
      Response.json({ ok: false, error_code: 0 }, { status: 503 });
    await assert.rejects(
      telegramApi("secret", "sendMessage"),
      (error: TelegramError) =>
        error.providerCode === 503 && error.retryAfter === 60,
    );
    globalThis.fetch = async () =>
      Response.json(
        { ok: true, result: {}, parameters: { retry_after: 90000 } },
        { status: 200 },
      );
    assert.deepEqual(await telegramApi("secret", "getMe"), {});
    globalThis.fetch = async () => {
      throw new Error("https://api.telegram.org/botSECRET/getMe");
    };
    await assert.rejects(
      telegramApi("SECRET", "getMe"),
      (e: Error) => !e.message.includes("SECRET"),
    );
  } finally {
    globalThis.fetch = original;
  }
});
