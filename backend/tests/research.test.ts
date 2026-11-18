import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { researchDraftSchema } from "@ra/contracts";
import { indiaDate, addDays } from "../src/market/policy";
import { researchFixture } from "./research-fixture";

test("published research freezes entitled recipients, keeps draft updates private and retains history after subscription expiry", async () => {
  const f = await researchFixture();
  try {
    const id = randomUUID();
    await f.service.save(f.admin, { id, version: 0, draft: f.draft });
    assert.equal((await f.service.list(f.investor)).items.length, 0);
    await assert.rejects(f.service.detail(f.investor, id), /not_found/);
    const preview = await f.service.preview(f.admin, id);
    assert.equal(preview.recipientCount, 1);
    assert.equal(preview.check.allowed, true);
    assert.ok(preview.token);
    await f.service.publish(f.admin, id, {
      version: 1,
      token: preview.token,
      confirmed: true,
      reason: "",
    });
    let received = (await f.service.list(f.investor)).items[0];
    assert.equal(received.latest?.title, f.draft.title);
    assert.equal(received.draft, undefined);
    assert.equal(received.recipientCount, undefined);
    assert.equal(received.unread, true);
    assert.equal((await f.service.list(f.other)).items.length, 0);
    await assert.rejects(f.service.detail(f.other, id), /not_found/);
    await assert.rejects(
      f.service.detail({ ...f.admin, tenantId: f.otherTenantId }, id),
      /forbidden/,
    );
    await f.service.markRead(f.investor, id, 2);
    assert.equal((await f.service.list(f.investor)).items[0].unread, false);
    await assert.rejects(
      f.service.publish(f.admin, id, {
        version: 1,
        token: preview.token,
        confirmed: true,
        reason: "",
      }),
      /version_conflict/,
    );
    const original = await f.service.detail(f.investor, id);
    assert.equal(original.history.length, 1);
    await f.service.save(f.admin, {
      id,
      version: 2,
      draft: { ...f.draft, title: "Revised valuation" },
    });
    received = (await f.service.list(f.investor)).items[0];
    assert.equal(received.latest?.title, f.draft.title);
    const updated = await f.service.preview(f.admin, id);
    await assert.rejects(
      f.service.publish(f.admin, id, {
        version: 3,
        token: updated.token,
        confirmed: true,
        reason: "",
      }),
      /update_reason/,
    );
    await f.service.publish(f.admin, id, {
      version: 3,
      token: updated.token,
      confirmed: true,
      reason: "Updated valuation after earnings review",
    });
    assert.equal((await f.service.detail(f.investor, id)).history.length, 2);
    const register = await f.market.read(f.admin);
    assert.equal(register.recommendations.length, 2);
    assert.ok(register.recommendations[0].closedOn);
    assert.equal(register.recommendations[1].sourceResearchId, id);
    await assert.rejects(
      f.market.mutate(f.admin, {
        action: "close",
        version: register.version,
        id: register.recommendations[1].id,
        reason: "Bypass published update workflow",
      }),
      /not_found/,
    );
    f.setClock(new Date("2026-12-02"));
    await f.query(
      "UPDATE subscription_orders SET ends_at='2026-11-18' WHERE id=?",
      [f.orderId],
    );
    assert.equal(
      (await f.service.detail(f.investor, id)).latest?.title,
      "Revised valuation",
    );
    await f.service.close(f.admin, id, {
      version: 4,
      status: "closed",
      reason: "Research closed after target review",
    });
    const closed = await f.service.detail(f.investor, id);
    assert.equal(closed.latest?.status, "closed");
    assert.equal(closed.history.length, 3);
    assert.equal(closed.history.at(-1)?.title, f.draft.title);
    assert.ok(closed.unread);
    await assert.rejects(
      f.service.save(f.admin, { id, version: 5, draft: f.draft }),
      /final/,
    );
    await f.query("UPDATE tenant_memberships SET status='revoked' WHERE id=?", [
      f.memberId,
    ]);
    await assert.rejects(f.service.detail(f.investor, id), /forbidden/);
  } finally {
    await f.cleanup();
  }
});
test("preview tokens cannot bypass changing declarations, KYC, paid offering, tenant audience or expired data", async () => {
  const f = await researchFixture();
  try {
    const id = randomUUID();
    await f.service.save(f.admin, { id, version: 0, draft: f.draft });
    const p = await f.service.preview(f.admin, id);
    await f.market.mutate(f.admin, {
      action: "declare",
      version: 1,
      coveredFrom: "2026-11-17",
      confirmed: true,
    });
    await assert.rejects(
      f.service.publish(f.admin, id, {
        version: 1,
        token: p.token,
        confirmed: true,
        reason: "",
      }),
      /preview_changed/,
    );
    await f.market.mutate(f.admin, {
      action: "trade",
      version: 2,
      value: {
        instrumentKey: "NSE_EQ|INE1",
        person: "Owner",
        account: "Self",
        date: "2026-11-16",
        side: "sell",
        quantity: 1,
        note: "",
      },
    });
    const conflict = await f.service.preview(f.admin, id);
    assert.equal(conflict.token, null);
    assert.ok(conflict.check.conflicts.length);
    await assert.rejects(
      f.service.publish(f.admin, id, {
        version: 1,
        token: p.token,
        confirmed: true,
        reason: "",
      }),
      /publication_blocked/,
    );
    const recorded = await f.market.read(f.admin);
    await f.market.mutate(f.admin, {
      action: "correct",
      version: recorded.version,
      id: recorded.trades[0].id,
      reason: "Wrong instrument selected in test declaration",
    });
    await f.market.mutate(f.admin, {
      action: "declare",
      version: recorded.version + 1,
      coveredFrom: "2026-11-17",
      confirmed: true,
    });
    await f.query(
      "UPDATE investor_kyc SET status='rejected' WHERE membership_id=?",
      [f.memberId],
    );
    assert.equal((await f.service.preview(f.admin, id)).recipientCount, 0);
    await f.query(
      "UPDATE investor_kyc SET status='verified' WHERE membership_id=?",
      [f.memberId],
    );
    await f.query("DELETE FROM research_order_offerings");
    assert.equal((await f.service.preview(f.admin, id)).recipientCount, 0);
    await f.query(
      "INSERT INTO research_order_offerings(tenant_id,order_id,offering) VALUES (?,?,?)",
      [f.tenantId, f.orderId, "equity"],
    );
    await f.service.save(f.admin, {
      id,
      version: 1,
      draft: { ...f.draft, audience: { mode: "plans", ids: [randomUUID()] } },
    });
    await assert.rejects(f.service.preview(f.admin, id), /invalid_audience/);
    await f.service.save(f.admin, {
      id,
      version: 2,
      draft: { ...f.draft, audience: { mode: "plans", ids: [f.planId] } },
    });
    assert.equal((await f.service.preview(f.admin, id)).recipientCount, 1);
    f.setClock(new Date("2026-12-02"));
    const stale = await f.service.preview(f.admin, id);
    assert.ok(stale.reasons.includes("validity_expired"));
    assert.ok(stale.check.reasons.includes("catalogue_stale"));
    await assert.rejects(
      f.service.save(f.investor, {
        id: randomUUID(),
        version: 0,
        draft: f.draft,
      }),
      /forbidden/,
    );
    await assert.rejects(f.service.options(f.investor), /forbidden/);
  } finally {
    await f.cleanup();
  }
});
test("groups remain tenant-private and cannot grant access; attachment downloads reauthorize after network I/O", async () => {
  const f = await researchFixture();
  try {
    const group = randomUUID();
    await f.service.saveGroup(f.admin, {
      id: group,
      version: 0,
      name: "Swing clients",
      membershipIds: [f.memberId, f.otherMemberId],
    });
    assert.equal(
      (await f.service.options(f.admin)).groups[0].membershipIds.length,
      2,
    );
    await assert.rejects(
      f.service.saveGroup(f.admin, {
        id: group,
        version: 0,
        name: "Stale update",
        membershipIds: [],
      }),
      /version_conflict/,
    );
    await assert.rejects(
      f.service.saveGroup(f.admin, {
        id: randomUUID(),
        version: 0,
        name: "Foreign group",
        membershipIds: [randomUUID()],
      }),
      /invalid_group_member/,
    );
    const file = await f.documents.upload(f.admin, {
      kind: "general",
      name: "research.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 research evidence"),
    });
    const id = randomUUID();
    await f.service.save(f.admin, {
      id,
      version: 0,
      draft: {
        ...f.draft,
        attachmentIds: [file.id],
        audience: { mode: "groups", ids: [group] },
      },
    });
    const p = await f.service.preview(f.admin, id);
    assert.equal(p.recipientCount, 1);
    assert.equal(p.snapshot.attachments[0].name, "research.pdf");
    await f.service.publish(f.admin, id, {
      version: 1,
      token: p.token,
      confirmed: true,
      reason: "",
    });
    assert.match(
      (await f.service.download(f.investor, id, file.id)).bytes.toString(),
      /research evidence/,
    );
    await assert.rejects(f.service.download(f.other, id, file.id), /not_found/);
    await assert.rejects(
      f.service.download(f.investor, id, randomUUID()),
      /not_found/,
    );
    const original = f.drive.download.bind(f.drive);
    f.drive.download = async (...args) => {
      const bytes = await original(...args);
      await f.query(
        "UPDATE tenant_memberships SET status='revoked' WHERE id=?",
        [f.memberId],
      );
      return bytes;
    };
    await assert.rejects(
      f.service.download(f.investor, id, file.id),
      /forbidden/,
    );
  } finally {
    await f.cleanup();
  }
});
test("hedges and contracts validate lot multiples, expiry, premium direction and unsupported shapes", async () => {
  const f = await researchFixture();
  try {
    assert.equal(
      researchDraftSchema.safeParse({
        ...f.draft,
        legs: [{ ...f.draft.legs[0], stopLoss: 110 }],
      }).success,
      false,
    );
    assert.equal(
      researchDraftSchema.safeParse({ ...f.draft, offering: "hedges" }).success,
      false,
    );
    const id = randomUUID(),
      leg = { ...f.draft.legs[0], instrumentKey: "NSE_FO|0", quantity: 1 };
    await f.service.save(f.admin, {
      id,
      version: 0,
      draft: { ...f.draft, offering: "options", legs: [leg] },
    });
    assert.ok(
      (await f.service.preview(f.admin, id)).reasons.includes(
        "quantity_must_match_lot_size",
      ),
    );
    await f.service.save(f.admin, {
      id,
      version: 1,
      draft: {
        ...f.draft,
        offering: "hedges",
        legs: [
          { ...leg, quantity: 50 },
          { ...leg, instrumentKey: "NSE_FO|1", quantity: 50 },
        ],
      },
    });
    assert.ok((await f.service.preview(f.admin, id)).token);
    await assert.rejects(
      f.service.save(f.admin, { id, version: 0, draft: f.draft }),
      /version_conflict/,
    );
    const p = await f.service.preview(f.admin, id);
    await f.service.publish(f.admin, id, {
      version: 2,
      token: p.token,
      confirmed: true,
      reason: "",
    });
    await assert.rejects(
      f.service.save(f.admin, { id, version: 3, draft: f.draft }),
      /published_scope_locked/,
    );
    assert.equal((await f.market.read(f.admin)).recommendations.length, 2);
    const day = indiaDate(new Date("2026-11-17"));
    assert.equal(addDays(day, 5), "2026-11-22");
  } finally {
    await f.cleanup();
  }
});

test("draft contracts reject inconsistent entries, duplicate targets and malformed audiences", async () => {
  const f = await researchFixture();
  try {
    const l = f.draft.legs[0];
    for (const leg of [
      { ...l, entryMax: 90 },
      { ...l, targets: [120, 120] },
      { ...l, targets: [100] },
      { ...l, side: "sell", stopLoss: 90 },
      { ...l, side: "sell", stopLoss: 110, targets: [120] },
    ])
      assert.equal(
        researchDraftSchema.safeParse({ ...f.draft, legs: [leg] }).success,
        false,
      );
    assert.equal(
      researchDraftSchema.safeParse({
        ...f.draft,
        legs: [{ ...l, side: "sell", stopLoss: 110, targets: [90] }],
      }).success,
      true,
    );
    assert.equal(
      researchDraftSchema.safeParse({
        ...f.draft,
        legs: [{ ...l, side: "hold" }],
      }).success,
      true,
    );
    for (const audience of [
      { mode: "plans", ids: [] },
      { mode: "all", ids: [randomUUID()] },
    ])
      assert.equal(
        researchDraftSchema.safeParse({ ...f.draft, audience }).success,
        false,
      );
    assert.equal(
      researchDraftSchema.safeParse({
        ...f.draft,
        offering: "hedges",
        legs: [l, l],
      }).success,
      false,
    );
  } finally {
    await f.cleanup();
  }
});
test("preview explains missing declarations, mismatched contracts, production review and absent registration", async () => {
  const f = await researchFixture();
  try {
    const id = randomUUID();
    await f.service.save(f.admin, { id, version: 0, draft: f.draft });
    await assert.rejects(
      f.service.list({ ...f.admin, token: "missing" }),
      /unauthorized/,
    );
    await assert.rejects(f.service.list(f.admin, -1), /invalid_page/);
    await f.query("DELETE FROM ra_market_state WHERE tenant_id=?", [
      f.tenantId,
    ]);
    await f.query("UPDATE tenants SET registration_number=NULL WHERE id=?", [
      f.tenantId,
    ]);
    let p = await f.service.preview(f.admin, id);
    assert.ok(p.check.reasons.includes("current_declaration_required"));
    assert.ok(p.reasons.includes("registration_required"));
    Object.assign(f.env, { NODE_ENV: "production" });
    Object.assign(f.env, { ONBOARDING_PRODUCTION_APPROVED: "false" });
    p = await f.service.preview(f.admin, id);
    assert.ok(p.reasons.includes("production_review_required"));
    await f.query("UPDATE subscription_orders SET dev=1 WHERE id=?", [
      f.orderId,
    ]);
    assert.equal((await f.service.preview(f.admin, id)).recipientCount, 0);
    Object.assign(f.env, { NODE_ENV: "development" });
    await f.query(
      "UPDATE investor_kyc SET status='skipped_dev' WHERE membership_id=?",
      [f.memberId],
    );
    assert.equal((await f.service.preview(f.admin, id)).recipientCount, 1);
    let version = 1;
    for (const offering of ["equity", "futures", "options"] as const) {
      await f.service.save(f.admin, {
        id,
        version: version++,
        draft: {
          ...f.draft,
          offering,
          legs: [
            {
              ...f.draft.legs[0],
              instrumentKey: offering === "equity" ? "NSE_FO|0" : "NSE_EQ|INE1",
            },
          ],
        },
      });
      assert.ok(
        (await f.service.preview(f.admin, id)).reasons.includes(
          "offering_instrument_mismatch",
        ),
      );
    }
    await f.service.save(f.admin, {
      id,
      version: version++,
      draft: {
        ...f.draft,
        offering: "futures",
        validUntil: "2027-01-01T00:00:00Z",
        legs: [{ ...f.draft.legs[0], instrumentKey: "NSE_FO|2", quantity: 50 }],
      },
    });
    assert.ok(
      (await f.service.preview(f.admin, id)).reasons.includes(
        "validity_after_contract_expiry",
      ),
    );
    await f.service.save(f.admin, {
      id,
      version: version++,
      draft: {
        ...f.draft,
        legs: [{ ...f.draft.legs[0], instrumentKey: "missing" }],
      },
    });
    await assert.rejects(
      f.service.preview(f.admin, id),
      /instrument_not_found/,
    );
    const group = randomUUID();
    await f.service.saveGroup(f.admin, {
      id: group,
      version: 0,
      name: "Empty recipients",
      membershipIds: [],
    });
    await f.service.saveGroup(f.admin, {
      id: group,
      version: 1,
      name: "Ineligible only",
      membershipIds: [f.otherMemberId],
    });
    await f.service.save(f.admin, {
      id,
      version: version++,
      draft: { ...f.draft, audience: { mode: "groups", ids: [group] } },
    });
    assert.equal((await f.service.preview(f.admin, id)).recipientCount, 0);
    assert.equal(
      (await f.service.options(f.admin)).groups[0].name,
      "Ineligible only",
    );
    await f.service.save(f.admin, {
      id,
      version: version++,
      draft: {
        ...f.draft,
        audience: { mode: "plans", ids: [f.otherTenantId] },
      },
    });
    await assert.rejects(f.service.preview(f.admin, id), /invalid_audience/);
    await assert.rejects(
      f.service.save(f.admin, { id: randomUUID(), version: 1, draft: f.draft }),
      /version_conflict/,
    );
  } finally {
    await f.cleanup();
  }
});
