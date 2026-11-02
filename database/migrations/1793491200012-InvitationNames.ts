import type { MigrationInterface, QueryRunner } from "typeorm";

/** Preserve recipient names on invitations; historical invitations keep a nullable name. */
export class AddInvitationNames1793491200012 implements MigrationInterface {
  name = "AddInvitationNames1793491200012";
  /** Add recipient personalization without changing existing grants or credentials. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      "ALTER TABLE organisation_invitations ADD COLUMN full_name VARCHAR(100) NULL",
    );
  }
  /** Retain invitation evidence through forward recovery. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}
