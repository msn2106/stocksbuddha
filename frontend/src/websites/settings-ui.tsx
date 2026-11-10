import { useId, useState, type ReactNode } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

/** Read or save private JSON settings without retaining secrets in browser storage. */
export async function privateRequest(api: string, body?: unknown) {
  const response = await fetch(
    api,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
/** Translate actionable integration failures without displaying provider payloads. */
export function settingsError(code: string): string {
  const messages: Record<string, string> = {
    invalid_qr_settings:
      "Enter a payee name and valid UPI ID (for example research@bank).",
    qr_image_required: "Upload a QR image before enabling QR payments.",
    invalid_payment_file:
      "Use a valid PNG or JPEG up to 1 MB for the QR, or payment proof up to 2 MB (PNG, JPEG or PDF).",
    version_conflict:
      "These settings changed in another window. Reload, review and save again.",
    invalid_sms_settings:
      "Check your template names, DLT IDs and Login message. The Login template must contain {{otp}}.",
    sms_encoding_mismatch:
      "Choose Unicode for messages containing Hindi or other regional-language characters.",
    sms_credentials_required:
      "Enter your SMS Horizon API key to save this connection.",
    sms_separate_accounts_required:
      "Use your RA’s SMS account. The platform password-recovery account is managed separately.",
    invalid_integration_settings:
      "Check the field formats and complete the required connection details.",
    integration_credentials_required:
      "Enter the provider credential for this first save. Existing credentials can be left blank.",
    payment_settings_locked:
      "Cashfree credentials are locked because a Cashfree checkout or payment is already recorded. Contact platform support to rotate merchant credentials safely.",
    sandbox_forbidden_in_production:
      "Production websites require production Cashfree credentials.",
    production_payments_not_approved:
      "Live payments require production deployment and the platform’s compliance approval.",
    forbidden: "Only the current RA Admin can manage these settings.",
  };
  return (
    messages[code] ??
    "Settings could not be saved or loaded. Check your connection and try again."
  );
}
/** Keep private integration headings and status separate from public website publication actions. */
export function SettingsHeader({
  title,
  description,
  configured,
  children,
}: {
  title: string;
  description: string;
  configured: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="service-settings-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <span className={`settings-state ${configured ? "is-configured" : ""}`}>
        <ShieldCheck size={16} aria-hidden="true" />
        {configured ? "Configured" : "Not configured"}
      </span>
      {children}
    </header>
  );
}
/** Render persistent field labels, examples and help with accessible optional secret visibility. */
export function SettingsField({
  label,
  name,
  placeholder,
  help,
  value,
  defaultValue,
  onChange,
  required = false,
  secret = false,
  multiline = false,
  maxLength = 256,
  pattern,
}: {
  label: string;
  name: string;
  placeholder: string;
  help?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  secret?: boolean;
  multiline?: boolean;
  maxLength?: number;
  pattern?: string;
}) {
  const id = useId(),
    [visible, setVisible] = useState(false);
  const common = {
    id,
    name,
    placeholder,
    required,
    maxLength,
    "aria-describedby": help ? `${id}-help` : undefined,
    ...(value !== undefined ? { value } : { defaultValue }),
  };
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <div className={secret ? "settings-secret" : ""}>
        {multiline ? (
          <textarea
            {...common}
            rows={5}
            onChange={(event) => onChange?.(event.target.value)}
          />
        ) : (
          <input
            {...common}
            pattern={pattern}
            type={secret && !visible ? "password" : "text"}
            autoComplete={secret ? "new-password" : "off"}
            onChange={(event) => onChange?.(event.target.value)}
          />
        )}
        {secret && (
          <button
            type="button"
            className="settings-reveal"
            aria-label={`${visible ? "Hide" : "Show"} ${label}`}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {help && <small id={`${id}-help`}>{help}</small>}
    </div>
  );
}
