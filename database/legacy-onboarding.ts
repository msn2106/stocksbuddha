import type { DataSource } from "typeorm";
import {
  keyed,
  seal,
  unseal,
  requireValue,
} from "../backend/src/onboarding/domain";

import type { KycProfile } from "@ra/contracts";
type KycRecord = {
  tenant_id: string;
  membership_id: string;
  profile_cipher: string;
  pan_hash: string | null;
  family_hash: string | null;
};
type HistoryRecord = { id: string; snapshot_cipher: string };
type OrderRecord = {
  id: string;
  tenant_id: string;
  membership_id: string;
  snapshot_cipher: string;
  signature_cipher: string | null;
  family_hash: string;
  otp_hash: string | null;
  otp_expires_at: string | null;
};
type Backup = {
  kyc: KycRecord[];
  history: HistoryRecord[];
  orders: OrderRecord[];
};
/** Explicitly migrate development-only AUTH_SECRET fallback evidence to the retained data key; never enable a runtime fallback. */
export async function repairLegacyOnboarding(
  db: DataSource,
  env: NodeJS.ProcessEnv,
  apply = false,
  backup?: (originals: Backup) => Promise<void>,
) {
  requireValue(
    env.DB_ENV === "dev" && env.NODE_ENV !== "production",
    "legacy_repair_dev_only",
  );
  const current = env.ONBOARDING_DATA_KEY ?? "",
    legacy = env.AUTH_SECRET ?? "";
  requireValue(
    /^[0-9a-f]{64}$/.test(current) && legacy.length >= 32 && current !== legacy,
    "legacy_repair_keys_required",
  );
  requireValue(!apply || backup, "legacy_repair_backup_required");
  /** Authenticate using the current key first, then only the known previous development fallback. */
  function decode<T>(cipher: string): { value: T; legacy: boolean } {
    try {
      return { value: unseal<T>(current, cipher), legacy: false };
    } catch {
      try {
        return { value: unseal<T>(legacy, cipher), legacy: true };
      } catch {
        throw new Error("legacy_repair_unreadable_evidence");
      }
    }
  }
  /** Preserve null hashes and verify the old lookup before rebuilding it under the retained key. */
  function rotateHash(
    value: string | null,
    tenantId: string,
    memberId: string,
    pan: string,
    family: boolean,
  ) {
    if (value == null) return value;
    const candidates = [
      `pan:${tenantId}:${pan}`,
      ...(family ? [`dev:${memberId}`] : []),
    ];
    const input = candidates.find(
      (candidate) => keyed(legacy, candidate) === value,
    );
    requireValue(input, "legacy_repair_hash_mismatch");
    return keyed(current, input);
  }
  /** Re-encrypt a KYC row and its keyed lookup values while leaving review and version facts intact. */
  function migrateKyc(row: KycRecord) {
    const profile = decode<KycProfile>(row.profile_cipher);
    if (!profile.legacy) return row;
    return {
      ...row,
      profile_cipher: seal(current, profile.value),
      pan_hash: rotateHash(
        row.pan_hash,
        row.tenant_id,
        row.membership_id,
        profile.value.pan,
        false,
      ),
      family_hash: rotateHash(
        row.family_hash,
        row.tenant_id,
        row.membership_id,
        profile.value.familyPan,
        true,
      ),
    };
  }
  return db.transaction(async (manager) => {
    // Match the tenant locks used by onboarding writers before reading any evidence.
    await manager.query("SELECT id FROM tenants ORDER BY id FOR UPDATE");
    const originals: Backup = {
      kyc: await manager.query("SELECT * FROM investor_kyc FOR UPDATE"),
      history: await manager.query("SELECT * FROM kyc_history FOR UPDATE"),
      orders: await manager.query(
        "SELECT * FROM subscription_orders FOR UPDATE",
      ),
    };
    const counts = {
      kyc: 0,
      history: 0,
      orders: 0,
      signatures: 0,
      expiredCodes: 0,
      panConflicts: 0,
    };
    const panOwners = new Map(
      originals.kyc
        .filter((row) => row.pan_hash != null)
        .map((row) => [`${row.tenant_id}:${row.pan_hash}`, row.membership_id]),
    );
    const updates: { sql: string; values: unknown[] }[] = [];
    for (const row of originals.kyc) {
      const next = migrateKyc(row);
      if (next === row) continue;
      const lookup = `${row.tenant_id}:${next.pan_hash}`;
      const existingOwner = panOwners.get(lookup);
      if (
        next.pan_hash &&
        existingOwner &&
        existingOwner !== row.membership_id
      ) {
        // Preserve the existing conflicting identity for explicit admin correction.
        // Family accounting still migrates, so the duplicate cannot split fee limits.
        next.pan_hash = row.pan_hash;
        counts.panConflicts++;
      } else if (next.pan_hash) panOwners.set(lookup, row.membership_id);
      counts.kyc++;
      updates.push({
        sql: "UPDATE investor_kyc SET profile_cipher=?,pan_hash=?,family_hash=? WHERE membership_id=? AND tenant_id=?",
        values: [
          next.profile_cipher,
          next.pan_hash,
          next.family_hash,
          row.membership_id,
          row.tenant_id,
        ],
      });
    }
    for (const row of originals.history) {
      const snapshot = decode<KycRecord>(row.snapshot_cipher),
        next = migrateKyc(snapshot.value);
      if (!snapshot.legacy && next === snapshot.value) continue;
      counts.history++;
      updates.push({
        sql: "UPDATE kyc_history SET snapshot_cipher=? WHERE id=?",
        values: [seal(current, next), row.id],
      });
    }
    for (const row of originals.orders) {
      const snapshot = decode<{ profile: KycProfile }>(row.snapshot_cipher);
      const signature = row.signature_cipher
        ? decode(row.signature_cipher)
        : null;
      if (!snapshot.legacy && !signature?.legacy) continue;
      counts.orders++;
      if (signature?.legacy) counts.signatures++;
      if (snapshot.legacy && row.otp_hash) counts.expiredCodes++;
      updates.push({
        sql: "UPDATE subscription_orders SET snapshot_cipher=?,signature_cipher=?,family_hash=?,otp_hash=?,otp_expires_at=? WHERE id=?",
        values: [
          snapshot.legacy ? seal(current, snapshot.value) : row.snapshot_cipher,
          signature?.legacy
            ? seal(current, signature.value)
            : row.signature_cipher,
          snapshot.legacy
            ? rotateHash(
                row.family_hash,
                row.tenant_id,
                row.membership_id,
                snapshot.value.profile.familyPan,
                true,
              )
            : row.family_hash,
          snapshot.legacy ? null : row.otp_hash,
          snapshot.legacy && row.otp_hash ? null : row.otp_expires_at,
          row.id,
        ],
      });
    }
    if (apply && updates.length) {
      // Backup must finish successfully before the first update; any failure rolls back all DML.
      await backup!(originals);
      for (const update of updates)
        await manager.query(update.sql, update.values);
    }
    return { ...counts, applied: apply };
  });
}
