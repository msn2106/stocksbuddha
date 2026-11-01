import "@sentry/node/import";
import * as Sentry from "@sentry/node";

/** Remove bearer credentials from password-reset URL paths as well as query strings. */
export function redactAuthUrl(value: string) {
  return value
    .replace(/(\/api\/auth\/reset-password\/)[^/?#\s]+/g, "$1[Filtered]")
    .replace(/([?&](?:token|password)=)[^&#\s]*/gi, "$1[Filtered]");
}

/** Configure server monitoring only when a DSN exists, keeping request and identity data private. */
export function configureServerMonitoring(
  env: NodeJS.ProcessEnv,
  initialize = Sentry.init,
) {
  if (!env.SENTRY_DSN) return;
  initialize({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "development",
    release: env.SENTRY_RELEASE,
    tracesSampleRate: Number(
      env.SENTRY_TRACES_SAMPLE_RATE ??
        (env.NODE_ENV === "production" ? "0.1" : "1"),
    ),
    integrations: [Sentry.expressIntegration({ shouldHandleError: false })],
    /** Redact reset credentials from captured request and transaction URLs. */
    beforeSend(event) {
      if (event.request?.url)
        event.request.url = redactAuthUrl(event.request.url);
      if (event.transaction)
        event.transaction = redactAuthUrl(event.transaction);
      return event;
    },
    /** Redact reset credentials from span names and standard URL attributes. */
    beforeSendSpan(span) {
      span.name = redactAuthUrl(span.name);
      for (const key of ["url.full", "http.url", "url.path"])
        if (typeof span.attributes[key] === "string")
          span.attributes[key] = redactAuthUrl(span.attributes[key]);
      return span;
    },
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
    },
  });
}

// Preload this module before Express, Nest and database drivers are imported.
configureServerMonitoring(process.env);
