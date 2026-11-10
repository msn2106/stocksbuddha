import type { IntegrationSettingsService } from "../integrations/service";
import { OnboardingError } from "../onboarding/domain";
import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  websiteRevisionSchema,
  publicProfileSchema,
  type PageData,
} from "@ra/contracts";
import type { TenantOperations } from "../database/operations";
import { DatabaseConflict } from "../database/operations";
import type { Workspace } from "../auth/workspaces";
import { validateSnapshot } from "../../../database/snapshots";

export type WebsiteOperations = Pick<
  TenantOperations,
  "readWebsite" | "createDraft" | "saveDraft" | "publish"
>;

/** Mount tenant-owner editor endpoints after fresh session and workspace resolution. */
export function mountWebsiteEditor(
  router: Router,
  operations: WebsiteOperations,
  origin: string,
  integrations?: IntegrationSettingsService,
) {
  const page = "/ra/:slug/workspace/website";
  const api = "/api/workspaces/:slug/website";
  router.use([page, api], (req, res, next) => {
    const workspace: Workspace | undefined = res.locals.workspace;
    if (
      !workspace ||
      workspace.membership.role !== "owner" ||
      !workspace.capabilities.includes("website:edit")
    )
      return res.status(403).json({ error: "forbidden" });
    if (req.method !== "GET" && req.headers.origin !== origin)
      return res.status(403).json({ error: "forbidden_origin" });
    next();
  });
  router.all(`${api}/integrations/:kind`, async (req, res) => {
    if (!integrations)
      return res.status(503).json({ error: "integration_unavailable" });
    if (!["GET", "POST"].includes(req.method))
      return res.status(405).json({ error: "method_not_allowed" });
    const context = {
      token: res.locals.identity.session.token,
      tenantId: res.locals.workspace.tenant.id,
    };
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(
        req.method === "GET"
          ? await integrations.read(context, req.params.kind)
          : await integrations.save(context, req.params.kind, req.body),
      );
    } catch (error) {
      res.status(error instanceof OnboardingError ? error.status : 503).json({
        error:
          error instanceof OnboardingError
            ? error.code
            : "integration_unavailable",
      });
    }
  });
  router.get(page, (_req, res, next) => {
    const workspace: Workspace = res.locals.workspace;
    res.locals.accountPage = {
      tenant: workspace.tenant,
      website: null,
      page: "account",
      locale: "en",
      account: {
        mode: "workspace",
        area: "organisation",
        section: "website",
        role: workspace.membership.role,
        capabilities: workspace.capabilities,
        profile: {
          name: res.locals.identity.user.name,
          email: res.locals.identity.user.email,
          emailVerified: !!res.locals.identity.user.emailVerified,
        },
      },
    } satisfies PageData;
    next();
  });
  router.get(api, async (_req, res) => {
    const result = await operations.readWebsite({
      token: res.locals.identity.session.token,
      tenantId: res.locals.workspace.tenant.id,
      key: randomUUID(),
    });
    res.json(result);
  });
  router.post(api, async (req, res) => {
    const { action, id, version, snapshot } = req.body ?? {};
    const key = req.get("Idempotency-Key") ?? "";
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (
      !uuid.test(key) ||
      !["save", "publish", "rebase"].includes(action) ||
      (id !== null && (typeof id !== "string" || !uuid.test(id))) ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      (id && version < 1) ||
      (!id && action !== "save")
    )
      return res.status(400).json({ error: "invalid_editor_request" });
    const context = {
      token: res.locals.identity.session.token,
      tenantId: res.locals.workspace.tenant.id,
      key,
    };
    try {
      const result =
        action === "publish"
          ? await operations.publish(context, id, version)
          : id
            ? await operations.saveDraft(
                context,
                id,
                version,
                snapshot,
                action === "rebase",
              )
            : await operations.createDraft(context, snapshot);
      res.json(result);
    } catch (error) {
      if (error instanceof DatabaseConflict)
        return res
          .status(
            ["unauthorized", "forbidden", "tenant_unavailable"].includes(
              error.code,
            )
              ? 403
              : 409,
          )
          .json({ error: error.code });
      if (error instanceof ZodError)
        return res.status(422).json({
          error: "invalid_content",
          issues: error.issues.map(
            (issue) => `${issue.path.join(".")}: ${issue.message}`,
          ),
        });
      if (
        error instanceof Error &&
        [
          "Default language must be enabled",
          "HTML is not supported in website snapshots",
          "Snapshot exceeds 512 KiB",
          "Invalid logo image",
        ].includes(error.message)
      )
        return res
          .status(422)
          .json({ error: "invalid_content", issues: [error.message] });
      throw error;
    }
  });
  router.get(`${page}/preview`, async (req, res, next) => {
    const tenant = res.locals.workspace.tenant;
    const state = await operations.readWebsite({
      token: res.locals.identity.session.token,
      tenantId: tenant.id,
      key: randomUUID(),
    });
    try {
      const snapshot = validateSnapshot(state.snapshot, true);
      const revision = websiteRevisionSchema.parse({
        tenantId: tenant.id,
        revision: Math.max(1, state.revision),
        status: "published",
        publishedAt: new Date().toISOString(),
        branding: snapshot.branding,
        layout: snapshot.layout,
        languages: snapshot.languages,
        content: snapshot.content,
      });
      const locale = revision.languages.enabled.includes(
        req.query.lang as "en" | "hi",
      )
        ? (req.query.lang as "en" | "hi")
        : revision.languages.default;
      res.setHeader(
        "Content-Security-Policy",
        "form-action 'self'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'",
      );
      res.locals.websitePreview = {
        tenant: {
          ...tenant,
          profile: publicProfileSchema.parse(snapshot.publicProfile),
        },
        website: {
          ...revision,
          publishedAt: revision.publishedAt!,
          content: revision.content[locale]!,
          contact: {
            email: snapshot.publicProfile.contactEmail,
            phone: snapshot.publicProfile.contactPhone,
          },
        },
        page: "landing",
        locale,
        preview: true,
      } satisfies PageData;
      next();
    } catch {
      res
        .status(422)
        .type("text")
        .send(
          "Complete all enabled language fields and branding before previewing. Return to the editor to review the draft.",
        );
    }
  });
}
