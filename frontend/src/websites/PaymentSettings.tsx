import { useEffect, useState, type FormEvent } from "react";
import { QrCode } from "lucide-react";
import { IntegrationSettings } from "./IntegrationSettings";
import {
  privateRequest,
  settingsError,
  SettingsField,
  SettingsHeader,
} from "./settings-ui";
import { paymentFile, type QrConfiguration } from "../account/Payments";

/** Coordinate independent QR and merchant forms without losing either form's unsaved-change guard. */
export function PaymentSettings({
  slug,
  onDirtyChange,
  onBusyChange,
}: {
  slug: string;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [qrDirty, setQrDirty] = useState(false),
    [merchantDirty, setMerchantDirty] = useState(false),
    [qrBusy, setQrBusy] = useState(false),
    [merchantBusy, setMerchantBusy] = useState(false);
  useEffect(() => {
    onDirtyChange(qrDirty || merchantDirty);
  }, [qrDirty, merchantDirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(qrBusy || merchantBusy);
  }, [qrBusy, merchantBusy, onBusyChange]);
  return (
    <div className="payment-settings">
      <QrSettings
        slug={slug}
        onDirtyChange={setQrDirty}
        onBusyChange={setQrBusy}
      />
      <IntegrationSettings
        slug={slug}
        kind="payment"
        onDirtyChange={setMerchantDirty}
        onBusyChange={setMerchantBusy}
      />
    </div>
  );
}

/** Save a tenant-owned QR with preview and independent versions; existing payment snapshots remain unchanged. */
function QrSettings({
  slug,
  onDirtyChange,
  onBusyChange,
}: {
  slug: string;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const api = `/api/workspaces/${slug}/onboarding/qr-settings`;
  const [draft, setDraft] = useState<QrConfiguration | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    let live = true;
    privateRequest(api)
      .then((value) => {
        if (live) setDraft(value);
      })
      .catch(() => {
        if (live) setError("integration_unavailable");
      });
    return () => {
      live = false;
    };
  }, [api]);
  /** Record local edits for the surrounding editor's navigation protection. */
  function change(values: Partial<QrConfiguration>) {
    setDraft((previous) => previous && { ...previous, ...values });
    onDirtyChange(true);
    setMessage("");
  }
  /** Reload the current saved version after a conflict or failed initial request. */
  async function reload() {
    setBusy(true);
    try {
      setDraft(await privateRequest(api));
      setError("");
      onDirtyChange(false);
    } catch {
      setError("integration_unavailable");
    } finally {
      setBusy(false);
    }
  }
  /** Persist validated QR metadata and bytes together, without requiring Cashfree credentials. */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setDraft(
        await privateRequest(api, { ...draft, removeImage: !draft!.image }),
      );
      onDirtyChange(false);
      setMessage("QR payment settings saved.");
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
        title="QR payment settings"
        description="Let investors pay your RA directly after completing MITC. You verify each payment before access starts."
        configured={!!draft?.image && !!draft.enabled}
      />
      {error && (
        <p className="settings-feedback is-error" role="alert">
          {settingsError(error)}{" "}
          <button type="button" onClick={() => void reload()}>
            Reload QR settings
          </button>
        </p>
      )}
      {message && (
        <p className="settings-feedback is-success" role="status">
          {message}
        </p>
      )}
      {!draft ? (
        <p role="status">
          {error ? "Reload QR settings to continue." : "Loading QR settings…"}
        </p>
      ) : (
        <form className="settings-form-body" onSubmit={save}>
          <fieldset className="settings-form-body" disabled={busy}>
            <div className="settings-section">
              <div className="settings-section-copy">
                <h3>
                  <QrCode size={20} aria-hidden="true" /> Direct QR payments
                </h3>
                <p>
                  QR is the default option when enabled. Use the receiving
                  account for this RA and check that the uploaded QR matches the
                  payee and UPI ID.
                </p>
                <p>
                  Replacing or removing this image affects new attempts.
                  Existing attempts retain their original payment details.
                </p>
              </div>
              <div className="settings-fields">
                <SettingsField
                  label="Payee name"
                  name="qrPayee"
                  placeholder="Name shown in the UPI app"
                  value={draft.payee}
                  onChange={(payee) => change({ payee })}
                  required
                  maxLength={160}
                />
                <SettingsField
                  label="UPI ID"
                  name="qrUpi"
                  placeholder="research@bank"
                  value={draft.upiId}
                  onChange={(upiId) => change({ upiId })}
                  required
                />
                <SettingsField
                  label="Payment instructions"
                  name="qrInstructions"
                  placeholder="Instructions for your investors"
                  value={draft.instructions}
                  onChange={(instructions) => change({ instructions })}
                  multiline
                  maxLength={1000}
                />
                <label htmlFor="qr-image">
                  Upload QR code (PNG or JPEG; up to 1 MB)
                </label>
                <input
                  id="qr-image"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    setError("");
                    void paymentFile(file)
                      .then((image) => change({ image }))
                      .catch(() => setError("invalid_payment_file"))
                      .finally(() => setBusy(false));
                  }}
                />
                {draft.image && (
                  <div className="qr-settings-preview">
                    <img
                      className="payment-qr"
                      src={draft.image}
                      alt="Saved RA payment QR preview"
                      width="240"
                      height="240"
                    />
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => change({ image: "", enabled: false })}
                    >
                      Remove QR image
                    </button>
                  </div>
                )}
                <label className="settings-checkbox settings-field-wide">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    disabled={!draft.image}
                    onChange={(event) =>
                      change({ enabled: event.target.checked })
                    }
                  />
                  Enable QR payments
                </label>
                <p>
                  Payments remain subject to the platform’s production approval.
                  Development is for synthetic evidence only.
                </p>
              </div>
            </div>
            <div className="settings-save-row">
              <button className="button primary" disabled={busy}>
                Save QR settings
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
