import { reportBackground } from "../background-monitoring";
import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";

/** Signal busy or expired storage work without disclosing provider details. */
export class StorageBusyError extends Error {
  /** Return a stable retryable application failure. */
  constructor() {
    super("document_storage_busy");
  }
}
/** Lease one scope across processes, releasing database connections during bounded provider calls.
 * Expired holders cannot publish metadata; remote orphans are retained for reconciliation.
 */
export async function storageLease<T, U, V>(
  db: DataSource,
  scope: string,
  prepare: (manager: EntityManager) => Promise<T>,
  transfer: (prepared: T) => Promise<U>,
  commit: (manager: EntityManager, prepared: T, uploaded: U) => Promise<V>,
) {
  const token = randomUUID();
  const prepared = await db.transaction(async (manager) => {
    await manager.query(
      "INSERT IGNORE INTO document_storage_leases(scope_id,token,lease_until) VALUES (?,? ,UTC_TIMESTAMP(3))",
      [scope, token],
    );
    const [lease] = await manager.query(
      "SELECT token,lease_until<=UTC_TIMESTAMP(3) AS expired FROM document_storage_leases WHERE scope_id=? FOR UPDATE",
      [scope],
    );
    if (!lease.expired) throw new StorageBusyError();
    const result = await prepare(manager);
    await manager.query(
      "UPDATE document_storage_leases SET token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE) WHERE scope_id=?",
      [token, scope],
    );
    return result;
  });
  try {
    const uploaded = await transfer(prepared);
    try {
      return await db.transaction(async (manager) => {
        const [lease] = await manager.query(
          "SELECT token,lease_until<=UTC_TIMESTAMP(3) AS expired FROM document_storage_leases WHERE scope_id=? FOR UPDATE",
          [scope],
        );
        if (lease.token !== token || lease.expired)
          throw new StorageBusyError();
        return commit(manager, prepared, uploaded);
      });
    } catch (error) {
      reportBackground("storage_orphan");
      throw error;
    }
  } finally {
    await db.query(
      "DELETE FROM document_storage_leases WHERE scope_id=? AND token=?",
      [scope, token],
    );
  }
}
