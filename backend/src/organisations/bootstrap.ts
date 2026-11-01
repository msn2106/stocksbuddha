import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";

/** Bootstrap one verified platform owner through an operator-only transaction; no public role-grant endpoint exists. */
export async function bootstrapOwner(db: DataSource, email: string) {
  return db.transaction(async (manager) => {
    const owners: { id: string }[] = await manager.query(
      "SELECT id FROM auth_users WHERE platform_role='owner' FOR UPDATE",
    );
    const [user] = await manager.query(
      "SELECT id,email_verified FROM auth_users WHERE email=? FOR UPDATE",
      [email.trim().toLowerCase()],
    );
    if (!user?.email_verified)
      throw new Error("An existing verified account is required");
    if (owners.some((owner) => owner.id !== user.id))
      throw new Error("A different platform owner already exists");
    if (owners.length) return { userId: user.id, changed: false };
    await manager.query(
      "UPDATE auth_users SET platform_role='owner',updated_at=UTC_TIMESTAMP(3) WHERE id=?",
      [user.id],
    );
    await manager.query(
      "INSERT INTO audit_events(id,scope,actor_type,action,entity_type,entity_id,reason,metadata_json) VALUES (?,'platform','system','platform.owner_bootstrapped','auth_user',?,'Explicit operator bootstrap',?)",
      [randomUUID(), user.id, '{"schemaVersion":1}'],
    );
    return { userId: user.id, changed: true };
  });
}
