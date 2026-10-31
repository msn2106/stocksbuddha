import "@sentry/node/import";
import * as Sentry from "@sentry/node";

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
