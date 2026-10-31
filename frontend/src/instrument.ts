import * as Sentry from "@sentry/react";

/** Configure browser monitoring with tracing limited to same-origin request targets. */
export function configureBrowserMonitoring(
  env: Partial<ImportMetaEnv>,
  initialize = Sentry.init,
) {
  if (!env.VITE_SENTRY_DSN) return;
  initialize({
    dsn: env.VITE_SENTRY_DSN,
    environment: env.VITE_SENTRY_ENVIRONMENT ?? env.MODE,
    release: env.VITE_SENTRY_RELEASE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: Number(
      env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? (env.PROD ? "0.1" : "1"),
    ),
    tracePropagationTargets: [/^\//],
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}

// Node hydration tests import this entry without Vite's environment replacement.
configureBrowserMonitoring(import.meta.env ?? {});
