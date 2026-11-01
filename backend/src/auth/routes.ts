import express, { type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { slugSchema, type AccountView, type Tenant } from "@ra/contracts";
import type { createAuthentication } from "./config";
import type { Workspace, WorkspaceStore } from "./workspaces";
import type { TenantOperations } from "../database/operations";
import { DatabaseConflict } from "../database/operations";
import { withAuthTenant } from "./tenant-context";
import { clientIp, trustedProxies } from "./client-ip";
import { monitorTenant } from "../monitoring";

type Authentication = ReturnType<typeof createAuthentication>["auth"];
export type AuthRoutesDependencies = {
  auth: Pick<Authentication, "handler"> & {
    api: Pick<Authentication["api"], "getSession">;
  };
  store: WorkspaceStore;
  operations: Pick<TenantOperations, "changeMembership" | "enroll">;
  baseURL: string;
  trustedProxyAddresses?: string;
  emailEnabled?: boolean;
};

/** Pass a safe account projection to the shared React SSR pipeline, excluding session tokens. */
function accountPage(
  res: Response,
  next: NextFunction,
  tenant: Tenant | null,
  account: AccountView,
  status = 200,
) {
  res.status(status);
  res.locals.accountPage = {
    tenant,
    website: null,
    page: "account",
    locale: "en",
    account,
  };
  next();
}
/** Expose only public workspace identity, the current member role and derived capabilities. */
function projection(workspace: Workspace) {
  return {
    tenant: {
      id: workspace.tenant.id,
      slug: workspace.tenant.slug,
      name: workspace.tenant.profile.name,
    },
    membership: workspace.membership,
    capabilities: workspace.capabilities,
  };
}

/** Mount Better Auth before body parsing and enforce fresh session/membership checks for every private request. */
export function createAuthRoutes({
  auth,
  store,
  operations,
  baseURL,
  trustedProxyAddresses,
  emailEnabled = false,
}: AuthRoutesDependencies) {
  const router = express.Router();
  const origin = new URL(baseURL).origin;
  const trusted = trustedProxies(trustedProxyAddresses);
  router.use(
    [
      "/api/auth",
      "/api/session",
      "/api/workspaces",
      "/workspace",
      "/login",
      "/signup",
      "/logout",
      "/ra/:slug/login",
      "/ra/:slug/signin",
      "/ra/:slug/signup",
      "/ra/:slug/logout",
      "/ra/:slug/workspace",
      "/ra/:slug/verify-email",
      "/ra/:slug/forgot-password",
      "/ra/:slug/reset-password",
      "/ra/:slug/join",
    ],
    (req, res, next) => {
      req.headers["x-auth-client-ip"] = clientIp(req, trusted);
      res.setHeader(
        "Content-Security-Policy",
        "form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
      );
      next();
    },
  );
  const authHandler = toNodeHandler(auth);
  router.all("/api/auth/{*path}", (req, res) =>
    withAuthTenant(null, () => authHandler(req, res)),
  );
  router.use(
    express.json({ limit: "8kb" }),
    express.urlencoded({ extended: false, limit: "8kb" }),
  );

  router.get(["/login", "/signin", "/signup"], (req, res) =>
    res.redirect(
      302,
      `/ra/stocksbuddha/${req.path === "/signup" ? "signup" : "login"}`,
    ),
  );
  router.get("/ra/:slug/signin", (req, res) =>
    res.redirect(
      308,
      `/ra/${encodeURIComponent(req.params.slug as string)}/login`,
    ),
  );
  // Resolve tenant context from the route; never accept it from credentials or hidden fields.
  router.use(
    [
      "/ra/:slug/login",
      "/ra/:slug/signup",
      "/ra/:slug/logout",
      "/ra/:slug/workspace",
      "/ra/:slug/verify-email",
      "/ra/:slug/forgot-password",
      "/ra/:slug/reset-password",
      "/ra/:slug/join",
    ],
    async (req, res, next) => {
      const slug = slugSchema.safeParse(req.params.slug);
      const tenant = slug.success ? await store.tenant(slug.data) : null;
      if (!tenant)
        return res.status(404).json({ error: "workspace_not_found" });
      res.locals.accountTenant = tenant;
      monitorTenant(tenant.id);
      next();
    },
  );
  for (const signup of [false, true]) {
    const path = `/ra/:slug/${signup ? "signup" : "login"}`;
    const mode = signup ? "signup" : "login";
    router.get(path, (_req, res, next) =>
      accountPage(res, next, res.locals.accountTenant, { mode }),
    );
    router.post(path, async (req, res, next) => {
      if (req.headers.origin !== origin)
        return res.status(403).json({ error: "forbidden_origin" });
      const response = await withAuthTenant(res.locals.accountTenant.id, () =>
        auth.handler(
          new Request(
            `${origin}/api/auth/${signup ? "sign-up" : "sign-in"}/email`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin,
                "x-auth-client-ip": req.headers["x-auth-client-ip"] as string,
              },
              body: JSON.stringify({
                email: req.body?.email,
                password: req.body?.password,
                ...(signup ? { name: req.body?.name } : {}),
                ...(emailEnabled
                  ? {
                      callbackURL: `${origin}/ra/${res.locals.accountTenant.slug}/join`,
                    }
                  : {}),
              }),
            },
          ),
        ),
      );
      if (!response.ok) {
        if (
          emailEnabled &&
          response.status === 403 &&
          ((await response.clone().json()) as { code?: string }).code ===
            "EMAIL_NOT_VERIFIED"
        )
          return accountPage(res, next, res.locals.accountTenant, {
            mode: "verify-email",
            notice: "sent",
            email:
              typeof req.body?.email === "string"
                ? req.body.email.slice(0, 254)
                : "",
          });
        return accountPage(
          res,
          next,
          res.locals.accountTenant,
          {
            mode,
            error: "credentials",
            email:
              typeof req.body?.email === "string"
                ? req.body.email.slice(0, 254)
                : "",
            name:
              typeof req.body?.name === "string"
                ? req.body.name.slice(0, 160)
                : "",
          },
          response.status,
        );
      }
      if (signup && emailEnabled)
        return accountPage(res, next, res.locals.accountTenant, {
          mode: "verify-email",
          notice: "sent",
          email:
            typeof req.body?.email === "string"
              ? req.body.email.slice(0, 254)
              : "",
        });
      res.setHeader("Set-Cookie", response.headers.getSetCookie());
      return res.redirect(
        303,
        `/ra/${res.locals.accountTenant.slug}/${emailEnabled ? "join" : "workspace"}`,
      );
    });
  }
  // Token-bearing reset links are exchanged for a short-lived HttpOnly cookie, then removed from the URL.
  router.get("/ra/:slug/reset-password", (req, res, next) => {
    const token = req.query.token;
    const cookiePath = `/ra/${res.locals.accountTenant.slug}/reset-password`;
    if (typeof token === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(token)) {
      res.cookie("sb-password-reset", token, {
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
    const path = `/ra/:slug/${mode}`;
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
      const base = `${origin}/ra/${res.locals.accountTenant.slug}`;
      const token = req.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("sb-password-reset="))
        ?.slice("sb-password-reset=".length);
      const body =
        mode === "reset-password"
          ? { token, newPassword: req.body?.password }
          : {
              email: req.body?.email,
              ...(mode === "verify-email"
                ? { callbackURL: `${base}/join` }
                : { redirectTo: `${base}/reset-password` }),
            };
      const response = await withAuthTenant(res.locals.accountTenant.id, () =>
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
        res.clearCookie("sb-password-reset", {
          httpOnly: true,
          secure: origin.startsWith("https://"),
          sameSite: "strict",
          path: `/ra/${res.locals.accountTenant.slug}/reset-password`,
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
  router.post(["/logout", "/ra/:slug/logout"], async (req, res) => {
    if (req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    const response = await auth.handler(
      new Request(`${origin}/api/auth/sign-out`, {
        method: "POST",
        headers: fromNodeHeaders(req.headers),
      }),
    );
    if (!response.ok)
      return res.status(response.status).json({ error: "sign_out_failed" });
    res.setHeader("Set-Cookie", response.headers.getSetCookie());
    return res.redirect(
      303,
      `/ra/${res.locals.accountTenant?.slug ?? "stocksbuddha"}/login`,
    );
  });
  router.use(
    [
      "/workspace",
      "/ra/:slug/workspace",
      "/ra/:slug/join",
      "/api/workspaces",
      "/api/session",
    ],
    async (req, res, next) => {
      const identity = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!identity) {
        if (!req.originalUrl.startsWith("/api/"))
          return res.redirect(
            303,
            `/ra/${res.locals.accountTenant?.slug ?? req.params.slug ?? "stocksbuddha"}/login`,
          );
        return res.status(401).json({ error: "unauthorized" });
      }
      res.locals.identity = identity;
      next();
    },
  );
  router.get("/ra/:slug/join", async (_req, res, next) => {
    const tenant: Tenant = res.locals.accountTenant;
    if (await store.find(res.locals.identity.user.id, tenant.slug))
      return res.redirect(303, `/ra/${tenant.slug}/workspace`);
    return accountPage(res, next, tenant, { mode: "join" });
  });
  router.post("/ra/:slug/join", async (req, res, next) => {
    if (req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    try {
      await operations.enroll({
        token: res.locals.identity.session.token,
        tenantId: res.locals.accountTenant.id,
        key: randomUUID(),
      });
      return res.redirect(
        303,
        `/ra/${res.locals.accountTenant.slug}/workspace`,
      );
    } catch (error) {
      if (!(error instanceof DatabaseConflict)) throw error;
      return accountPage(
        res,
        next,
        res.locals.accountTenant,
        { mode: "unavailable" },
        403,
      );
    }
  });
  router.get("/api/session", (_req, res) => {
    const { user, session } = res.locals.identity;
    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      expiresAt: session.expiresAt,
    });
  });
  router.post("/api/workspaces/:slug/membership", async (req, res) => {
    if (req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    const slug = slugSchema.safeParse(req.params.slug);
    const tenant = slug.success ? await store.tenant(slug.data) : null;
    if (!tenant) return res.status(404).json({ error: "workspace_not_found" });
    monitorTenant(tenant.id);
    const key = req.get("Idempotency-Key") ?? "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        key,
      )
    )
      return res.status(400).json({ error: "invalid_operation_key" });
    try {
      return res.json(
        await operations.enroll({
          token: res.locals.identity.session.token,
          tenantId: tenant.id,
          key,
        }),
      );
    } catch (error) {
      if (!(error instanceof DatabaseConflict)) throw error;
      return res
        .status(
          error.code === "unauthorized"
            ? 401
            : error.code === "idempotency_conflict"
              ? 409
              : 403,
        )
        .json({ error: error.code });
    }
  });
  router.get(["/workspace", "/api/workspaces"], async (req, res, next) => {
    const workspaces = await store.list(res.locals.identity.user.id);
    if (req.path.startsWith("/api/"))
      return res.json({ workspaces: workspaces.map(projection) });
    return accountPage(res, next, null, {
      mode: "workspaces",
      workspaces: workspaces.map((workspace) => ({
        slug: workspace.tenant.slug,
        name: workspace.tenant.profile.name,
        role: workspace.membership.role,
      })),
    });
  });
  router.get("/workspace/:slug", (req, res) =>
    res.redirect(
      302,
      `/ra/${encodeURIComponent(req.params.slug as string)}/workspace`,
    ),
  );
  router.use(
    ["/ra/:slug/workspace", "/api/workspaces/:slug"],
    async (req, res, next) => {
      const parsed = slugSchema.safeParse(req.params.slug);
      const workspace = parsed.success
        ? await store.find(res.locals.identity.user.id, parsed.data)
        : null;
      if (!workspace) {
        if (!req.originalUrl.startsWith("/api/"))
          return accountPage(
            res,
            next,
            res.locals.accountTenant,
            { mode: "unavailable" },
            404,
          );
        return res.status(404).json({ error: "workspace_not_found" });
      }
      res.locals.workspace = workspace;
      monitorTenant(workspace.tenant.id);
      next();
    },
  );
  router.get(
    ["/ra/:slug/workspace", "/api/workspaces/:slug"],
    (req, res, next) => {
      if (res.locals.accountPage) return next();
      const workspace: Workspace = res.locals.workspace;
      if (req.path.startsWith("/api/")) return res.json(projection(workspace));
      return accountPage(res, next, workspace.tenant, {
        mode: "workspace",
        role: workspace.membership.role,
        capabilities: workspace.capabilities,
      });
    },
  );
  router.get("/api/workspaces/:slug/members", async (_req, res) => {
    const workspace: Workspace = res.locals.workspace;
    if (!workspace.capabilities.includes("staff:manage"))
      return res.status(403).json({ error: "forbidden" });
    return res.json({ members: await store.members(workspace.tenant.id) });
  });
  router.patch("/api/workspaces/:slug/members/:id", async (req, res) => {
    if (req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    const workspace: Workspace = res.locals.workspace;
    if (!workspace.capabilities.includes("staff:manage"))
      return res.status(403).json({ error: "forbidden" });
    const { role, active, version } = req.body ?? {};
    const key = req.get("Idempotency-Key") ?? "";
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (
      !uuid.test(req.params.id as string) ||
      !["owner", "analyst", "support", "subscriber"].includes(role) ||
      typeof active !== "boolean" ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !uuid.test(key)
    )
      return res.status(400).json({ error: "invalid_membership_request" });
    try {
      const result = await operations.changeMembership(
        {
          token: res.locals.identity.session.token,
          tenantId: workspace.tenant.id,
          key,
        },
        req.params.id as string,
        version,
        role,
        active,
      );
      return res.json(result);
    } catch (error) {
      if (!(error instanceof DatabaseConflict)) throw error;
      const status =
        error.code === "unauthorized"
          ? 401
          : [
                "forbidden",
                "tenant_unavailable",
                "capability_overrides_not_enabled",
              ].includes(error.code)
            ? 403
            : 409;
      return res.status(status).json({ error: error.code });
    }
  });
  router.use(
    ["/workspace", "/ra/:slug/workspace", "/api/workspaces", "/api/session"],
    (_req, res, next) =>
      res.locals.accountPage
        ? next()
        : res.status(404).json({ error: "not_found" }),
  );
  return router;
}
