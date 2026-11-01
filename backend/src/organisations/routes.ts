import express, { type Response, type NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { AccountView, Tenant } from "@ra/contracts";
import type { AuthRoutesDependencies } from "../auth/routes";
import type { AuthMailer } from "../auth/email";
import { authFailure } from "../auth/response-error";
import { withAuthTenant } from "../auth/tenant-context";
import { OrganisationService } from "./service";
import { DatabaseConflict } from "../database/operations";

type Page = (
  res: Response,
  next: NextFunction,
  tenant: Tenant | null,
  view: AccountView,
  status?: number,
) => void;
/** Read one tenant-scoped invitation credential without exposing it through hydration or logs. */
export function invitationCookie(cookies: string | undefined) {
  return (
    cookies
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("sb-org-invite="))
      ?.slice("sb-org-invite=".length) ?? ""
  );
}
/** Use only cookies issued by Better Auth to verify a newly created session. */
export function responseCookie(response: globalThis.Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
/** Define operator-only setup and invitation acceptance routes over the existing shared session adapter. */
export function createOrganisationRoutes({
  auth,
  store,
  service,
  mailer,
  origin,
  page,
}: {
  auth: AuthRoutesDependencies["auth"];
  store: AuthRoutesDependencies["store"];
  service: OrganisationService;
  mailer?: AuthMailer;
  origin: string;
  page: Page;
}) {
  const router = express.Router();
  router.get("/workspace/login", (_req, res, next) =>
    page(res, next, null, { mode: "login", audience: "platform" }),
  );
  router.post("/workspace/login", async (req, res, next) => {
    if (req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    const response = await withAuthTenant(null, () =>
      auth.handler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "x-auth-client-ip": String(req.headers["x-auth-client-ip"]),
          },
          body: JSON.stringify({
            email: req.body?.email,
            password: req.body?.password,
          }),
        }),
      ),
    );
    const cookie = responseCookie(response);
    const identity = response.ok
      ? await auth.api.getSession({ headers: new Headers({ cookie }) })
      : null;
    if (!identity || !(await service.isPlatformOwner(identity.session.token))) {
      if (identity)
        await auth.handler(
          new Request(`${origin}/api/auth/sign-out`, {
            method: "POST",
            headers: { origin, cookie },
          }),
        );
      return page(
        res,
        next,
        null,
        {
          mode: "login",
          audience: "platform",
          error: response.ok ? "access" : authFailure(response, res),
        },
        response.ok ? 403 : response.status,
      );
    }
    res.setHeader("Set-Cookie", response.headers.getSetCookie());
    return res.redirect(303, "/workspace");
  });
  router.use("/workspace", async (req, res, next) => {
    if (res.locals.accountPage) return next();
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity) return res.redirect(303, "/workspace/login");
    if (!(await service.isPlatformOwner(identity.session.token)))
      return res.status(403).json({ error: "platform_access_required" });
    res.locals.identity = identity;
    next();
  });
  router.get(
    ["/workspace", "/workspace/organisations"],
    async (req, res, next) => {
      const identity = res.locals.identity;
      return page(res, next, null, {
        mode: "workspace",
        area: "platform",
        role: "platform_owner",
        profile: {
          name: identity.user.name,
          email: identity.user.email,
          emailVerified: !!identity.user.emailVerified,
        },
        section: req.path === "/workspace" ? "overview" : "organisations",
        ...(req.path !== "/workspace"
          ? {
              organisations: (await service.list(identity.session.token)).map(
                (t) => ({
                  id: t.id,
                  slug: t.slug,
                  name: t.profile.name,
                  status: t.status,
                  administrators: t.administrators,
                }),
              ),
            }
          : {}),
        ...(req.query.sent ? { notice: "invited" as const } : {}),
      });
    },
  );
  /** Deliver the bearer link only to the intended recipient and retain safe delivery outcome for retry. */
  async function send(
    invitation: Awaited<ReturnType<OrganisationService["invite"]>>,
  ) {
    try {
      await mailer!({
        to: invitation.email,
        kind: "invite",
        url: `${origin}/ra/${invitation.tenant.slug}/invitation?token=${invitation.token}`,
      });
      await service.delivered(invitation.id, true);
    } catch (error) {
      await service.delivered(invitation.id, false);
      throw error;
    }
  }
  router.post(
    ["/workspace/organisations", "/workspace/invitations"],
    async (req, res, next) => {
      if (req.headers.origin !== origin)
        return res.status(403).json({ error: "forbidden_origin" });
      if (!mailer)
        return page(
          res,
          next,
          null,
          {
            mode: "workspace",
            area: "platform",
            section: "organisations",
            role: "platform_owner",
            profile: {
              name: res.locals.identity.user.name,
              email: res.locals.identity.user.email,
              emailVerified: !!res.locals.identity.user.emailVerified,
            },
            error: "service",
          },
          503,
        );
      try {
        let tenantId = req.body?.tenantId;
        if (req.path === "/workspace/organisations") {
          const record = await service.create(
            res.locals.identity.session.token,
            {
              slug: req.body?.slug,
              name: req.body?.name,
              legalName: req.body?.legalName,
              monogram: req.body?.monogram,
              registration: req.body?.registration,
            },
          );
          tenantId = record.id;
        }
        const invite = await service.invite(
          res.locals.identity.session.token,
          tenantId,
          req.body?.email ?? "",
          "owner",
        );
        await send(invite);
        return res.redirect(303, "/workspace/organisations?sent=1");
      } catch (error) {
        if (error instanceof DatabaseConflict || error instanceof Error)
          return page(
            res,
            next,
            null,
            {
              mode: "workspace",
              area: "platform",
              section: "organisations",
              role: "platform_owner",
              profile: {
                name: res.locals.identity.user.name,
                email: res.locals.identity.user.email,
                emailVerified: !!res.locals.identity.user.emailVerified,
              },
              error: "invitation",
              organisations: (
                await service.list(res.locals.identity.session.token)
              ).map((record) => ({
                id: record.id,
                slug: record.slug,
                name: record.profile.name,
                status: record.status,
                administrators: record.administrators,
              })),
            },
            400,
          );
        throw error;
      }
    },
  );
  router.get("/ra/:slug/invitation", async (req, res, next) => {
    const credential =
      typeof req.query.token === "string"
        ? req.query.token
        : invitationCookie(req.headers.cookie);
    const invite = await service.preview(req.params.slug as string, credential);
    if (!invite)
      return page(
        res,
        next,
        null,
        { mode: "invitation", error: "invitation" },
        404,
      );
    if (req.query.token) {
      res.cookie("sb-org-invite", credential, {
        httpOnly: true,
        secure: origin.startsWith("https://"),
        sameSite: "lax",
        path: `/ra/${invite.tenant.slug}`,
        maxAge: 3600000,
      });
      return res.redirect(303, `/ra/${invite.tenant.slug}/invitation`);
    }
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    return page(res, next, invite.tenant, {
      mode: "invitation",
      invitedEmail: invite.email,
      invitedRole: invite.role,
      signedIn: !!identity,
    });
  });
  router.post("/ra/:slug/invitation", async (req, res, next) => {
    if (req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    const credential = invitationCookie(req.headers.cookie),
      invite = await service.preview(req.params.slug as string, credential);
    if (!invite)
      return page(
        res,
        next,
        null,
        { mode: "invitation", error: "invitation" },
        404,
      );
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity)
      return res.redirect(
        303,
        `/ra/${invite.tenant.slug}/login?audience=organisation`,
      );
    try {
      await service.accept(
        identity.session.token,
        invite.tenant.id,
        credential,
      );
      res.clearCookie("sb-org-invite", {
        httpOnly: true,
        secure: origin.startsWith("https://"),
        sameSite: "lax",
        path: `/ra/${invite.tenant.slug}`,
      });
      return res.redirect(303, `/ra/${invite.tenant.slug}/workspace`);
    } catch (error) {
      if (error instanceof DatabaseConflict)
        return page(
          res,
          next,
          invite.tenant,
          { mode: "invitation", error: "invitation", signedIn: true },
          403,
        );
      throw error;
    }
  });
  router.get("/ra/:slug/workspace/team", async (req, res, next) => {
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity)
      return res.redirect(
        303,
        `/ra/${encodeURIComponent(req.params.slug as string)}/login?audience=organisation`,
      );
    const workspace = await store.find(
      identity.user.id,
      req.params.slug as string,
    );
    if (!workspace?.capabilities.includes("staff:manage"))
      return res.status(403).json({ error: "forbidden" });
    return page(res, next, workspace.tenant, {
      mode: "workspace",
      area: "organisation",
      section: "team",
      role: workspace.membership.role,
      profile: {
        name: identity.user.name,
        email: identity.user.email,
        emailVerified: !!identity.user.emailVerified,
      },
      invitations: await service.invitations(
        identity.session.token,
        workspace.tenant.id,
      ),
      ...(req.query.sent ? { notice: "invited" as const } : {}),
    });
  });
  router.post("/ra/:slug/workspace/team", async (req, res, next) => {
    if (req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity)
      return res.redirect(
        303,
        `/ra/${encodeURIComponent(req.params.slug as string)}/login?audience=organisation`,
      );
    const workspace = await store.find(
      identity.user.id,
      req.params.slug as string,
    );
    if (!workspace?.capabilities.includes("staff:manage"))
      return res.status(403).json({ error: "forbidden" });
    if (!mailer)
      return page(
        res,
        next,
        workspace.tenant,
        {
          mode: "workspace",
          area: "organisation",
          section: "team",
          role: workspace.membership.role,
          profile: {
            name: identity.user.name,
            email: identity.user.email,
            emailVerified: !!identity.user.emailVerified,
          },
          error: "service",
        },
        503,
      );
    try {
      await send(
        await service.invite(
          identity.session.token,
          workspace.tenant.id,
          req.body?.email ?? "",
          req.body?.role ?? "",
        ),
      );
      return res.redirect(
        303,
        `/ra/${workspace.tenant.slug}/workspace/team?sent=1`,
      );
    } catch (error) {
      if (error instanceof Error)
        return page(
          res,
          next,
          workspace.tenant,
          {
            mode: "workspace",
            area: "organisation",
            section: "team",
            role: workspace.membership.role,
            profile: {
              name: identity.user.name,
              email: identity.user.email,
              emailVerified: !!identity.user.emailVerified,
            },
            error: "invitation",
          },
          error instanceof DatabaseConflict ? 403 : 502,
        );
      throw error;
    }
  });
  router.use("/workspace", (_req, res, next) =>
    res.locals.accountPage
      ? next()
      : res.status(404).json({ error: "not_found" }),
  );
  return router;
}
