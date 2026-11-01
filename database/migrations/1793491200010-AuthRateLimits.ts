import type { MigrationInterface, QueryRunner } from "typeorm";

/** Store shared authentication counters independently of tenant business and verification records. */
export class CreateAuthRateLimits1793491200010 implements MigrationInterface {
  name = "CreateAuthRateLimits1793491200010";
  /** Create bounded, expiring rate buckets whose keys are one-way digests. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE auth_rate_limits (
bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
hits INT UNSIGNED NOT NULL,started_at DATETIME(3) NOT NULL,expires_at DATETIME(3) NOT NULL,
KEY ix_rate_expiry(expires_at)) ENGINE=InnoDB`);
  }
  /** Preserve the explicit forward-recovery migration policy. */
  async down(): Promise<void> {
    throw new Error("Forward recovery required");
  }
}
