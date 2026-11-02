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
/** Remove only this tenant's onboarding credential while preserving the shared login cookie. */
export function clearInvitationCookie(
  res: Response,
  slug: string,
  origin: string,
) {
  res.clearCookie("sb-org-invite", {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: `/ra/${slug}`,
  });
}
/** Expose role-conflict details only on already-authorized administration or authenticated recipient pages. */
function invitationError(error: unknown): AccountView["error"] {
  return error instanceof DatabaseConflict &&
    [
      "subscriber_conflict",
      "staff_role_conflict",
      "membership_revoked",
    ].includes(error.code)
    ? (error.code as AccountView["error"])
    : "invitation";
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
        fullName: invitation.fullName,
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
          req.body?.fullName ?? "",
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
              error: invitationError(error),
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
  /** Explain account prerequisites without consuming a grant or granting access to another identity. */
  function invitationAccount(
    invitedEmail: string,
    identity: { user: { email: string; emailVerified?: boolean } } | null,
  ): Pick<AccountView, "signedIn" | "invitationIdentity"> {
    return {
      signedIn: !!identity,
      ...(identity &&
      identity.user.email.toLowerCase() !== invitedEmail.toLowerCase()
        ? { invitationIdentity: "different" as const }
        : identity && !identity.user.emailVerified
          ? { invitationIdentity: "unverified" as const }
          : {}),
    };
  }
  router.post("/ra/:slug/invitation/switch-account", async (req, res) => {
    if (req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    const invite = await service.preview(
      req.params.slug as string,
      invitationCookie(req.headers.cookie),
    );
    if (!invite)
      return res.status(404).json({ error: "invitation_unavailable" });
    const response = await auth.handler(
      new Request(`${origin}/api/auth/sign-out`, {
        method: "POST",
        headers: fromNodeHeaders(req.headers),
      }),
    );
    if (!response.ok)
      return res.status(response.status).json({ error: "sign_out_failed" });
    res.setHeader("Set-Cookie", response.headers.getSetCookie());
    return res.redirect(303, `/ra/${invite.tenant.slug}/invitation`);
  });
  router.get("/ra/:slug/invitation", async (req, res, next) => {
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
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
        { mode: "invitation", error: "invitation", signedIn: !!identity },
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
    const account = invitationAccount(invite.email, identity);
    return page(res, next, invite.tenant, {
      mode: identity ? "invitation" : invite.accountExists ? "login" : "signup",
      audience: "organisation",
      email: invite.email,
      name: invite.fullName ?? "",
      invitedEmail: invite.email,
      invitedRole: invite.role,
      ...account,
      ...(!account.invitationIdentity && identity
        ? { autoAcceptInvitation: true }
        : {}),
    });
  });
  router.post("/ra/:slug/invitation", async (req, res, next) => {
    if (req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    const identity = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const credential = invitationCookie(req.headers.cookie),
      invite = await service.preview(req.params.slug as string, credential);
    if (!invite)
      return page(
        res,
        next,
        null,
        { mode: "invitation", error: "invitation", signedIn: !!identity },
        404,
      );
    if (!identity)
      return res.redirect(
        303,
        `/ra/${invite.tenant.slug}/login?audience=organisation`,
      );
    const account = invitationAccount(invite.email, identity);
    if (account.invitationIdentity)
      return page(
        res,
        next,
        invite.tenant,
        {
          mode: "invitation",
          invitedEmail: invite.email,
          invitedRole: invite.role,
          ...account,
        },
        403,
      );
    try {
      await service.accept(
        identity.session.token,
        invite.tenant.id,
        credential,
      );
      clearInvitationCookie(res, invite.tenant.slug, origin);
      return res.redirect(303, `/ra/${invite.tenant.slug}/workspace`);
    } catch (error) {
      if (error instanceof DatabaseConflict)
        return page(
          res,
          next,
          invite.tenant,
          { mode: "invitation", error: invitationError(error), signedIn: true },
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
    if (
      workspace?.membership.role !== "owner" ||
      !workspace.capabilities.includes("staff:manage")
    )
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
      members: await service.members(
        identity.session.token,
        workspace.tenant.id,
      ),
      ...(req.query.sent
        ? { notice: "invited" as const }
        : req.query.revoked
          ? { notice: "revoked" as const }
          : {}),
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
    if (
      workspace?.membership.role !== "owner" ||
      !workspace.capabilities.includes("staff:manage")
    )
      return res.status(403).json({ error: "forbidden" });
    const action = req.body?.action ?? "invite";
    if (
      !["invite", "resend", "revokeInvitation", "revokeMember"].includes(action)
    )
      return res.status(400).json({ error: "invalid_action" });
    if (!mailer && ["invite", "resend"].includes(action))
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
      if (action === "revokeMember") {
        await service.revokeMember(
          identity.session.token,
          workspace.tenant.id,
          req.body?.id ?? "",
        );
      } else if (action === "revokeInvitation") {
        await service.revokeInvitation(
          identity.session.token,
          workspace.tenant.id,
          req.body?.id ?? "",
        );
      } else {
        await send(
          action === "resend"
            ? await service.resend(
                identity.session.token,
                workspace.tenant.id,
                req.body?.id ?? "",
                req.body?.fullName,
              )
            : await service.invite(
                identity.session.token,
                workspace.tenant.id,
                req.body?.email ?? "",
                req.body?.role ?? "",
                req.body?.fullName ?? "",
              ),
        );
      }
      return res.redirect(
        303,
        `/ra/${workspace.tenant.slug}/workspace/team?${action.startsWith("revoke") ? "revoked" : "sent"}=1`,
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
            error: invitationError(error),
            invitations: await service.invitations(
              identity.session.token,
              workspace.tenant.id,
            ),
            members: await service.members(
              identity.session.token,
              workspace.tenant.id,
            ),
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
