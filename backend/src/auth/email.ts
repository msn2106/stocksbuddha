export type AuthEmail = { to: string; url: string; kind: "verify" | "reset" };
export type AuthMailer = (message: AuthEmail) => Promise<void>;

/** Configure bounded transactional delivery; missing production credentials fail startup instead of dropping emails. */
export function authMailer(
  env: NodeJS.ProcessEnv,
  transport = fetch,
): AuthMailer | undefined {
  if (
    !env.RESEND_API_KEY &&
    !env.AUTH_EMAIL_FROM &&
    env.NODE_ENV !== "production"
  )
    return undefined;
  if (
    !env.RESEND_API_KEY ||
    !env.AUTH_EMAIL_FROM ||
    /[\r\n]/.test(env.AUTH_EMAIL_FROM)
  )
    throw new Error(
      "RESEND_API_KEY and AUTH_EMAIL_FROM are required for authentication email",
    );
  const origin = new URL(env.AUTH_BASE_URL!).origin;
  return async ({ to, url, kind }) => {
    if (new URL(url).origin !== origin)
      throw new Error("Invalid authentication email origin");
    const subject =
      kind === "verify"
        ? "Verify your StocksBuddha account"
        : "Reset your StocksBuddha password";
    let response: Response;
    try {
      response = await transport("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.AUTH_EMAIL_FROM,
          to: [to],
          subject,
          text: `${subject}\n\n${url}\n\nThis link expires in one hour. If you did not request this, you can ignore this email. Your identity is shared across StocksBuddha workspaces; this email does not grant tenant membership.`,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new Error("Authentication email delivery failed");
    }
    // Provider bodies can contain recipient details; never attach them to errors or telemetry.
    if (!response.ok) throw new Error("Authentication email delivery failed");
  };
}
