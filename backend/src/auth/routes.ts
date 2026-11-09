import { mountOnboarding } from "../onboarding/routes";
import type { OnboardingService } from "../onboarding/service";
import { phone as signupPhone } from "../onboarding/domain";
import { mountDocuments } from "../documents/routes";
import type { DocumentService } from "../documents/service";
import {
  mountWebsiteEditor,
  type WebsiteOperations,
} from "../websites/editor-routes";
import express, { type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { slugSchema, type AccountView, type Tenant } from "@ra/contracts";
import type { createAuthentication } from "./config";
import type { Workspace, WorkspaceStore } from "./workspaces";
import type { TenantOperations } from "../database/operations";
import { DatabaseConflict } from "../database/operations";
import { withAuthTenant } from "./tenant-context";
import { authFailure } from "./response-error";
import { clientIp, trustedProxies } from "./client-ip";
import { monitorTenant } from "../monitoring";
import type { OrganisationService } from "../organisations/service";
import type { AuthMailer } from "./email";
import {
  createOrganisationRoutes,
  clearInvitationCookie,
  invitationCookie,
  responseCookie,
} from "../organisations/routes";
import { mountAccountRecovery } from "./recovery";
import {
  workspaceDestination,
  invitationRoleConflict,
} from "../organisations/policy";

type Authentication = ReturnType<typeof createAuthentication>["auth"];
export type AuthRoutesDependencies = {
  auth: Pick<Authentication, "handler"> & {
    api: Pick<Authentication["api"], "getSession">;
  };
  store: WorkspaceStore;
  operations: Pick<TenantOperations, "changeMembership" | "enroll">;
  websiteOperations?: WebsiteOperations;
  baseURL: string;
  trustedProxyAddresses?: string;
  emailEnabled?: boolean;
  organisations?: OrganisationService;
  mailer?: AuthMailer;
  documents?: DocumentService;
  onboarding?: OnboardingService;
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
    account: res.locals.onboardingEnabled
      ? { ...account, onboardingEnabled: true }
      : account,
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
  websiteOperations,
  baseURL,
  trustedProxyAddresses,
  emailEnabled = false,
  organisations,
  documents,
  onboarding,
  mailer,
}: AuthRoutesDependencies) {
  const router = express.Router();
  const origin = new URL(baseURL).origin;
  router.use((_req, res, next) => {
    res.locals.onboardingEnabled = Boolean(onboarding);
    next();
  });
  const trusted = trustedProxies(trustedProxyAddresses);
  router.use(
    [
      "/api/auth",
      "/api/session",
      "/api/workspaces",
      "/workspace",
      "/workspaces",
      "/ra/:slug/account",
      "/ra/:slug/invitation",
      "/login",
      "/signup",
      "/logout",
      "/ra/:slug/login",
      "/ra/:slug/signin",
      "/ra/:slug/signup",
      "/ra/:slug/logout",
      "/ra/:slug/workspace",
      "/ra/:slug/account",
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
  if (documents)
    mountDocuments(router, {
      auth,
      store,
      service: documents,
      origin,
      page: accountPage,
    });
  if (onboarding)
    mountOnboarding(router, {
      auth,
      store,
      service: onboarding,
      origin,
      page: accountPage,
    });
  router.use("/api/workspaces/:slug/website", express.json({ limit: "600kb" }));
  router.use(
    express.json({ limit: "8kb" }),
    express.urlencoded({ extended: false, limit: "8kb" }),
  );

  mountAccountRecovery(router, {
    auth,
    origin,
    emailEnabled,
    page: accountPage,
    platform: true,
  });

  // Platform identities are provisioned by operators; there is no public owner signup.
  router.all("/workspace/signup", (_req, res) =>
    res.status(404).json({ error: "not_found" }),
  );

  if (organisations)
    router.use(
      createOrganisationRoutes({
        auth,
        store,
        service: organisations,
        mailer,
        origin,
        page: accountPage,
      }),
    );
  router.get(["/login", "/signin", "/signup"], (req, res) =>
    res.redirect(
      302,
      `/?lang=${req.query.lang === "hi" ? "hi" : "en"}#${req.path === "/signup" ? "contact" : "access"}`,
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
      "/ra/:slug/workspace",
      "/ra/:slug/account",
      "/ra/:slug/verify-email",
      "/ra/:slug/forgot-password",
      "/ra/:slug/reset-password",
      "/ra/:slug/join",
    ],
    async (req, res, next) => {
      const slug = slugSchema.safeParse(req.params.slug);
      const tenant = slug.success
        ? ((await store.tenant(slug.data)) ??
          (
            await organisations?.preview(
              slug.data,
              invitationCookie(req.headers.cookie),
            )
          )?.tenant ??
          null)
        : null;
      if (!tenant)
        return res.status(404).json({ error: "workspace_not_found" });
      res.locals.accountTenant = tenant;
      monitorTenant(tenant.id);
      next();
    },
  );
  /** Offer role-specific signup guidance only after authenticating the requester as that exact email. */
  async function existingSignup(
    req: express.Request,
    res: Response,
    next: NextFunction,
  ) {
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (
      !identity ||
      (req.method === "POST" &&
        (typeof req.body?.email !== "string" ||
          req.body.email.trim().toLowerCase() !==
            identity.user.email.toLowerCase()))
    )
      return false;
    const workspace = await store.find(
      identity.user.id,
      res.locals.accountTenant.slug,
    );
    if (!workspace) return false;
    const staff = workspace.membership.role !== "subscriber";
    accountPage(
      res,
      next,
      workspace.tenant,
      {
        mode: "login",
        audience: staff ? "organisation" : "investor",
        email: identity.user.email,
        error: staff ? "staff_only" : "account_exists",
      },
      409,
    );
    return true;
  }
  for (const signup of [false, true]) {
    const path = `/ra/:slug/${signup ? "signup" : "login"}`;
    const mode = signup ? "signup" : "login";
    router.get(path, async (req, res, next) => {
      if (signup && (await existingSignup(req, res, next))) return;
      const audience =
        !signup && req.query.audience === "organisation"
          ? "organisation"
          : "investor";
      const invite =
        signup || audience === "organisation"
          ? await organisations?.preview(
              res.locals.accountTenant.slug,
              invitationCookie(req.headers.cookie),
            )
          : null;
      if (signup && invite)
        return res.redirect(
          303,
          `/ra/${res.locals.accountTenant.slug}/invitation`,
        );
      return accountPage(res, next, res.locals.accountTenant, {
        mode,
        audience,
        ...(invite
          ? {
              email: invite.email,
              invitedEmail: invite.email,
              invitedRole: invite.role,
            }
          : {}),
      });
    });
    router.post(path, async (req, res, next) => {
      if (req.headers.origin !== origin)
        return res.status(403).json({ error: "forbidden_origin" });
      if (signup && (await existingSignup(req, res, next))) return;
      const audience =
        !signup && req.body?.audience === "organisation"
          ? "organisation"
          : "investor";
      const invited =
        signup || audience === "organisation"
          ? await organisations?.preview(
              res.locals.accountTenant.slug,
              invitationCookie(req.headers.cookie),
            )
          : null;
      if (signup && req.body?.invitation === "1" && !invited)
        return accountPage(
          res,
          next,
          res.locals.accountTenant,
          { mode: "invitation", error: "invitation" },
          403,
        );
      const invitationSignup = signup && !!invited;
      const inviteFields = invited
        ? {
            invitedEmail: invited.email,
            invitedRole: invited.role,
            email: invited.email,
            name: invited.fullName ?? "",
          }
        : {};
      let registered = false;
      let signedCookie = "";
      try {
        if (signup && !invitationSignup && onboarding) {
          try {
            signupPhone(req.body?.phone);
          } catch {
            throw new DatabaseConflict("invalid_password");
          }
          if (req.body?.password !== req.body?.confirmPassword)
            throw new DatabaseConflict("invalid_password");
        }
        if (
          invited &&
          (typeof req.body?.email !== "string" ||
            req.body.email.trim().toLowerCase() !== invited.email)
        )
          throw new DatabaseConflict("invitation_unavailable");
        if (invitationSignup) {
          const current = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
          });
          if (current)
            return res.redirect(
              303,
              `/ra/${res.locals.accountTenant.slug}/invitation`,
            );
          await organisations!.register(
            res.locals.accountTenant.id,
            invitationCookie(req.headers.cookie),
            req.body?.name,
            req.body?.password,
            String(req.headers["x-auth-client-ip"]),
          );
          registered = true;
        }
        const response = await withAuthTenant(res.locals.accountTenant.id, () =>
          auth.handler(
            new Request(
              `${origin}/api/auth/${signup && !invitationSignup ? "sign-up" : "sign-in"}/email`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  origin,
                  "x-auth-client-ip": req.headers["x-auth-client-ip"] as string,
                },
                body: JSON.stringify({
                  email: invited?.email ?? req.body?.email,
                  password: req.body?.password,
                  ...(signup && !invitationSignup
                    ? {
                        name: req.body?.name,
                        ...(onboarding
                          ? { signupPhone: signupPhone(req.body?.phone) }
                          : {}),
                      }
                    : {}),
                  ...(emailEnabled
                    ? {
                        callbackURL: `${origin}/ra/${res.locals.accountTenant.slug}/${invited ? "invitation" : audience === "organisation" ? "login?audience=organisation" : "join"}`,
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
              audience,
              mode: "verify-email",
              notice: "sent",
              email: req.body?.email,
              ...inviteFields,
            });
          return accountPage(
            res,
            next,
            res.locals.accountTenant,
            {
              mode: registered ? "login" : mode,
              audience: invited ? "organisation" : audience,
              error: authFailure(response, res),
              email:
                typeof req.body?.email === "string"
                  ? req.body.email.slice(0, 254)
                  : "",
              name:
                typeof req.body?.name === "string"
                  ? req.body.name.slice(0, 160)
                  : "",
              ...inviteFields,
            },
            response.status,
          );
        }
        if (signup && emailEnabled && !invitationSignup)
          return accountPage(res, next, res.locals.accountTenant, {
            mode: "verify-email",
            notice: "sent",
            email:
              typeof req.body?.email === "string"
                ? req.body.email.slice(0, 254)
                : "",
          });
        signedCookie = responseCookie(response);
        const identity = await auth.api.getSession({
          headers: new Headers({ cookie: signedCookie }),
        });
        if (!identity) throw new DatabaseConflict("unauthorized");
        if (invited && identity.user.email.toLowerCase() !== invited.email)
          throw new DatabaseConflict("invitation_unavailable");
        const workspace = await store.find(
          identity.user.id,
          res.locals.accountTenant.slug,
        );
        if (invited && workspace) {
          const conflict = invitationRoleConflict(
            workspace.membership.role,
            invited.role,
          );
          if (conflict) throw new DatabaseConflict(conflict);
        }
        if (invited && !registered)
          await organisations!.accept(
            identity.session.token,
            res.locals.accountTenant.id,
            invitationCookie(req.headers.cookie),
          );
        const destination = invited
          ? "workspace"
          : workspaceDestination(
              audience,
              workspace?.membership.role ?? null,
              emailEnabled,
            );
        if (!destination) {
          await auth.handler(
            new Request(`${origin}/api/auth/sign-out`, {
              method: "POST",
              headers: { origin, cookie: signedCookie },
            }),
          );
          signedCookie = "";
          return accountPage(
            res,
            next,
            res.locals.accountTenant,
            {
              mode: "login",
              audience,
              email: identity.user.email,
              error:
                workspace?.membership.role === "subscriber"
                  ? "subscriber_only"
                  : workspace
                    ? "staff_only"
                    : "access",
            },
            403,
          );
        }
        res.setHeader("Set-Cookie", response.headers.getSetCookie());
        if (invited)
          clearInvitationCookie(res, res.locals.accountTenant.slug, origin);
        return res.redirect(
          303,
          `/ra/${res.locals.accountTenant.slug}/${destination}`,
        );
      } catch (error) {
        if (!(error instanceof DatabaseConflict)) throw error;
        if (signedCookie)
          await auth.handler(
            new Request(`${origin}/api/auth/sign-out`, {
              method: "POST",
              headers: { origin, cookie: signedCookie },
            }),
          );
        if (error.code === "throttled") res.setHeader("Retry-After", "60");
        return accountPage(
          res,
          next,
          res.locals.accountTenant,
          {
            mode:
              registered || error.code === "account_exists" ? "login" : mode,
            audience: invited ? "organisation" : audience,
            ...inviteFields,
            error:
              error.code === "throttled"
                ? "throttled"
                : error.code === "account_exists"
                  ? "account_exists"
                  : error.code === "invalid_password"
                    ? "credentials"
                    : error.code === "subscriber_conflict" ||
                        error.code === "staff_role_conflict" ||
                        error.code === "membership_revoked"
                      ? error.code
                      : "invitation",
          },
          error.code === "throttled" ? 429 : 403,
        );
      }
    });
  }
  mountAccountRecovery(router, {
    auth,
    origin,
    emailEnabled,
    page: accountPage,
    organisations,
  });
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
      slugSchema.safeParse(req.params.slug).success
        ? `/ra/${req.params.slug}/login`
        : "/#access",
    );
  });
  router.use(
    [
      "/workspaces",
      "/ra/:slug/account",
      "/ra/:slug/workspace",
      "/ra/:slug/join",
      "/api/workspaces",
      "/api/session",
    ],
    async (req, res, next) => {
      if (res.locals.accountPage) return next();
      const identity = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!identity) {
        if (!req.originalUrl.startsWith("/api/"))
          return res.redirect(
            303,
            res.locals.accountTenant?.slug || req.params.slug
              ? `/ra/${res.locals.accountTenant?.slug ?? req.params.slug}/login`
              : "/#access",
          );
        return res.status(401).json({ error: "unauthorized" });
      }
      res.locals.identity = identity;
      next();
    },
  );
  router.get("/ra/:slug/join", async (_req, res, next) => {
    const tenant: Tenant = res.locals.accountTenant;
    const existing = await store.find(res.locals.identity.user.id, tenant.slug);
    if (existing?.membership.role !== "subscriber" && existing)
      return accountPage(
        res,
        next,
        tenant,
        {
          mode: "login",
          audience: "organisation",
          email: res.locals.identity.user.email,
          error: "staff_only",
        },
        403,
      );
    if (existing) return res.redirect(303, `/ra/${tenant.slug}/account`);
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
      return res.redirect(303, `/ra/${res.locals.accountTenant.slug}/account`);
    } catch (error) {
      if (!(error instanceof DatabaseConflict)) throw error;
      return accountPage(
        res,
        next,
        res.locals.accountTenant,
        error.code === "staff_only"
          ? { mode: "login", audience: "organisation", error: "staff_only" }
          : { mode: "unavailable" },
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
  router.get(["/workspaces", "/api/workspaces"], async (req, res, next) => {
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
  router.get("/workspaces/:slug", (req, res) =>
    res.redirect(
      302,
      `/ra/${encodeURIComponent(req.params.slug as string)}/workspace`,
    ),
  );
  router.use(
    ["/ra/:slug/workspace", "/ra/:slug/account", "/api/workspaces/:slug"],
    async (req, res, next) => {
      if (res.locals.accountPage) return next();
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
      if (
        !req.originalUrl.startsWith("/api/") &&
        /^\/ra\/[^/]+\/workspace(?:\/|$)/.test(req.originalUrl.split("?")[0]) &&
        workspace.membership.role === "subscriber"
      )
        return accountPage(
          res,
          next,
          workspace.tenant,
          { mode: "login", audience: "investor", error: "subscriber_only" },
          403,
        );
      if (
        !req.originalUrl.startsWith("/api/") &&
        /^\/ra\/[^/]+\/account(?:\/|$)/.test(req.originalUrl.split("?")[0]) &&
        workspace.membership.role !== "subscriber"
      )
        return accountPage(
          res,
          next,
          workspace.tenant,
          { mode: "login", audience: "organisation", error: "staff_only" },
          403,
        );
      res.locals.workspace = workspace;
      monitorTenant(workspace.tenant.id);
      next();
    },
  );
  router.get(
    ["/ra/:slug/workspace", "/ra/:slug/account", "/api/workspaces/:slug"],
    (req, res, next) => {
      if (res.locals.accountPage) return next();
      const workspace: Workspace = res.locals.workspace;
      if (req.path.startsWith("/api/")) return res.json(projection(workspace));
      return accountPage(res, next, workspace.tenant, {
        mode: "workspace",
        area: req.path.endsWith("/account") ? "investor" : "organisation",
        profile: {
          name: res.locals.identity.user.name,
          email: res.locals.identity.user.email,
          emailVerified: !!res.locals.identity.user.emailVerified,
        },
        role: workspace.membership.role,
        capabilities: workspace.capabilities,
      });
    },
  );
  if (websiteOperations) mountWebsiteEditor(router, websiteOperations, origin);
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
    [
      "/workspaces",
      "/ra/:slug/account",
      "/ra/:slug/workspace",
      "/api/workspaces",
      "/api/session",
    ],
    (_req, res, next) =>
      res.locals.accountPage || res.locals.websitePreview
        ? next()
        : res.status(404).json({ error: "not_found" }),
  );
  return router;
}
