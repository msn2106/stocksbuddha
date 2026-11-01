import nodemailer, {
  type SendMailOptions,
  type SMTPTransportOptions,
} from "nodemailer";

export type AuthEmail = {
  to: string;
  url: string;
  kind: "verify" | "reset" | "invite";
};
export type AuthMailer = (message: AuthEmail) => Promise<void>;
type SmtpClient = {
  sendMail: (message: SendMailOptions) => Promise<{
    accepted: unknown[];
    rejected: unknown[];
  }>;
  close: () => void;
};
export type SmtpFactory = (options: SMTPTransportOptions) => SmtpClient;

/** Configure Hostinger SMTP with verified TLS, bounded delivery and no provider secrets in errors.
 * The sender must match the authenticated mailbox. Partial configuration fails startup;
 * completely unconfigured development instances retain the explicit no-email preview behavior.
 */
export function authMailer(
  env: NodeJS.ProcessEnv,
  factory: SmtpFactory = nodemailer.createTransport,
): AuthMailer | undefined {
  const settings = [
    env.SMTP_HOST,
    env.SMTP_PORT,
    env.SMTP_USER,
    env.SMTP_PASSWORD,
    env.AUTH_EMAIL_FROM,
  ];
  if (!settings.some(Boolean) && env.NODE_ENV !== "production")
    return undefined;
  const host = env.SMTP_HOST ?? "smtp.hostinger.com";
  const port = Number(env.SMTP_PORT ?? 465);
  const user = env.SMTP_USER ?? "";
  const from = env.AUTH_EMAIL_FROM ?? "";
  const mailbox = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
  if (
    host !== "smtp.hostinger.com" ||
    ![465, 587].includes(port) ||
    !mailbox.test(user) ||
    !env.SMTP_PASSWORD ||
    from.toLowerCase() !== user.toLowerCase() ||
    !mailbox.test(from)
  )
    throw new Error(
      "Hostinger SMTP requires a valid mailbox, matching AUTH_EMAIL_FROM, password and encrypted port 465 or 587",
    );
  const origin = new URL(env.AUTH_BASE_URL!).origin;
  const options: SMTPTransportOptions = {
    host,
    port,
    secure: port === 465,
    requireTLS: true,
    auth: { user, pass: env.SMTP_PASSWORD },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: host },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
  return async ({ to, url, kind }) => {
    if (new URL(url).origin !== origin)
      throw new Error("Invalid authentication email origin");
    if (!mailbox.test(to))
      throw new Error("Invalid authentication email recipient");
    const subject =
      kind === "invite"
        ? "Your organisation invitation"
        : kind === "verify"
          ? "Verify your StocksBuddha account"
          : "Reset your StocksBuddha password";
    let client: SmtpClient | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      client = factory(options);
      const result = await Promise.race([
        client.sendMail({
          from,
          to,
          subject,
          text: `${subject}\n\n${url}\n\nThis link expires in one hour. If you did not request this, you can ignore this email. Your identity is shared across StocksBuddha workspaces. ${kind === "invite" ? "Sign in with this verified email and explicitly accept the invitation to receive the stored organisation role." : "This email does not grant tenant membership or organisation roles."}`,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("SMTP deadline exceeded")),
            10000,
          );
        }),
      ]);
      if (result.accepted.length !== 1 || result.rejected.length)
        throw new Error("SMTP recipient rejected");
    } catch {
      throw new Error("Authentication email delivery failed");
    } finally {
      clearTimeout(timer);
      client?.close();
    }
  };
}
