import express, { type Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { AuthRoutesDependencies } from "../auth/routes";
import { OnboardingError } from "../onboarding/domain";
import type { TelegramService } from "./service";

/** Mount secret-authenticated Telegram callbacks separately from same-origin authenticated account actions. */
export function mountTelegram(
  router: Router,
  d: Pick<AuthRoutesDependencies, "auth" | "store"> & {
    service: TelegramService;
    origin: string;
  },
) {
  const webhook = express.Router({ mergeParams: true });
  webhook.use(express.json({ limit: "32kb" }));
  webhook.post("/", async (req: express.Request, res) =>
    res.json(
      await d.service.webhook(
        String(req.params.tenantId),
        req.get("X-Telegram-Bot-Api-Secret-Token") ?? "",
        req.body,
      ),
    ),
  );
  const api = express.Router({ mergeParams: true });
  api.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const identity = await d.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!identity?.user.emailVerified)
      return res.status(401).json({ error: "unauthorized" });
    const workspace = await d.store.find(
      identity.user.id,
      String(req.params.slug),
    );
    if (
      !workspace ||
      !["owner", "subscriber"].includes(workspace.membership.role)
    )
      return res.status(403).json({ error: "forbidden" });
    if (req.method !== "GET" && req.headers.origin !== d.origin)
      return res.status(403).json({ error: "forbidden_origin" });
    res.locals.telegramContext = {
      token: identity.session.token,
      tenantId: workspace.tenant.id,
    };
    res.locals.telegramOwner = workspace.membership.role === "owner";
    next();
  });
  api.get("/", async (_req, res) =>
    res.json(
      await d.service.status(
        res.locals.telegramContext,
        res.locals.telegramOwner,
      ),
    ),
  );
  api.post("/connect", async (_req, res) =>
    res.json(await d.service.connect(res.locals.telegramContext)),
  );
  api.post("/invite", async (_req, res) =>
    res.json(await d.service.invite(res.locals.telegramContext)),
  );
  api.post("/unlink", async (_req, res) =>
    res.json(await d.service.unlink(res.locals.telegramContext)),
  );
  /** Convert request failures into bounded Telegram errors without leaking provider details. */
  const errors: express.ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    res
      .status(
        error instanceof OnboardingError
          ? error.status
          : error?.type === "entity.too.large"
            ? 413
            : 503,
      )
      .json({
        error:
          error instanceof OnboardingError
            ? error.code
            : "telegram_unavailable",
      });
  };
  webhook.use(errors);
  api.use(errors);
  router.use("/api/telegram/:tenantId/webhook", webhook);
  router.use("/api/workspaces/:slug/telegram", api);
}
