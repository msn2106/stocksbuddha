import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { onboardingFixture } from "./onboarding-fixture";
import { keyed, seal, unseal } from "../src/onboarding/domain";
import { repairLegacyOnboarding } from "../../database/legacy-onboarding";
import type { KycProfile } from "@ra/contracts";

/** Convert fixture evidence to the former dev fallback key, retaining its exact business facts. */
async function legacyFixture() {
  const f = onboardingFixture();
  const { planId } = await f.setup();
  const order = await f.service.quote(f.investor, {
    planId,
    key: randomUUID(),
  });
  const current = f.env.ONBOARDING_DATA_KEY,
    old = f.env.AUTH_SECRET;
  const [kyc] = await f.query(
    "SELECT * FROM investor_kyc WHERE membership_id=?",
    [f.memberId],
  );
  const profile = unseal<KycProfile>(current, String(kyc.profile_cipher));
  const legacyKyc = {
    ...kyc,
    profile_cipher: seal(old, profile),
    pan_hash: keyed(old, `pan:${f.tenantId}:${profile.pan}`),
    family_hash: keyed(old, `pan:${f.tenantId}:${profile.familyPan}`),
  };
  await f.query(
    "UPDATE investor_kyc SET profile_cipher=?,pan_hash=?,family_hash=? WHERE membership_id=?",
    [
      legacyKyc.profile_cipher,
      legacyKyc.pan_hash,
      legacyKyc.family_hash,
      f.memberId,
    ],
  );
  await f.query("UPDATE kyc_history SET snapshot_cipher=?", [
    seal(old, legacyKyc),
  ]);
  const [row] = await f.query("SELECT * FROM subscription_orders WHERE id=?", [
    order.id,
  ]);
  const snapshot = unseal(current, String(row.snapshot_cipher));
  const signature = {
    name: "Fixture",
    hash: row.agreement_hash,
    method: "skipped_dev",
  };
  await f.query(
    "UPDATE subscription_orders SET snapshot_cipher=?,signature_cipher=?,family_hash=?,otp_hash=?,otp_expires_at=? WHERE id=?",
    [
      seal(old, snapshot),
      seal(old, signature),
      legacyKyc.family_hash,
      "old-code-hash",
      "2099-01-01",
      order.id,
    ],
  );
  return {
    ...f,
    order,
    snapshot,
    signature,
    legacyKyc,
    normalizedProfile: profile,
  };
}

test("development key repair dry-runs, backs up before writing, preserves signed facts and migrates nested history and keyed family lookups atomically", async () => {
  const f = await legacyFixture();
  try {
    await assert.rejects(f.service.read(f.admin));
    const before = await f.query("SELECT * FROM investor_kyc");
    const dry = await repairLegacyOnboarding(f.db, f.env);
    assert.deepEqual(dry, {
      kyc: 1,
      history: 2,
      orders: 1,
      signatures: 1,
      expiredCodes: 1,
      panConflicts: 0,
      applied: false,
    });
    assert.deepEqual(await f.query("SELECT * FROM investor_kyc"), before);
    await assert.rejects(
      repairLegacyOnboarding(f.db, f.env, true),
      /backup_required/,
    );
    await assert.rejects(
      repairLegacyOnboarding(f.db, f.env, true, async () => {
        throw new Error("backup failed");
      }),
      /backup failed/,
    );
    assert.deepEqual(await f.query("SELECT * FROM investor_kyc"), before);
    let backup = false;
    await repairLegacyOnboarding(f.db, f.env, true, async (rows) => {
      backup = true;
      assert.equal(rows.orders.length, 1);
      assert.deepEqual(await f.query("SELECT * FROM investor_kyc"), before);
    });
    assert.ok(backup);
    const read = await f.service.read(f.admin);
    assert.equal(read.users.length, 2);
    const [order] = await f.query("SELECT * FROM subscription_orders");
    assert.deepEqual(
      unseal(f.env.ONBOARDING_DATA_KEY, String(order.snapshot_cipher)),
      f.snapshot,
    );
    assert.deepEqual(
      unseal(f.env.ONBOARDING_DATA_KEY, String(order.signature_cipher)),
      f.signature,
    );
    assert.equal(order.agreement_hash, f.signature.hash);
    assert.equal(order.otp_hash, null);
    assert.equal(
      order.family_hash,
      keyed(
        f.env.ONBOARDING_DATA_KEY,
        `pan:${f.tenantId}:${f.normalizedProfile.familyPan}`,
      ),
    );
    const [history] = await f.query("SELECT * FROM kyc_history");
    const nested = unseal<{ profile_cipher: string; version: number }>(
      f.env.ONBOARDING_DATA_KEY,
      String(history.snapshot_cipher),
    );
    assert.deepEqual(
      unseal(f.env.ONBOARDING_DATA_KEY, nested.profile_cipher),
      f.normalizedProfile,
    );
    assert.equal(nested.version, 2);
    assert.deepEqual(
      await repairLegacyOnboarding(f.db, f.env, true, async () => {
        throw new Error("must not back up unchanged rows");
      }),
      {
        kyc: 0,
        history: 0,
        orders: 0,
        signatures: 0,
        expiredCodes: 0,
        panConflicts: 0,
        applied: true,
      },
    );
  } finally {
    f.close();
  }
});

test("development key repair refuses production, missing keys, corruption and unmatched lookup hashes without changing records", async () => {
  const f = await legacyFixture();
  try {
    for (const overrides of [
      { DB_ENV: "prod" },
      { NODE_ENV: "production" },
      { ONBOARDING_DATA_KEY: "" },
      { AUTH_SECRET: "" },
      { AUTH_SECRET: f.env.ONBOARDING_DATA_KEY },
    ])
      await assert.rejects(
        repairLegacyOnboarding(f.db, { ...f.env, ...overrides }),
      );
    await f.query("UPDATE investor_kyc SET pan_hash='invalid'");
    await assert.rejects(repairLegacyOnboarding(f.db, f.env), /hash_mismatch/);
    await f.query("UPDATE investor_kyc SET pan_hash=NULL,family_hash=?", [
      keyed(f.env.AUTH_SECRET, `dev:${f.memberId}`),
    ]);
    await f.query(
      "UPDATE subscription_orders SET signature_cipher=NULL,otp_hash=NULL",
    );
    assert.equal((await repairLegacyOnboarding(f.db, f.env)).signatures, 0);
    await f.query("UPDATE investor_kyc SET profile_cipher='corrupted'");
    await assert.rejects(
      repairLegacyOnboarding(f.db, f.env, true, async () => {
        assert.fail("corruption must fail before backup");
      }),
      /unreadable_evidence/,
    );
  } finally {
    f.close();
  }
});

test("repair preserves conflicting PAN identities and current order hashes while migrating only an old signature", async () => {
  const f = await legacyFixture();
  try {
    const panHash = keyed(
      f.env.ONBOARDING_DATA_KEY,
      `pan:${f.tenantId}:${f.normalizedProfile.pan}`,
    );
    await f.query(
      "INSERT INTO investor_kyc(membership_id,tenant_id,profile_cipher,pan_hash,family_hash,status,version) VALUES (?,?,?,?,?,'draft',1)",
      [
        f.otherMemberId,
        f.tenantId,
        seal(f.env.ONBOARDING_DATA_KEY, f.normalizedProfile),
        panHash,
        panHash,
      ],
    );
    const [history] = await f.query("SELECT * FROM kyc_history LIMIT 1");
    await f.query("UPDATE kyc_history SET snapshot_cipher=? WHERE id=?", [
      seal(f.env.ONBOARDING_DATA_KEY, f.legacyKyc),
      history.id,
    ]);
    await f.query(
      "UPDATE subscription_orders SET snapshot_cipher=?,family_hash=?",
      [seal(f.env.ONBOARDING_DATA_KEY, f.snapshot), panHash],
    );
    const report = await repairLegacyOnboarding(
      f.db,
      f.env,
      true,
      async () => {},
    );
    assert.equal(report.panConflicts, 1);
    const [preserved] = await f.query(
      "SELECT * FROM investor_kyc WHERE membership_id=?",
      [f.memberId],
    );
    assert.equal(preserved.pan_hash, f.legacyKyc.pan_hash);
    assert.equal(preserved.family_hash, panHash);
    assert.deepEqual(
      unseal(f.env.ONBOARDING_DATA_KEY, String(preserved.profile_cipher)),
      f.normalizedProfile,
    );
    const [order] = await f.query("SELECT * FROM subscription_orders");
    assert.equal(order.otp_hash, "old-code-hash");
    assert.equal(order.otp_expires_at, "2099-01-01");
    assert.equal(order.family_hash, panHash);
    assert.deepEqual(
      unseal(f.env.ONBOARDING_DATA_KEY, String(order.signature_cipher)),
      f.signature,
    );
    await assert.rejects(
      repairLegacyOnboarding(f.db, { DB_ENV: "dev" }),
      /keys_required/,
    );
  } finally {
    f.close();
  }
});
