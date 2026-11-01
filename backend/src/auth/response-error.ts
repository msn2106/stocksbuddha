import type { Response } from "express";

/** Preserve authentication backoff across SSR forms without exposing provider errors. */
export function authFailure(response: globalThis.Response, res: Response) {
  if (response.status !== 429) return "credentials" as const;
  const delay = response.headers.get("retry-after");
  if (delay && /^\d+$/.test(delay)) res.setHeader("Retry-After", delay);
  return "throttled" as const;
}
