import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";

/** Reserve password-reset emails globally per identity, leaving ordinary login and other mail unaffected. */
export class RecoveryEmailLimiter {
  /** Inject the shared database and clock; reservations persist even when SMTP fails. */
  constructor(
    private readonly db: DataSource,
    private readonly now = () => new Date(),
  ) {}

  /** Atomically allow at most five sends per rolling day and one per minute across all entry points. */
  async reserve(userId: string): Promise<boolean> {
    return this.db.transaction(async (manager) => {
      const [user] = await manager.query(
        "SELECT id FROM auth_users WHERE id=? FOR UPDATE",
        [userId],
      );
      if (!user) return false;
      const now = this.now();
      const sends: { created_at: string | Date }[] = await manager.query(
        "SELECT created_at FROM recovery_email_sends WHERE user_id=? AND created_at>? ORDER BY created_at DESC LIMIT 5",
        [userId, new Date(now.getTime() - 86400000)],
      );
      if (sends.length >= 5) return false;
      const latest = sends[0]?.created_at;
      const sentAt =
        latest instanceof Date
          ? latest.getTime()
          : latest
            ? Date.parse(
                latest.includes("T") ? latest : `${latest.replace(" ", "T")}Z`,
              )
            : 0;
      if (latest && now.getTime() - sentAt < 60000) return false;
      await manager.query(
        "INSERT INTO recovery_email_sends(id,user_id,created_at) VALUES (?,?,?)",
        [randomUUID(), userId, now],
      );
      return true;
    });
  }
}
