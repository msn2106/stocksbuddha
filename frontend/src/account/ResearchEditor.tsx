import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X, Trash2, Users, Layers, FileText } from "lucide-react";
import type {
  ResearchDraft,
  ResearchItem,
  ResearchOptions,
  ResearchPreview,
} from "@ra/contracts";
import { useLanguage } from "../i18n";
import { InstrumentPicker } from "./MarketSetup";
import { ResearchReport } from "./ResearchReport";
const publicationMessages: Record<string, string> = {
  current_declaration_required:
    "Complete today's personal-trading declaration in Market Setup before publishing.",
  expired_instrument:
    "A selected contract has expired. Choose a current contract.",
  personal_trade_lookback:
    "A declared personal trade falls within the 30-day restriction period.",
  catalogue_stale:
    "Instrument reference data needs refreshing before publication.",
  offering_instrument_mismatch:
    "The selected contracts do not match the research offering.",
  quantity_must_match_lot_size:
    "Each F&O quantity must be a multiple of its contract lot size.",
  validity_expired: "Choose a validity date in the future.",
  validity_after_contract_expiry:
    "Recommendation validity cannot extend beyond a contract's expiry date.",
  registration_required: "Add the RA's registration details before publishing.",
  no_eligible_recipients:
    "No selected subscribers currently qualify for this research offering.",
  production_review_required:
    "Production review must be completed before publication is enabled.",
};
/** Create an empty leg with explicit editable prices; no market quote or research target is fabricated. */
function newLeg(): ResearchDraft["legs"][number] {
  return {
    instrumentKey: "",
    side: "buy",
    quantity: 1,
    horizon: "swing",
    entryMin: 0,
    entryMax: 0,
    stopLoss: 0,
    targets: [0],
    note: "",
    rationale: "",
  };
}
/** Convert a local datetime input to an ISO timestamp without changing its intended instant. */
function localTime(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
/** Accessible multi-leg recommendation editor, recipient selection and server-verified publication preview. */
export function ResearchEditor({
  slug,
  item,
  options,
  request,
  onClose,
  onSaved,
}: {
  slug: string;
  item: ResearchItem | null;
  options: ResearchOptions;
  request: (path: string, body: unknown) => Promise<unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useLanguage(),
    hi = locale === "hi";
  const [id] = useState(() => item?.id ?? crypto.randomUUID()),
    [version, setVersion] = useState(item?.version ?? 0);
  const [draft, setDraft] = useState<ResearchDraft>(
    () =>
      item?.draft ?? {
        title: "",
        offering: "equity",
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        rationale: "",
        disclosures: "",
        aiDisclosure: "",
        attachmentIds: [],
        legs: [newLeg()],
        audience: { mode: "all", ids: [] },
      },
  );
  const [preview, setPreview] = useState<ResearchPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [reason, setReason] = useState("");
  const published = !!item?.latest;
  /** Any edit invalidates the previous publication preview and its user confirmation. */
  function edit(next: ResearchDraft) {
    setDraft(next);
    setPreview(null);
    setConfirmed(false);
    setMessage("");
  }
  /** Update exactly one leg without changing the order used by the report snapshot. */
  function legEdit(n: number, patch: Partial<ResearchDraft["legs"][number]>) {
    edit({
      ...draft,
      legs: draft.legs.map((l, i) => (i === n ? { ...l, ...patch } : l)),
    });
  }
  /** Save before requesting a preview; conflict failures preserve user-entered form content. */
  async function save(withPreview: boolean) {
    setBusy(true);
    setError("");
    setPreview(null);
    setConfirmed(false);
    try {
      const saved = (await request("", { id, version, draft })) as {
        version: number;
      };
      setVersion(saved.version);
      setMessage(hi ? "ड्राफ्ट सुरक्षित है।" : "Draft saved.");
      if (withPreview)
        setPreview((await request(`/${id}/preview`, {})) as ResearchPreview);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Publish only the saved version and server-issued preview token; updates require a retained explanation. */
  async function publish() {
    if (!preview?.token) return;
    setBusy(true);
    setError("");
    try {
      await request(`/${id}/publish`, {
        version,
        token: preview.token,
        confirmed,
        reason,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }
  /** Upload through the existing private Drive-backed document API and attach only its returned identifier. */
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/workspaces/${slug}/documents`, {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-Document-Name": encodeURIComponent(file.name),
          "X-Document-Kind": "general",
        },
        body: file,
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? "Upload failed");
      edit({ ...draft, attachmentIds: [...draft.attachmentIds, result.id] });
      setMessage(`${file.name} ${hi ? "जोड़ा गया।" : "attached."}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="research-overlay" />
        <Dialog.Content
          className="research-dialog"
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <header className="research-dialog-heading">
            <div>
              <Dialog.Title>
                {published
                  ? hi
                    ? "अनुशंसा अपडेट करें"
                    : "Update recommendation"
                  : hi
                    ? "नई अनुशंसा बनाएँ"
                    : "Create recommendation"}
              </Dialog.Title>
              <Dialog.Description>
                {hi
                  ? "ट्रेड विवरण, रिसर्च और सब्सक्राइबर एक साथ तय करें।"
                  : "Define the trade, explain your research and choose who receives it."}
              </Dialog.Description>
            </div>
            <Dialog.Close
              disabled={busy}
              className="research-icon"
              aria-label={hi ? "बंद करें" : "Close editor"}
            >
              <X size={22} />
            </Dialog.Close>
          </header>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(true);
            }}
            className="research-editor-form"
          >
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="workspace-notice">
                {message}
              </p>
            )}
            <fieldset disabled={busy} className="research-editor-fields">
              <div className="research-mode">
                <button
                  type="button"
                  disabled={published}
                  aria-pressed={draft.offering !== "hedges"}
                  onClick={() =>
                    edit({
                      ...draft,
                      offering: "equity",
                      legs: [draft.legs[0]],
                    })
                  }
                >
                  <FileText size={18} />
                  {hi ? "सामान्य ट्रेड" : "Normal trade"}
                </button>
                <button
                  type="button"
                  disabled={published}
                  aria-pressed={draft.offering === "hedges"}
                  onClick={() =>
                    edit({
                      ...draft,
                      offering: "hedges",
                      legs:
                        draft.legs.length > 1
                          ? draft.legs
                          : [draft.legs[0], newLeg()],
                    })
                  }
                >
                  <Layers size={18} />
                  {hi ? "हेज ट्रेड" : "Hedge trade"}
                </button>
              </div>
              <div className="research-grid">
                <label>
                  {hi ? "शीर्षक" : "Recommendation title"}
                  <input
                    required
                    minLength={3}
                    maxLength={160}
                    value={draft.title}
                    onChange={(e) => edit({ ...draft, title: e.target.value })}
                    placeholder="e.g. Reliance · swing opportunity"
                  />
                </label>
                <label>
                  {hi ? "रिसर्च श्रेणी" : "Research offering"}
                  <select
                    disabled={published || draft.offering === "hedges"}
                    value={draft.offering}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        offering: e.target.value as ResearchDraft["offering"],
                      })
                    }
                  >
                    <option value="equity">Equity</option>
                    <option value="futures">Futures</option>
                    <option value="options">Options</option>
                    <option value="hedges">Hedges</option>
                  </select>
                </label>
              </div>
              {draft.legs.map((leg, n) => (
                <section key={n} className={`research-leg ${n ? "hedge" : ""}`}>
                  <header>
                    <h3>
                      {n === 0
                        ? hi
                          ? "मुख्य लेग"
                          : "Main leg"
                        : hi
                          ? "हेज लेग"
                          : "Hedge leg"}{" "}
                      <span>{n + 1}</span>
                    </h3>
                    {draft.legs.length > 2 && !published && (
                      <button
                        type="button"
                        className="research-icon"
                        aria-label={`Remove leg ${n + 1}`}
                        onClick={() =>
                          edit({
                            ...draft,
                            legs: draft.legs.filter((_l, i) => i !== n),
                          })
                        }
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </header>
                  <div className="research-grid">
                    <label>
                      {hi ? "दिशा" : "Direction"}
                      <select
                        disabled={published}
                        value={leg.side}
                        onChange={(e) =>
                          legEdit(n, {
                            side: e.target.value as typeof leg.side,
                          })
                        }
                      >
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                        <option value="hold">Hold</option>
                      </select>
                    </label>
                    <label>
                      {hi ? "समय सीमा" : "Horizon"}
                      <select
                        value={leg.horizon}
                        onChange={(e) =>
                          legEdit(n, {
                            horizon: e.target.value as typeof leg.horizon,
                          })
                        }
                      >
                        <option value="intraday">Intraday</option>
                        <option value="swing">Swing</option>
                        <option value="longterm">Long term</option>
                      </select>
                    </label>
                    <label>
                      {hi ? "मात्रा (यूनिट)" : "Quantity (units)"}
                      <input
                        type="number"
                        required
                        min={1}
                        max={10000000}
                        value={leg.quantity}
                        onChange={(e) =>
                          legEdit(n, { quantity: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <p className="research-selected">
                    {hi ? "चुना गया कॉन्ट्रैक्ट" : "Selected contract"}:{" "}
                    <strong>
                      {(item?.latest?.instruments.find(
                        (i) => i.key === leg.instrumentKey,
                      )?.symbol ??
                        leg.instrumentKey) ||
                        (hi ? "कोई नहीं" : "None")}
                    </strong>
                  </p>
                  {!published && (
                    <InstrumentPicker
                      base={`/api/workspaces/${slug}/market`}
                      onSelect={(i) =>
                        legEdit(n, {
                          instrumentKey: i?.key ?? "",
                          ...(i ? { quantity: i.lotSize } : {}),
                        })
                      }
                    />
                  )}
                  <p className="research-muted">
                    {hi
                      ? "ऑप्शन की कीमतें प्रीमियम हैं। F&O मात्रा लॉट साइज के गुणज में दर्ज करें।"
                      : "Option prices are premiums. F&O quantity must be a multiple of the contract lot size."}
                  </p>
                  <div className="research-grid">
                    {(["entryMin", "entryMax", "stopLoss"] as const).map(
                      (key, i) => (
                        <label key={key}>
                          {
                            (hi
                              ? [
                                  "न्यूनतम एंट्री (₹)",
                                  "अधिकतम एंट्री (₹)",
                                  "स्टॉप लॉस (₹)",
                                ]
                              : [
                                  "Entry minimum (₹)",
                                  "Entry maximum (₹)",
                                  "Stop-loss (₹)",
                                ])[i]
                          }
                          <input
                            required
                            type="number"
                            min="0.01"
                            step="any"
                            value={leg[key] || ""}
                            onChange={(e) =>
                              legEdit(n, { [key]: Number(e.target.value) })
                            }
                          />
                        </label>
                      ),
                    )}
                  </div>
                  <div className="research-targets">
                    {leg.targets.map((target, t) => (
                      <label key={t}>
                        {hi ? "लक्ष्य" : "Target"} {t + 1} (₹)
                        <div>
                          <input
                            required
                            type="number"
                            step="any"
                            min="0.01"
                            value={target || ""}
                            onChange={(e) =>
                              legEdit(n, {
                                targets: leg.targets.map((v, i) =>
                                  i === t ? Number(e.target.value) : v,
                                ),
                              })
                            }
                          />
                          {leg.targets.length > 1 && (
                            <button
                              type="button"
                              className="research-icon"
                              aria-label={`Remove target ${t + 1}`}
                              onClick={() =>
                                legEdit(n, {
                                  targets: leg.targets.filter(
                                    (_v, i) => i !== t,
                                  ),
                                })
                              }
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  {leg.targets.length < 5 && (
                    <button
                      type="button"
                      className="research-add"
                      onClick={() =>
                        legEdit(n, { targets: [...leg.targets, 0] })
                      }
                    >
                      <Plus size={16} />
                      {hi ? "लक्ष्य जोड़ें" : "Add target"}
                    </button>
                  )}
                  <div className="research-grid">
                    <label>
                      {hi ? "नोट (वैकल्पिक)" : "Note (optional)"}
                      <textarea
                        maxLength={2000}
                        value={leg.note}
                        onChange={(e) => legEdit(n, { note: e.target.value })}
                      />
                    </label>
                    <label>
                      {hi ? "इस लेग का आधार" : "Leg rationale"}
                      <textarea
                        required
                        minLength={10}
                        maxLength={4000}
                        value={leg.rationale}
                        onChange={(e) =>
                          legEdit(n, { rationale: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </section>
              ))}
              {draft.offering === "hedges" &&
                draft.legs.length < 10 &&
                !published && (
                  <button
                    type="button"
                    className="research-add-leg"
                    onClick={() =>
                      edit({ ...draft, legs: [...draft.legs, newLeg()] })
                    }
                  >
                    <Plus size={18} />
                    {hi ? "एक और लेग जोड़ें" : "Add another leg"}
                  </button>
                )}
              <section className="research-section">
                <h3>{hi ? "रिसर्च और प्रकटीकरण" : "Research & disclosures"}</h3>
                <label>
                  {hi ? "संयुक्त रिसर्च का आधार" : "Overall research rationale"}
                  <textarea
                    required
                    minLength={20}
                    maxLength={12000}
                    rows={4}
                    value={draft.rationale}
                    onChange={(e) =>
                      edit({ ...draft, rationale: e.target.value })
                    }
                  />
                </label>
                <label>
                  {hi
                    ? "भौतिक हित और प्रकटीकरण"
                    : "Material interests & disclosures"}
                  <textarea
                    required
                    minLength={20}
                    maxLength={6000}
                    rows={4}
                    value={draft.disclosures}
                    onChange={(e) =>
                      edit({ ...draft, disclosures: e.target.value })
                    }
                  />
                  <small>
                    {hi
                      ? "वित्तीय हित, स्वामित्व, हितों के टकराव, मुआवज़े और लागू अन्य प्रकटीकरण दर्ज करें।"
                      : "State financial interests, ownership, conflicts, compensation and other applicable research disclosures."}
                  </small>
                </label>
                <label>
                  {hi ? "AI उपकरणों का उपयोग" : "Extent of AI use"}
                  <textarea
                    required
                    minLength={2}
                    maxLength={2000}
                    value={draft.aiDisclosure}
                    onChange={(e) =>
                      edit({ ...draft, aiDisclosure: e.target.value })
                    }
                    placeholder={
                      hi
                        ? "यदि उपयोग नहीं हुआ तो स्पष्ट लिखें।"
                        : "State explicitly if no AI tools were used."
                    }
                  />
                </label>
                <label>
                  {hi
                    ? "वैधता (आपके स्थानीय समय में)"
                    : "Valid until (your local time)"}
                  <input
                    required
                    type="datetime-local"
                    value={localTime(draft.validUntil)}
                    onChange={(e) => {
                      if (e.target.value)
                        edit({
                          ...draft,
                          validUntil: new Date(e.target.value).toISOString(),
                        });
                    }}
                  />
                </label>
                <label>
                  {hi ? "सहायक फ़ाइल जोड़ें" : "Upload supporting file"}
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    disabled={draft.attachmentIds.length >= 10}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                      e.target.value = "";
                    }}
                  />
                  <small>PDF, PNG, JPEG · 10 MB maximum</small>
                </label>
                {!!draft.attachmentIds.length && (
                  <ul>
                    {draft.attachmentIds.map((id) => (
                      <li key={id}>
                        {options.attachments.find((f) => f.id === id)?.name ??
                          "Attached research file"}{" "}
                        <button
                          type="button"
                          onClick={() =>
                            edit({
                              ...draft,
                              attachmentIds: draft.attachmentIds.filter(
                                (f) => f !== id,
                              ),
                            })
                          }
                        >
                          {hi ? "हटाएँ" : "Remove"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!!options.attachments.length && (
                  <label>
                    {hi
                      ? "पहले अपलोड की गई फ़ाइल"
                      : "Attach an existing RA file"}
                    <select
                      value=""
                      disabled={draft.attachmentIds.length >= 10}
                      onChange={(e) => {
                        if (
                          e.target.value &&
                          !draft.attachmentIds.includes(e.target.value)
                        )
                          edit({
                            ...draft,
                            attachmentIds: [
                              ...draft.attachmentIds,
                              e.target.value,
                            ],
                          });
                      }}
                    >
                      <option value="">
                        {hi ? "फ़ाइल चुनें" : "Choose file"}
                      </option>
                      {options.attachments.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </section>
              <section className="research-section research-audience">
                <h3>
                  <Users size={18} />
                  {hi
                    ? "इस अनुशंसा के प्राप्तकर्ता"
                    : "Recipients for this recommendation"}
                </h3>
                <label>
                  {hi ? "क्लाइंट चुनें" : "Target clients"}
                  <select
                    disabled={published}
                    value={draft.audience.mode}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        audience: {
                          mode: e.target
                            .value as ResearchDraft["audience"]["mode"],
                          ids: [],
                        },
                      })
                    }
                  >
                    <option value="all">All eligible subscribers</option>
                    <option value="plans">Specific plans</option>
                    <option value="groups">Specific client groups</option>
                  </select>
                </label>
                {draft.audience.mode !== "all" && (
                  <div className="research-choice-list">
                    {(draft.audience.mode === "plans"
                      ? options.plans
                      : options.groups
                    ).map((p) => (
                      <label className="research-check" key={p.id}>
                        <input
                          type="checkbox"
                          disabled={published}
                          checked={draft.audience.ids.includes(p.id)}
                          onChange={(e) =>
                            edit({
                              ...draft,
                              audience: {
                                ...draft.audience,
                                ids: e.target.checked
                                  ? [...draft.audience.ids, p.id]
                                  : draft.audience.ids.filter(
                                      (id) => id !== p.id,
                                    ),
                              },
                            })
                          }
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                )}
                <p>
                  {published
                    ? hi
                      ? "अपडेट मूल प्राप्तकर्ताओं को भेजे जाएंगे।"
                      : "Updates go to the original recipients. Audience and trade identities are locked after publication."
                    : hi
                      ? "केवल वर्तमान KYC, भुगतान और इस रिसर्च श्रेणी की पहुँच वाले सब्सक्राइबर शामिल होंगे।"
                      : "Only subscribers with current KYC, paid entitlement and access to this research offering are included."}
                </p>
                <p>
                  <strong>{hi ? "डिलीवरी चैनल" : "Delivery channel"}:</strong>{" "}
                  {hi
                    ? "इन्वेस्टर डैशबोर्ड और अनुशंसाएँ"
                    : "Investor dashboard & Recommendations"}
                </p>
              </section>
              <footer className="research-actions">
                <button type="button" onClick={onClose}>
                  {hi ? "रद्द करें" : "Cancel"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    if (e.currentTarget.form?.reportValidity())
                      void save(false);
                  }}
                >
                  {hi ? "ड्राफ्ट सुरक्षित करें" : "Save draft"}
                </button>
                <button type="submit" className="button primary">
                  {busy
                    ? hi
                      ? "सुरक्षित हो रहा है…"
                      : "Saving…"
                    : hi
                      ? "पूर्वावलोकन और प्राप्तकर्ता जाँचें"
                      : "Preview & check recipients"}
                </button>
              </footer>
            </fieldset>
          </form>
          {preview && (
            <section className="research-publication-preview">
              <h2>{hi ? "प्रकाशन पूर्वावलोकन" : "Publication preview"}</h2>
              <p>
                <strong>{preview.recipientCount}</strong>{" "}
                {hi ? "प्राप्तकर्ता" : "recipients"} ·{" "}
                {hi ? "डैशबोर्ड डिलीवरी" : "Dashboard delivery"}
              </p>
              {[...preview.check.reasons, ...preview.reasons].map((r) => (
                <p role="alert" className="account-error" key={r}>
                  {publicationMessages[r] ??
                    "Publication requires further review."}
                </p>
              ))}
              {preview.check.conflicts.map((c) => (
                <p key={c.id}>
                  {c.symbol}:{" "}
                  {hi ? "सबसे पहले प्रकाशन" : "Earliest publication"} {c.until}
                </p>
              ))}
              <ResearchReport report={preview.snapshot} />
              {published && (
                <label>
                  {hi ? "अपडेट का कारण" : "Reason for update"}
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              <label className="research-check">
                <input
                  type="checkbox"
                  disabled={!preview.token || busy}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {hi
                  ? "मैं रिसर्च, प्रकटीकरण और प्राप्तकर्ताओं की पुष्टि करता/करती हूँ।"
                  : "I confirm the research, disclosures and recipient selection are ready to publish."}
              </label>
              <button
                className="button primary"
                disabled={
                  !confirmed ||
                  !preview.token ||
                  busy ||
                  (published && reason.trim().length < 10)
                }
                onClick={() => void publish()}
              >
                {published
                  ? hi
                    ? "अपडेट प्रकाशित करें"
                    : "Publish update"
                  : hi
                    ? "अनुशंसा प्रकाशित करें"
                    : "Publish recommendation"}
              </button>
            </section>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
