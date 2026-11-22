import { useEffect, useState } from "react";
import { privateRequest } from "../websites/settings-ui";

export const telegramErrors: Record<string, string> = {
  telegram_https_required:
    "The site needs a public HTTPS address before Telegram can connect.",
  telegram_bot_in_use:
    "This bot is already connected to another RA. Create a separate bot for this RA.",
  invalid_bot_token:
    "Check the token supplied by BotFather, save it and reconnect.",
  telegram_not_connected:
    "Connect the RA bot in Website configuration > Telegram Settings first.",
  mobile_verification_required:
    "Verify your mobile number in your account before connecting Telegram.",
  integration_credentials_required:
    "Save your BotFather token first, then connect the bot.",
};
type Status = {
  connected: boolean;
  username?: string;
  linked?: boolean;
  mobileVerified?: boolean;
};

/** Offer explicit bot activation or a private investor invite using existing workspace controls. */
export function TelegramConnection({
  slug,
  owner = false,
}: {
  slug: string;
  owner?: boolean;
}) {
  const api = `/api/workspaces/${slug}/telegram`;
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    privateRequest(api)
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active)
          setError("Telegram status could not be loaded. Refresh to retry.");
      });
    return () => {
      active = false;
    };
  }, [api]);
  /** Refresh authoritative connection state after an explicit user action. */
  async function act(action: "connect" | "invite" | "unlink" | "refresh") {
    setBusy(true);
    setError("");
    try {
      if (action !== "refresh") {
        const value = await privateRequest(`${api}/${action}`, {});
        setUrl(action === "invite" ? value.url : "");
      }
      const next = await privateRequest(api);
      setStatus(next);
      if (next.linked && action !== "invite") setUrl("");
    } catch (failure) {
      setError(
        telegramErrors[(failure as Error).message] ??
          "Telegram could not complete this request. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="workspace-notice telegram-connection"
      aria-label="Telegram connection"
      aria-busy={busy}
    >
      {owner ? (
        <h3>Telegram recommendations</h3>
      ) : (
        <h2>Telegram recommendations</h2>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {!status && !error && <p role="status">Loading Telegram connection...</p>}
      {status && (
        <>
          <p role="status">
            {owner
              ? status.connected
                ? `Bot @${status.username} is connected.`
                : "Save your token, then connect your bot to the site."
              : status.linked
                ? `Connected to @${status.username}. Only your latest linked Telegram account receives messages.`
                : status.connected
                  ? "Connect your Telegram account to receive recommendations included in your plan or client group."
                  : "Your RA has not connected a Telegram bot yet."}
          </p>
          {!owner && status.connected && (
            <p>
              Use a personal invite and share your own phone number in Telegram.
              It must match your verified site mobile. Invites expire in 10
              minutes. Connecting a new account replaces the previous one.
            </p>
          )}
          <div className="research-toolbar">
            {owner ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("connect")}
              >
                {status.connected ? "Reconnect bot" : "Connect bot to site"}
              </button>
            ) : (
              status.connected && (
                <>
                  <button
                    type="button"
                    disabled={busy || !status.mobileVerified}
                    onClick={() => void act("invite")}
                  >
                    {status.linked
                      ? "Replace Telegram account"
                      : "Connect Telegram"}
                  </button>
                  {status.linked && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act("unlink")}
                    >
                      Disconnect Telegram
                    </button>
                  )}
                </>
              )
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("refresh")}
            >
              Refresh Telegram status
            </button>
          </div>
          {!owner && status.connected && !status.mobileVerified && (
            <p>Verify your mobile number in your account to enable linking.</p>
          )}
          {url && (
            <p>
              <a
                className="button primary"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                Open personal Telegram invite
              </a>{" "}
              After sharing your contact, refresh Telegram status here.
            </p>
          )}
        </>
      )}
      {!status && error && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("refresh")}
        >
          Refresh Telegram status
        </button>
      )}
    </section>
  );
}
