import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import * as Sentry from "@sentry/node";

const requests = new AsyncLocalStorage<{
  requestId: string;
  tenantId: string;
}>();

/** Keep correlation independent of framework-created Sentry scopes between middleware boundaries. */
export function requestMetadata() {
  return requests.getStore();
}

/** Give every HTTP request its own Sentry isolation scope and server-generated correlation ID. */
export const requestMonitoring: RequestHandler = (_req, res, next) => {
  const requestId = randomUUID();
  requests.run({ requestId, tenantId: "unresolved" }, () =>
    Sentry.withIsolationScope((scope) => {
      scope.setTag("request_id", requestId);
      scope.setTag("tenant_id", "unresolved");
      scope.setAttributes({
        "request.id": requestId,
        "tenant.id": "unresolved",
      });
      const span = Sentry.getActiveSpan();
      if (span) Sentry.getRootSpan(span).setAttribute("request.id", requestId);
      res.setHeader("X-Request-ID", requestId);
      next();
    }),
  );
};

/** Attach only server-resolved tenant ownership to the current request, never to a global scope. */
export function monitorTenant(tenantId: string) {
  const metadata = requestMetadata();
  if (metadata) metadata.tenantId = tenantId;
  Sentry.getIsolationScope().setTag("tenant_id", tenantId);
  Sentry.getIsolationScope().setAttribute("tenant.id", tenantId);
  const span = Sentry.getActiveSpan();
  if (span) Sentry.getRootSpan(span).setAttribute("tenant.id", tenantId);
}
