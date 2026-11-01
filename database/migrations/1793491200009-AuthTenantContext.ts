import type { MigrationInterface, QueryRunner } from "typeorm";

/** Add authentication provenance without changing global identity or tenant authorization. */
export class AddAuthTenantContext1793491200009 implements MigrationInterface {
  name = "AddAuthTenantContext1793491200009";

  /** Keep existing provenance unknown and atomically audit new identity/session insertions. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE auth_users
ADD COLUMN signup_tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
ADD KEY ix_signup_tenant(signup_tenant_id),
ADD CONSTRAINT fk_auth_user_signup_tenant FOREIGN KEY (signup_tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT`);
    await runner.query(`ALTER TABLE auth_sessions
ADD COLUMN login_tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
ADD KEY ix_login_tenant(login_tenant_id,created_at),
ADD CONSTRAINT fk_auth_session_login_tenant FOREIGN KEY (login_tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT`);
    await runner.query(`CREATE TRIGGER auth_users_audit_signup AFTER INSERT ON auth_users FOR EACH ROW
INSERT INTO audit_events(id,scope,tenant_id,actor_type,actor_user_id,action,entity_type,entity_id,metadata_json,occurred_at)
VALUES(UUID(),IF(NEW.signup_tenant_id IS NULL,'platform','tenant'),NEW.signup_tenant_id,'user',NEW.id,'auth.signup','auth_user',NEW.id,JSON_OBJECT('schemaVersion',1,'source','database_insert'),NEW.created_at)`);
    await runner.query(`CREATE TRIGGER auth_sessions_audit_login AFTER INSERT ON auth_sessions FOR EACH ROW
INSERT INTO audit_events(id,scope,tenant_id,actor_type,actor_user_id,action,entity_type,entity_id,metadata_json,occurred_at)
VALUES(UUID(),IF(NEW.login_tenant_id IS NULL,'platform','tenant'),NEW.login_tenant_id,'user',NEW.user_id,'auth.login','auth_session',NEW.id,JSON_OBJECT('schemaVersion',1,'source','database_insert'),NEW.created_at)`);
  }

  /** Preserve authentication history; recovery uses explicit forward migrations. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}
