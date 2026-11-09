import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { onboardingFixture } from "./onboarding-fixture";
import { SmsService } from "../src/sms/service";
import type { SmsMessage } from "../src/sms/horizon";
import type { SmsSettings } from "../src/sms/policy";

/** Exercise production SMS SQL and cryptography against a controlled transactional persistence adapter. */
export async function smsFixture() {
  const f = onboardingFixture();
  const tables: Record<string, string> = {
    sms_settings:
      "tenant_id TEXT PRIMARY KEY,config_cipher TEXT,version INTEGER,vendor_user_hash TEXT",
    sms_mutex: "id INTEGER PRIMARY KEY",
    sms_challenges:
      "id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,membership_id TEXT,purpose TEXT,mobile_hash TEXT,mobile_cipher TEXT,code_hash TEXT,credential_hash TEXT,sends INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,created_at TEXT,sent_at TEXT,expires_at TEXT,consumed_at TEXT",
    sms_events:
      "id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,challenge_id TEXT,mobile_hash TEXT,ip_hash TEXT,kind TEXT,status TEXT,request_key TEXT,evidence_cipher TEXT,message_id TEXT,balance TEXT,created_at TEXT,UNIQUE(tenant_id,user_id,request_key)",
    sms_security_notices:
      "id TEXT PRIMARY KEY,user_id TEXT,attempts INTEGER DEFAULT 0,available_at TEXT,lease_until TEXT,sent_at TEXT",
    account_recovery_mobiles:
      "user_id TEXT PRIMARY KEY,mobile_hash TEXT UNIQUE,mobile_cipher TEXT,verified_at TEXT",
    auth_rate_limits:
      "bucket_key TEXT PRIMARY KEY,hits INTEGER,started_at TEXT,expires_at TEXT",
    auth_accounts:
      "user_id TEXT,provider_id TEXT,password TEXT,updated_at TEXT",
    auth_verifications:
      "id TEXT PRIMARY KEY,identifier TEXT,value TEXT,expires_at TEXT",
  };
  for (const [table, definition] of Object.entries(tables))
    f.memory.exec(`CREATE TABLE ${table} (${definition})`);
  f.memory.exec("INSERT INTO sms_mutex VALUES (1)");
  const password = "Existing-password-123!";
  await f.query(
    "INSERT INTO auth_accounts(user_id,provider_id,password) VALUES (?,'credential',?)",
    [f.userId, await hashPassword(password)],
  );
  const sent: SmsMessage[] = [],
    notices: string[] = [];
  const clock = { value: new Date() },
    failure = { sms: false, mail: false };
  const env: NodeJS.ProcessEnv & typeof f.env = {
    ...f.env,
    SMS_MODE: "trial",
    SMS_RECOVERY_SETTINGS_JSON: JSON.stringify({
      username: "platform",
      apiKey: "platform-private-key",
      senderId: "HORIZN",
      entityId: "110100000000001",
      encoding: "txt",
      template: {
        id: "110100000000003",
        text: "Your recovery code is {{otp}}. Valid for {{expiryMinutes}} minutes.",
      },
    }),
  };
  const service = new SmsService(
    f.db,
    env,
    async (message) => {
      sent.push(message);
      if (failure.sms) throw new Error("secret vendor failure");
      return { messageId: "123456", balance: "10" };
    },
    () => clock.value,
    async (email) => {
      if (failure.mail) throw new Error("mail down");
      notices.push(email);
    },
  );
  const config: SmsSettings = {
    version: 0,
    enabled: true,
    username: "test",
    apiKey: "private-api-key",
    senderId: "HORIZN",
    entityId: "110100000000001",
    encoding: "txt",
    verification: {
      id: "110100000000002",
      text: "Your mobile code is {{otp}}. Valid for {{expiryMinutes}} minutes.",
    },
  };
  /** Send a fresh attempt with controlled request identity and default trial destination. */
  const send = (mobile = "9599400141", key = randomUUID()) =>
    service.send({ context: f.investor, mobile, key, ip: "127.0.0.1" });
  /** Read the last code only from the test transport, never from stored challenge state. */
  const code = () => sent.at(-1)!.message.match(/\b\d{6}\b/)![0];
  /** Supply the exact current request context to the verification boundary. */
  const verify = (challengeId: string, otp = code()) =>
    service.verify({
      context: f.investor,
      challengeId,
      code: otp,
      ip: "127.0.0.1",
    });
  /** Move server time without sleeps, keeping database-side expiry fixtures independently valid. */
  const advance = (milliseconds: number) => {
    clock.value = new Date(clock.value.getTime() + milliseconds);
  };
  return {
    ...f,
    service,
    env,
    config,
    clock,
    failure,
    sent,
    notices,
    password,
    send,
    code,
    verify,
    advance,
  };
}
