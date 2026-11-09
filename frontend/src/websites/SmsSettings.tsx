import { useEffect, useState } from "react";
import {
  MessageSquare,
  Plus,
  Trash2,
  RefreshCw,
  LockKeyhole,
} from "lucide-react";
import {
  privateRequest,
  settingsError,
  SettingsHeader,
  SettingsField,
} from "./settings-ui";
type Entry = { key: string; name: string; id: string; text: string };
type Settings = {
  version: number;
  configured: boolean;
  trial: boolean;
  enabled?: boolean;
  username?: string;
  senderId?: string;
  entityId?: string;
  encoding?: string;
  verification?: { id: string; text: string };
  templates?: Entry[];
  events: {
    id: string;
    status: string;
    message_id: string | null;
    balance: string | null;
    created_at: string;
  }[];
};
/** Seed the two known workflows while preserving existing single-template RA configurations. */
function initialTemplates(settings: Settings): Entry[] {
  return (
    settings.templates ?? [
      {
        key: "login",
        name: "Login",
        id: settings.verification?.id ?? "",
        text: settings.verification?.text ?? "",
      },
      {
        key: "password-reset",
        name: "Reset/Forgot Password",
        id: "",
        text: "",
      },
    ]
  );
}
/** Manage an extensible private SMS template library and the RA's approved verification sender. */
export function SmsSettings({
  slug,
  onDirtyChange,
  onBusyChange,
}: {
  slug: string;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [templates, setTemplates] = useState<Entry[]>([]),
    [selected, setSelected] = useState("login");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const api = `/api/sms/${slug}/settings`;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  /** Refresh settings without ever requesting stored API secrets. */
  async function load() {
    setBusy(true);
    setError("");
    try {
      const next = await privateRequest(api);
      setSettings(next);
      const entries = initialTemplates(next);
      setTemplates(entries);
      onDirtyChange?.(false);
      setSelected((previous) =>
        entries.some((entry) => entry.key === previous) ? previous : "login",
      );
    } catch {
      setError("sms_unavailable");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    privateRequest(api)
      .then((next) => {
        if (live) {
          setSettings(next);
          setTemplates(initialTemplates(next));
        }
      })
      .catch(() => {
        if (live) setError("sms_unavailable");
      });
    return () => {
      live = false;
    };
  }, [api]);
  /** Update one stable template entry without changing its workflow assignment. */
  function edit(field: "name" | "id" | "text", value: string) {
    setTemplates((previous) =>
      previous.map((entry) =>
        entry.key === selected ? { ...entry, [field]: value } : entry,
      ),
    );
    setMessage("");
    onDirtyChange?.(true);
  }
  /** Save the complete template array, keeping the Login mapping compatible with existing verification. */
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      login = templates.find((entry) => entry.key === "login")!;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await privateRequest(api, {
        version: settings!.version,
        enabled: form.get("enabled") === "on",
        username: form.get("username"),
        ...(form.get("apiKey") ? { apiKey: form.get("apiKey") } : {}),
        senderId: form.get("senderId"),
        entityId: form.get("entityId"),
        encoding: form.get("encoding"),
        verification: { id: login.id, text: login.text },
        templates,
      });
      await load();
      setMessage("SMS settings saved.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "sms_unavailable");
    } finally {
      setBusy(false);
    }
  }
  const entry = templates.find((item) => item.key === selected) ?? templates[0];
  return (
    <section className="service-settings" aria-busy={busy}>
      <SettingsHeader
        title="SMS settings"
        description="Connect your SMS Horizon account and keep your approved DLT messages in one place."
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
          {error ? "Reload settings to continue." : "Loading SMS settings…"}
        </p>
      ) : (
        <form
          method="post"
          key={settings.version}
          onSubmit={save}
          onChange={() => {
            onDirtyChange?.(true);
            setMessage("");
          }}
        >
          <fieldset disabled={busy} className="settings-form-body">
            <div className="settings-section">
              <div className="settings-section-copy">
                <h3>Sender connection</h3>
                <p>Use the account and sender registered for your RA.</p>
                <span className="settings-mode">
                  {settings.trial
                    ? "Trial mode · approved test number only"
                    : "Live mode"}
                </span>
              </div>
              <div className="settings-fields">
                <SettingsField
                  label="Vendor username"
                  name="username"
                  placeholder="e.g. stocksbuddha_ra"
                  defaultValue={settings.username}
                  required
                  maxLength={100}
                />
                <SettingsField
                  label="API key (leave blank to retain saved key)"
                  name="apiKey"
                  placeholder="e.g. your SMS Horizon API key"
                  secret
                  required={!settings.configured}
                  help={
                    settings.configured
                      ? "A key is saved. Leave this blank to keep it."
                      : "Find this in your SMS Horizon account. It is stored privately."
                  }
                />
                <SettingsField
                  label="Approved sender ID"
                  name="senderId"
                  placeholder="e.g. HORIZN"
                  defaultValue={settings.senderId}
                  required
                  maxLength={6}
                  pattern="[A-Za-z]{1,6}"
                />
                <SettingsField
                  label="DLT entity ID"
                  name="entityId"
                  placeholder="e.g. 110100000000001"
                  defaultValue={settings.entityId}
                  required
                  maxLength={25}
                  pattern="[0-9]{10,25}"
                />
                <div className="settings-field">
                  <label htmlFor="sms-encoding">Message encoding</label>
                  <select
                    id="sms-encoding"
                    name="encoding"
                    defaultValue={settings.encoding ?? "txt"}
                  >
                    <option value="txt">English / ASCII</option>
                    <option value="uni">Unicode / हिन्दी</option>
                  </select>
                  <small>
                    Choose Unicode for a registered Hindi or regional-language
                    message.
                  </small>
                </div>
                <label className="settings-checkbox">
                  <input
                    name="enabled"
                    aria-label="Enable SMS verification"
                    type="checkbox"
                    defaultChecked={settings.enabled}
                  />
                  <span>
                    Enable SMS verification
                    <small>
                      Only approved, completed templates can be used.
                    </small>
                  </span>
                </label>
              </div>
            </div>
            <div className="settings-section settings-templates-section">
              <div className="settings-section-copy">
                <h3>Message templates</h3>
                <p>
                  Start with Login and Reset/Forgot Password. Add templates as
                  your communication needs grow.
                </p>
                <small>
                  Replace the DLT OTP variable with {"{{otp}}"}. Keep approved
                  static wording unchanged.
                </small>
              </div>
              <div className="settings-template-workspace">
                <div
                  className="settings-template-list"
                  aria-label="SMS template list"
                >
                  {templates.map((item) => (
                    <button
                      type="button"
                      key={item.key}
                      className={selected === item.key ? "is-selected" : ""}
                      aria-pressed={selected === item.key}
                      onClick={() => setSelected(item.key)}
                    >
                      <MessageSquare size={18} aria-hidden="true" />
                      <span>
                        {item.name || "Untitled template"}{" "}
                        <small>
                          {item.key === "login"
                            ? "Mobile / KYC verification"
                            : item.key === "password-reset"
                              ? "Platform-managed recovery"
                              : "Additional template"}
                        </small>
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="settings-add-template"
                    disabled={templates.length >= 100}
                    onClick={() => {
                      const key = crypto.randomUUID();
                      setTemplates([
                        ...templates,
                        {
                          key,
                          name: `New SMS ${templates.length + 1}`,
                          id: "",
                          text: "",
                        },
                      ]);
                      setSelected(key);
                      setMessage("");
                      onDirtyChange?.(true);
                    }}
                  >
                    <Plus size={17} aria-hidden="true" />
                    Add SMS template
                  </button>
                  <small className="settings-template-capacity">
                    {templates.length} / 100 templates
                  </small>
                </div>
                {entry && (
                  <div className="settings-template-editor" key={entry.key}>
                    <div className="settings-template-heading">
                      <h4>{entry.name || "Untitled template"}</h4>
                      {!["login", "password-reset"].includes(entry.key) && (
                        <button
                          type="button"
                          aria-label={`Remove ${entry.name}`}
                          onClick={() => {
                            setTemplates(
                              templates.filter(
                                (item) => item.key !== entry.key,
                              ),
                            );
                            setSelected("login");
                            onDirtyChange?.(true);
                          }}
                        >
                          <Trash2 size={16} />
                          Remove
                        </button>
                      )}
                    </div>
                    {entry.key === "password-reset" && (
                      <p className="settings-explanation">
                        <LockKeyhole size={17} aria-hidden="true" />
                        This entry stores your reference copy. Global password
                        resets use the platform-managed sender and template.
                      </p>
                    )}
                    {entry.key !== "login" &&
                      entry.key !== "password-reset" && (
                        <p className="settings-explanation">
                          Additional templates are saved in your library. They
                          do not start sending messages automatically.
                        </p>
                      )}
                    <div className="settings-fields">
                      <SettingsField
                        label="Template name"
                        name="templateName"
                        placeholder="e.g. Login, Reset/Forgot Password, Subscription reminder"
                        value={entry.name}
                        onChange={(value) => edit("name", value)}
                        required
                        maxLength={80}
                      />
                      <SettingsField
                        label="DLT template ID"
                        name="templateId"
                        placeholder="e.g. 110100000000002"
                        value={entry.id}
                        onChange={(value) => edit("id", value)}
                        required={entry.key === "login"}
                        pattern="[0-9]{10,25}"
                        maxLength={25}
                      />
                    </div>
                    <SettingsField
                      label="Approved message"
                      name="templateText"
                      placeholder={
                        entry.key === "password-reset"
                          ? "Your password reset code is {{otp}}. Valid for {{expiryMinutes}} minutes. Do not share it. - Your RA"
                          : "Your mobile verification code is {{otp}}. Valid for {{expiryMinutes}} minutes. - Your RA"
                      }
                      value={entry.text}
                      onChange={(value) => edit("text", value)}
                      required={entry.key === "login"}
                      maxLength={441}
                      multiline
                      help="Use {{otp}} and, only if registered as a variable, {{expiryMinutes}}. Examples must be replaced with your approved DLT text."
                    />
                    <div className="settings-message-preview">
                      <span>Message preview</span>
                      <p>
                        {entry.text
                          ? entry.text
                              .replaceAll("{{otp}}", "123456")
                              .replaceAll("{{expiryMinutes}}", "5")
                          : "Your approved message will appear here with an example code."}
                      </p>
                      <small>
                        {entry.text.length} / 441 characters · multipart
                        messages may use more credits
                      </small>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="settings-save-bar">
              <p>
                <LockKeyhole size={16} aria-hidden="true" />
                Private settings. Saving does not publish your website.
              </p>
              <button className="button primary">
                {busy ? "Saving…" : "Save SMS settings"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {settings && (
        <section className="settings-delivery">
          <div className="settings-delivery-heading">
            <div>
              <h3>Recent sends (UTC)</h3>
              <p>
                Vendor acceptance does not confirm delivery or verify a mobile.
              </p>
            </div>
            <button type="button" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh SMS status
            </button>
          </div>
          {settings.events.length ? (
            <ul>
              {settings.events.map((event) => (
                <li key={event.id}>
                  <span>{event.created_at}</span>
                  <strong>{event.status}</strong>
                  <span>
                    Message {event.message_id ?? "—"} · Credits{" "}
                    {event.balance ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-empty">
              No SMS attempts yet. Your first verification request will appear
              here.
            </p>
          )}
          <a href={`/api/sms/${slug}/records`}>
            Mobile verification records (JSON)
          </a>
        </section>
      )}
    </section>
  );
}
