import { SmsError, indianMobile } from "./policy";
export type SmsMessage = {
  username: string;
  apiKey: string;
  senderId: string;
  templateId: string;
  mobile: string;
  message: string;
  encoding: "txt" | "uni";
};
export type SmsTransport = (
  message: SmsMessage,
) => Promise<{ messageId: string; balance: string | null }>;

/** Build a fixed-origin, bounded vendor transport; trial mode rejects rather than redirects destinations. */
export function horizonTransport(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
): SmsTransport {
  const live = env.SMS_MODE === "live";
  if (env.SMS_MODE && !["trial", "live"].includes(env.SMS_MODE))
    throw new Error("Invalid SMS_MODE");
  return async (input) => {
    const mobile = indianMobile(input.mobile);
    if (!live && mobile !== "+919599400141")
      throw new SmsError("sms_trial_destination", 403);
    try {
      const response = await request("https://smshorizon.com/api/v2/sendsms", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          user: input.username,
          mobile: mobile.slice(3),
          senderid: input.senderId,
          message: input.message,
          tid: input.templateId,
          type: input.encoding,
        }),
      });
      const raw = await response.json();
      if (!raw || typeof raw !== "object") throw new Error("Invalid response");
      const result = raw as Record<string, unknown>;
      if (
        !response.ok ||
        result.error ||
        typeof result.msgid !== "string" ||
        !/^\d{1,30}$/.test(result.msgid)
      )
        throw new Error("Rejected");
      return {
        messageId: result.msgid,
        balance:
          typeof result.balance_after === "string"
            ? result.balance_after
            : null,
      };
    } catch {
      throw new SmsError("sms_delivery_uncertain", 503);
    }
  };
}
