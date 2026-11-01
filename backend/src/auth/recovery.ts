import express, { type Response, type NextFunction } from "express";
import type { AccountView, Tenant } from "@ra/contracts";
import type { AuthRoutesDependencies } from "./routes";
import { withAuthTenant } from "./tenant-context";

type Page = (
  res: Response,
  next: NextFunction,
  tenant: Tenant | null,
  account: AccountView,
  status?: number,
) => void;
/** Mount verification and password recovery without granting membership or platform ownership.
 * Platform callbacks and reset cookies stay under /workspace; tenant callbacks retain their RA context.
 * Raw reset credentials are exchanged for HttpOnly cookies and excluded from rendered page data.
 */
export function mountAccountRecovery(
  router: express.Router,
  {
    auth,
    origin,
    emailEnabled,
    page,
    platform = false,
  }: {
    auth: AuthRoutesDependencies["auth"];
    origin: string;
    emailEnabled: boolean;
    page: Page;
    platform?: boolean;
  },
) {
  const prefix = platform ? "/workspace" : "/ra/:slug";
  const cookieName = platform
    ? "sb-platform-password-reset"
    : "sb-password-reset";
  /** Project platform pages without tenant identity while preserving the shared account renderer. */
  const accountPage: Page = (res, next, tenant, account, status) =>
    page(
      res,
      next,
      platform ? null : tenant,
      { ...account, ...(platform ? { audience: "platform" as const } : {}) },
      status,
    );
  // Token-bearing reset links are exchanged for a short-lived HttpOnly cookie, then removed from the URL.
  router.get(`${prefix}/reset-password`, (req, res, next) => {
    const token = req.query.token;
    const cookiePath = platform
      ? "/workspace/reset-password"
      : `/ra/${res.locals.accountTenant.slug}/reset-password`;
    if (typeof token === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(token)) {
      res.cookie(cookieName, token, {
        httpOnly: true,
        secure: origin.startsWith("https://"),
        sameSite: "strict",
        path: cookiePath,
        maxAge: 3600000,
      });
      return res.redirect(303, cookiePath);
    }
    return accountPage(res, next, res.locals.accountTenant, {
      mode: "reset-password",
      ...(!emailEnabled ? { error: "service" as const } : {}),
      ...(req.query.error ? { error: "credentials" as const } : {}),
    });
  });
  for (const mode of [
    "verify-email",
    "forgot-password",
    "reset-password",
  ] as const) {
    const path = `${prefix}/${mode}`;
    if (mode !== "reset-password")
      router.get(path, (_req, res, next) =>
        accountPage(res, next, res.locals.accountTenant, {
          mode,
          ...(!emailEnabled ? { error: "service" as const } : {}),
        }),
      );
    router.post(path, async (req, res, next) => {
      if (req.headers.origin !== origin)
        return res.status(403).json({ error: "forbidden_origin" });
      if (!emailEnabled)
        return accountPage(
          res,
          next,
          res.locals.accountTenant,
          { mode, error: "service" },
          503,
        );
      const base = platform
        ? `${origin}/workspace`
        : `${origin}/ra/${res.locals.accountTenant.slug}`;
      const token = req.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      const body =
        mode === "reset-password"
          ? { token, newPassword: req.body?.password }
          : {
              email: req.body?.email,
              ...(mode === "verify-email"
                ? { callbackURL: `${base}/${platform ? "login" : "join"}` }
                : { redirectTo: `${base}/reset-password` }),
            };
      const response = await withAuthTenant(
        platform ? null : res.locals.accountTenant.id,
        () =>
          auth.handler(
            new Request(
              `${origin}/api/auth/${mode === "verify-email" ? "send-verification-email" : mode === "forgot-password" ? "request-password-reset" : "reset-password"}`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  origin,
                  "x-auth-client-ip": req.headers["x-auth-client-ip"] as string,
                },
                body: JSON.stringify(body),
              },
            ),
          ),
      );
      if (mode === "reset-password" && response.ok) {
        res.clearCookie(cookieName, {
          httpOnly: true,
          secure: origin.startsWith("https://"),
          sameSite: "strict",
          path: platform
            ? "/workspace/reset-password"
            : `/ra/${res.locals.accountTenant.slug}/reset-password`,
        });
        return accountPage(res, next, res.locals.accountTenant, {
          mode: "login",
          notice: "reset",
        });
      }
      return accountPage(
        res,
        next,
        res.locals.accountTenant,
        {
          mode,
          ...(response.ok
            ? { notice: "sent" as const }
            : { error: "credentials" as const }),
        },
        response.ok ? 200 : response.status,
      );
    });
  }
}
