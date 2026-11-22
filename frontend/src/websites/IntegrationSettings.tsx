import { useEffect, useState } from "react";
import { TelegramConnection } from "../account/TelegramConnection";
import { LockKeyhole, ExternalLink } from "lucide-react";
import {
  privateRequest,
  settingsError,
  SettingsField,
  SettingsHeader,
} from "./settings-ui";
type Kind = "telegram" | "payment";
type Settings = {
  version: number;
  configured: boolean;
  locked?: boolean;
  source?: string;
  chatId?: string;
  inviteLink?: string;
  provider?: string;
  enabled?: boolean;
  mode?: string;
  clientId?: string;
};
/** Give Telegram and payment configuration their own private forms and truthful activation states. */
export function IntegrationSettings({
  slug,
  kind,
  onDirtyChange,
  onBusyChange,
}: {
  slug: string;
  kind: Kind;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const api = `/api/workspaces/${slug}/website/integrations/${kind}`;
  const [settings, setSettings] = useState<Settings | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const telegram = kind === "telegram";
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  /** Recover a failed load or refresh the saved provider version without exposing credentials. */
  async function load() {
    setBusy(true);
    setError("");
    try {
      setSettings(await privateRequest(api));
      onDirtyChange?.(false);
    } catch {
      setError("integration_unavailable");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    setSettings(null);
    setMessage("");
    setError("");
    privateRequest(api)
      .then((next) => {
        if (live) setSettings(next);
      })
      .catch(() => {
        if (live) setError("integration_unavailable");
      });
    return () => {
      live = false;
    };
  }, [api]);
  /** Save encrypted provider data independently of website publication, retaining an omitted saved secret. */
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = telegram
        ? {
            version: settings!.version,
            ...(form.get("botToken") ? { botToken: form.get("botToken") } : {}),
          }
        : {
            version: settings!.version,
            provider: "cashfree",
            enabled: form.get("enabled") === "on",
            mode: form.get("mode"),
            clientId: form.get("clientId"),
            ...(form.get("clientSecret")
              ? { clientSecret: form.get("clientSecret") }
              : {}),
          };
      await privateRequest(api, body);
      setSettings(await privateRequest(api));
      onDirtyChange?.(false);
      setMessage(
        telegram
          ? "Telegram token saved. Connect the bot to the site below to enable delivery."
          : "Payment gateway settings saved.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "integration_unavailable",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="service-settings" aria-busy={busy}>
      <SettingsHeader
        title={telegram ? "Telegram settings" : "Payment gateway settings"}
        description={
          telegram
            ? "Connect your own bot for private recommendations to verified investors."
            : "Connect the Cashfree merchant account that collects fees for your RA."
        }
        configured={!!settings?.configured}
      />
      {error && (
        <div className="settings-feedback is-error" role="alert">
          {settingsError(error)}{" "}
          <button type="button" onClick={() => void load()}>
            Reload settings
          </button>
        </div>
      )}
      {message && (
        <p className="settings-feedback is-success" role="status">
          {message}
        </p>
      )}
      {!settings ? (
        <p role="status">
          {error
            ? "Reload settings to continue."
            : "Loading integration settings…"}
        </p>
      ) : (
        <>
          {telegram && (
            <p className="settings-explanation">
              Save the token from BotFather, then connect the bot below.
              Investors receive personal invite links in their account. No
              channel ID is needed.
            </p>
          )}
          {!telegram && settings.locked && (
            <p className="settings-feedback" role="status">
              A Cashfree checkout has already started for this RA. Contact
              platform support to rotate credentials safely.
            </p>
          )}
          <form
            method="post"
            key={`${kind}-${settings.version}`}
            onSubmit={save}
            onChange={() => {
              onDirtyChange?.(true);
              setMessage("");
            }}
          >
            <fieldset
              className="settings-form-body"
              disabled={busy || !!settings.locked}
            >
              <div className="settings-section">
                <div className="settings-section-copy">
                  <h3>{telegram ? "Bot connection" : "Merchant connection"}</h3>
                  <p>
                    {telegram
                      ? "Create a dedicated bot with BotFather for this RA. Recommendations are sent privately to each linked investor."
                      : "Use your own merchant credentials so research fees reach the correct account."}
                  </p>
                  <a
                    href={
                      telegram
                        ? "https://core.telegram.org/bots#how-do-i-create-a-bot"
                        : "https://www.cashfree.com/docs/payments/online/quickstart"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {telegram ? "Telegram setup guide" : "Cashfree setup guide"}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
                <div className="settings-fields">
                  {telegram ? (
                    <>
                      <SettingsField
                        label="Bot token"
                        name="botToken"
                        placeholder="e.g. 123456789:AA…token from BotFather"
                        secret
                        required={!settings.configured}
                        help={
                          settings.configured
                            ? "A token is saved. Leave blank to keep it."
                            : "Copy the token from BotFather. It is never shown again after saving."
                        }
                      />
                    </>
                  ) : (
                    <>
                      <div className="settings-field">
                        <label htmlFor="payment-provider">
                          Payment provider
                        </label>
                        <select
                          id="payment-provider"
                          name="provider"
                          defaultValue="cashfree"
                        >
                          <option value="cashfree">Cashfree Payments</option>
                        </select>
                        <small>
                          Cashfree is the payment integration currently
                          supported.
                        </small>
                      </div>
                      <div className="settings-field">
                        <label htmlFor="payment-mode">Environment</label>
                        <select
                          id="payment-mode"
                          name="mode"
                          defaultValue={settings.mode ?? "sandbox"}
                        >
                          <option value="sandbox">
                            Sandbox — test payments
                          </option>
                          <option value="production">
                            Production — live payments
                          </option>
                        </select>
                        <small>
                          Live payments remain subject to platform compliance
                          approval.
                        </small>
                      </div>
                      <SettingsField
                        label="Client ID"
                        name="clientId"
                        placeholder="e.g. TEST_your_cashfree_client_id"
                        defaultValue={settings.clientId}
                        required
                        help="Find this under Payment Gateway → Developers → API keys in Cashfree."
                      />
                      <SettingsField
                        label="Client secret"
                        name="clientSecret"
                        placeholder="e.g. your Cashfree secret key"
                        secret
                        required={!settings.configured}
                        help={
                          settings.configured
                            ? "A secret is saved. Leave blank to keep it."
                            : "Store this privately. It is used only by the backend."
                        }
                      />
                      <label className="settings-checkbox settings-field-wide">
                        <input
                          name="enabled"
                          aria-label="Enable this payment connection"
                          type="checkbox"
                          defaultChecked={settings.enabled}
                        />
                        <span>
                          Enable this payment connection
                          <small>
                            Saving credentials does not lift the production
                            payment approval gate.
                          </small>
                        </span>
                      </label>
                    </>
                  )}
                </div>
              </div>
              <div className="settings-save-bar">
                <p>
                  <LockKeyhole size={16} aria-hidden="true" />
                  Private settings. Saving does not publish your website.
                </p>
                <button className="button primary">
                  {busy
                    ? "Saving…"
                    : telegram
                      ? "Save Telegram settings"
                      : "Save payment settings"}
                </button>
              </div>
            </fieldset>
          </form>
          {telegram && (
            <TelegramConnection key={settings.version} slug={slug} owner />
          )}
        </>
      )}
    </section>
  );
}
