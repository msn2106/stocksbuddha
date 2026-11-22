import { OnboardingError } from "../onboarding/domain";

/** Expose only stable provider failures, never the token-bearing URL or response body. */
export class TelegramError extends OnboardingError {
  /** Preserve only the provider status and bounded retry delay for worker decisions. */
  constructor(
    readonly providerCode = 0,
    readonly retryAfter = 0,
  ) {
    super("telegram_provider_unavailable", 503);
  }
}
export type TelegramApi = (
  token: string,
  method: string,
  body?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** Keep Telegram credentials on the server and bound all provider calls. */
export const telegramApi: TelegramApi = async (token, method, body = {}) => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      },
    );
    const result = (await response.json()) as {
      ok?: boolean;
      error_code?: number;
      parameters?: { retry_after?: number };
      result: Record<string, unknown>;
    };
    if (!response.ok || result.ok !== true)
      throw new TelegramError(
        Number(result.error_code) || response.status,
        Math.min(
          86400,
          Math.max(1, Number(result.parameters?.retry_after) || 60),
        ),
      );
    return result.result;
  } catch (error) {
    if (error instanceof TelegramError) throw error;
    throw new TelegramError();
  }
};
