import { createHash } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Share atomic authentication limits between processes without retaining raw IP addresses. */
export function databaseRateLimiter(pool: Pool) {
  return {
    /** Serialize the check/increment under a row lock, using the database clock for all processes. */
    async consume(key: string, rule: { window: number; max: number }) {
      const digest = createHash("sha256").update(key).digest("hex");
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          "INSERT INTO auth_rate_limits(bucket_key,hits,started_at,expires_at) VALUES (?,0,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND)) ON DUPLICATE KEY UPDATE bucket_key=VALUES(bucket_key)",
          [digest, rule.window],
        );
        const [rows] = await connection.execute<RowDataPacket[]>(
          "SELECT hits,TIMESTAMPDIFF(MICROSECOND,started_at,UTC_TIMESTAMP(3))/1000000 AS elapsed FROM auth_rate_limits WHERE bucket_key=? FOR UPDATE",
          [digest],
        );
        const elapsed = Number(rows[0].elapsed);
        const expired = elapsed >= rule.window;
        const allowed = expired || Number(rows[0].hits) < rule.max;
        if (allowed)
          await connection.execute(
            expired
              ? "UPDATE auth_rate_limits SET hits=1,started_at=UTC_TIMESTAMP(3),expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND) WHERE bucket_key=?"
              : "UPDATE auth_rate_limits SET hits=hits+1 WHERE bucket_key=?",
            expired ? [rule.window, digest] : [digest],
          );
        await connection.commit();
        // Bound retention work and exclude the bucket just consumed. No cleanup timer owns a process handle.
        await connection.execute(
          "DELETE FROM auth_rate_limits WHERE expires_at<UTC_TIMESTAMP(3) AND bucket_key<>? LIMIT 100",
          [digest],
        );
        return {
          allowed,
          retryAfter: allowed
            ? null
            : Math.max(1, Math.ceil(rule.window - elapsed)),
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
