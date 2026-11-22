import { useEffect, useRef, useState } from "react";
import { Plus, ArrowLeft, Bell, Users } from "lucide-react";
import type {
  ResearchItem,
  ResearchDetail,
  ResearchOptions,
} from "@ra/contracts";
import { useLanguage } from "../i18n";
import { ResearchEditor } from "./ResearchEditor";
import { ResearchReport } from "./ResearchReport";
import { TelegramConnection, telegramErrors } from "./TelegramConnection";
const messages: Record<string, string> = {
  ...telegramErrors,
  research_version_conflict:
    "This recommendation changed in another session. Reload it before saving.",
  preview_changed:
    "Recipients or declarations changed. Preview again before publishing.",
  publication_blocked:
    "Publication checks changed. Review the preview and your Market Setup declaration.",
  invalid_recommendation:
    "Check all required fields, price ranges, stop-loss, targets and recipient choices.",
  invalid_audience: "One of the selected plans or groups is unavailable.",
  instrument_not_found:
    "Select a current equity, futures or options contract for every leg.",
  published_scope_locked:
    "Published instruments, directions, offering and audience cannot be changed. Create a new recommendation for a different trade.",
  recommendation_final: "This recommendation is closed or withdrawn.",
  attachment_not_found:
    "A supporting file is unavailable or does not belong to this RA.",
};
/** Owner management and investor delivery views share only published snapshots, never private drafts or audience lists. */
export function Recommendations({
  slug,
  owner = false,
  compact = false,
}: {
  slug: string;
  owner?: boolean;
  compact?: boolean;
}) {
  const { locale } = useLanguage(),
    hi = locale === "hi",
    base = `/api/workspaces/${slug}/recommendations`;
  const [items, setItems] = useState<ResearchItem[]>([]),
    [hasMore, setHasMore] = useState(false),
    [page, setPage] = useState(0),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<ResearchOptions | null>(null),
    [editing, setEditing] = useState<ResearchItem | null | undefined>(
      undefined,
    ),
    [detail, setDetail] = useState<ResearchDetail | null>(null),
    [history, setHistory] = useState(0),
    [groups, setGroups] = useState(false),
    [reason, setReason] = useState(""),
    [sendTelegram, setSendTelegram] = useState(false),
    [telegramMessage, setTelegramMessage] = useState(""),
    [status, setStatus] = useState<"closed" | "withdrawn">("closed");
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (detail) {
      detailRef.current?.focus();
      detailRef.current?.scrollIntoView?.({ block: "start" });
    }
  }, [detail]);
  /** Parse safe API errors and keep transport failures visible instead of showing an empty successful list. */
  async function request(path: string, body?: unknown): Promise<unknown> {
    const r = await fetch(
      `${base}${path}`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const value = await r.json();
    if (!r.ok)
      throw new Error(
        (value.error === "invalid_recommendation" && Array.isArray(value.issues)
          ? value.issues
              .map((issue: { path: string; message: string }) => {
                const label = issue.path
                  .replace(
                    /^draft\.legs\.(\d+)\./,
                    (_: string, n: string) =>
                      `${hi ? "लेग" : "Leg"} ${Number(n) + 1} · `,
                  )
                  .replace(/^draft\./, "");
                const friendly: Record<string, string> = {
                  instrumentKey: hi ? "इंस्ट्रूमेंट" : "Instrument",
                  stopLoss: hi ? "स्टॉप लॉस" : "Stop-loss",
                  entryMin: hi ? "न्यूनतम एंट्री" : "Entry minimum",
                  entryMax: hi ? "अधिकतम एंट्री" : "Entry maximum",
                  targets: hi ? "लक्ष्य" : "Targets",
                  legs: hi ? "ट्रेड लेग" : "Trade legs",
                  audience: hi ? "प्राप्तकर्ता" : "Recipients",
                  validUntil: hi
                    ? "अनुशंसा की वैधता"
                    : "Recommendation validity",
                  attachmentIds: hi ? "सहायक फ़ाइलें" : "Supporting files",
                  rationale: hi ? "रिसर्च का आधार" : "Rationale",
                  disclosures: hi ? "प्रकटीकरण" : "Disclosures",
                  aiDisclosure: hi ? "AI का उपयोग" : "AI use",
                };
                const readable = label.replace(
                  /\b(instrumentKey|stopLoss|entryMin|entryMax|targets|legs|audience|validUntil|attachmentIds|rationale|disclosures|aiDisclosure)\b/g,
                  (key) => friendly[key],
                );
                return `${readable}: ${issue.message}`;
              })
              .join("\n")
          : undefined) ??
          messages[value.error] ??
          (hi
            ? "अनुरोध पूरा नहीं हुआ। फिर प्रयास करें।"
            : `Unable to complete request: ${value.error ?? r.status}`),
      );
    return value;
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch(`${base}?page=${page}`)
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            hi
              ? "अनुशंसाएँ उपलब्ध नहीं हैं।"
              : "Recommendations are unavailable. Please retry.",
          );
        return r.json();
      })
      .then((v) => {
        if (active) {
          setItems(v.items);
          setHasMore(v.hasMore);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, page, reload, hi]);
  /** Load tenant choices on demand before opening the editor or cohort manager. */
  async function configure(item: ResearchItem | null, groupMode = false) {
    setBusy(true);
    setError("");
    try {
      setOptions((await request("/options")) as ResearchOptions);
      if (groupMode) setGroups(true);
      else setEditing(item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Opening the latest delivered report acknowledges only that version; older versions remain inspectable. */
  async function open(id: string) {
    setBusy(true);
    setError("");
    try {
      const d = (await request(`/${id}`)) as ResearchDetail;
      setDetail(d);
      setHistory(0);
      setReason("");
      setTelegramMessage("");
      setSendTelegram(false);
      if (!owner && d.latest) {
        await request(`/${id}/read`, { version: d.latest.version });
        setItems((rows) =>
          rows.map((i) => (i.id === id ? { ...i, unread: false } : i)),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Closure keeps an immutable reason and notifies original recipients without claiming automated target verification. */
  async function close() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await request(`/${detail.id}/close`, {
        version: detail.version,
        status,
        reason,
        sendTelegram,
      });
      setDetail((await request(`/${detail.id}`)) as ResearchDetail);
      setHistory(0);
      setReason("");
      setReload((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={`recommendations ${compact ? "compact" : ""}`}
      aria-label={hi ? "अनुशंसाएँ" : "Recommendations"}
    >
      <header className="research-page-heading">
        <div>
          <h1>
            {compact
              ? hi
                ? "आपकी नवीनतम अनुशंसाएँ"
                : "Your latest recommendations"
              : hi
                ? "अनुशंसाएँ"
                : "Recommendations"}
          </h1>
          <p>
            {owner
              ? hi
                ? "रिसर्च तैयार करें और सही सब्सक्राइबर को प्रकाशित करें।"
                : "Prepare research and publish it to the right subscribers."
              : hi
                ? "आपको भेजी गई रिसर्च और उसके अपडेट।"
                : "Research delivered to you, with the full update history."}
          </p>
        </div>
        {owner && !compact && (
          <div className="research-toolbar">
            <button disabled={busy} onClick={() => void configure(null, true)}>
              <Users size={17} />
              {hi ? "क्लाइंट समूह" : "Client groups"}
            </button>
            <button
              disabled={busy}
              className="button primary"
              onClick={() => void configure(null)}
            >
              <Plus size={18} />
              {hi ? "अनुशंसा बनाएँ" : "Create recommendation"}
            </button>
          </div>
        )}
      </header>
      {!owner && <TelegramConnection slug={slug} />}
      {error && (
        <p className="account-error" role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setError("");
              setReload((v) => v + 1);
            }}
          >
            {hi ? "फिर प्रयास करें" : "Retry"}
          </button>
        </p>
      )}
      {loading ? (
        <p role="status">
          {hi ? "लोड हो रहा है…" : "Loading recommendations…"}
        </p>
      ) : !items.length ? (
        <div className="research-empty">
          <FileEmpty />
          <h2>
            {owner
              ? hi
                ? "अपनी पहली अनुशंसा तैयार करें"
                : "Prepare your first recommendation"
              : hi
                ? "अभी कोई अनुशंसा नहीं"
                : "No recommendations yet"}
          </h2>
          <p>
            {owner
              ? hi
                ? "मार्केट सेटअप में घोषणा और प्लान पहुँच जाँचें, फिर ड्राफ्ट बनाएँ।"
                : "Check your declaration and plan access in Market Setup, then create a draft."
              : hi
                ? "आपकी योजना के अनुसार भेजी गई अनुशंसाएँ यहाँ दिखाई देंगी।"
                : "Recommendations shared with your eligible subscription will appear here. Previously delivered research remains available after subscription expiry."}
          </p>
        </div>
      ) : (
        <div className="research-list">
          {items.slice(0, compact ? 3 : 20).map((item) => {
            const title = owner ? item.draft?.title : item.latest?.title;
            return (
              <article className="research-list-row" key={item.id}>
                <div>
                  <p className="research-eyebrow">
                    {owner ? item.draft?.offering : item.latest?.offering} ·{" "}
                    <span>{item.status}</span>
                    {item.unread && (
                      <strong className="research-unread">
                        <Bell size={14} />
                        {hi ? "नया" : "Unread"}
                      </strong>
                    )}
                  </p>
                  <h2>{title}</h2>
                  {item.latest ? (
                    <p>
                      {item.latest.issuer.name} ·{" "}
                      {new Date(item.latest.publishedAt).toLocaleString(
                        "en-IN",
                        { timeZone: "Asia/Kolkata" },
                      )}{" "}
                      IST · v{item.latest.version}
                    </p>
                  ) : (
                    <p>
                      {hi
                        ? "निजी ड्राफ्ट — अभी भेजा नहीं गया"
                        : "Private draft — not yet delivered"}
                    </p>
                  )}
                  {owner && item.latest && (
                    <small>
                      {item.recipientCount} {hi ? "प्राप्तकर्ता" : "recipients"}
                      {item.version > item.latest.version
                        ? ` · ${hi ? "अप्रकाशित बदलाव" : "Unpublished changes"}`
                        : ""}
                    </small>
                  )}
                </div>
                <div className="research-row-actions">
                  {item.latest && (
                    <button disabled={busy} onClick={() => void open(item.id)}>
                      {hi ? "रिसर्च देखें" : "View research"}
                    </button>
                  )}
                  {owner && ["draft", "active"].includes(item.status) && (
                    <button
                      disabled={busy}
                      onClick={() => void configure(item)}
                    >
                      {item.status === "draft"
                        ? hi
                          ? "ड्राफ्ट खोलें"
                          : "Edit draft"
                        : hi
                          ? "अपडेट तैयार करें"
                          : "Prepare update"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {compact ? (
        <a
          className="research-all"
          href={`/ra/${slug}/account/recommendations?lang=${locale}`}
        >
          {hi ? "सभी अनुशंसाएँ देखें" : "View all recommendations"}
        </a>
      ) : (
        <div className="research-pagination">
          <button
            disabled={!page || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            {hi ? "पिछला" : "Previous"}
          </button>
          <span>
            {hi ? "पृष्ठ" : "Page"} {page + 1}
          </span>
          <button
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            {hi ? "अगला" : "Next"}
          </button>
        </div>
      )}
      {detail && (
        <section
          className="research-detail"
          ref={detailRef}
          tabIndex={-1}
          aria-label={hi ? "प्रकाशित रिपोर्ट" : "Published report"}
        >
          <button onClick={() => setDetail(null)}>
            <ArrowLeft size={16} />
            {hi ? "रिपोर्ट बंद करें" : "Close report"}
          </button>
          <label>
            {hi ? "प्रकाशन इतिहास" : "Publication history"}
            <select
              value={history}
              onChange={(e) => setHistory(Number(e.target.value))}
            >
              {detail.history.map((r, n) => (
                <option key={r.version} value={n}>
                  v{r.version} · {r.status} ·{" "}
                  {new Date(r.publishedAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  IST
                </option>
              ))}
            </select>
          </label>
          {detail.history[history] && (
            <ResearchReport
              report={detail.history[history]}
              attachmentBase={`${base}/${detail.id}/attachments`}
            />
          )}
          {owner && detail.latest && (
            <section aria-label="Telegram delivery">
              <h3>Telegram delivery</h3>
              <p>
                Send the latest published version to the original plan/group
                audience. Only investors with a current verified Telegram link
                can receive it.
              </p>
              <p>
                {Object.entries(detail.telegramDelivery ?? {})
                  .map(([state, count]) => `${state}: ${count}`)
                  .join(" · ") ||
                  "This version has not been queued for Telegram."}
              </p>
              <p>
                Skipped means no eligible active link or a newer version exists.
                Unknown means delivery could not be confirmed; it is not
                automatically resent.
              </p>
              {telegramMessage && <p role="status">{telegramMessage}</p>}
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await request(`/${detail.id}/telegram`, {
                      version: detail.version,
                    });
                    setDetail(
                      (await request(`/${detail.id}`)) as ResearchDetail,
                    );
                    setTelegramMessage(
                      "Telegram delivery requested. Refresh delivery status to see the results. Repeated requests will not resend this version.",
                    );
                  } catch (failure) {
                    setError((failure as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Send latest version to Telegram
              </button>{" "}
              <button disabled={busy} onClick={() => void open(detail.id)}>
                Refresh delivery status
              </button>
            </section>
          )}
          {owner && detail.status === "active" && (
            <form
              className="research-closure"
              onSubmit={(e) => {
                e.preventDefault();
                void close();
              }}
            >
              <h3>
                {hi
                  ? "अनुशंसा समाप्त करें"
                  : "Close or withdraw recommendation"}
              </h3>
              <label>
                {hi ? "स्थिति" : "Status"}
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                >
                  <option value="closed">Closed</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              </label>
              <label>
                {hi
                  ? "कारण (इतिहास में रहेगा)"
                  : "Reason (retained in history)"}
                <textarea
                  required
                  minLength={10}
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <p>
                {hi
                  ? "मूल प्राप्तकर्ताओं को अपडेट मिलेगा। यह कार्रवाई वापस नहीं हो सकती।"
                  : "Original recipients will receive this update. Closed or withdrawn research cannot be reopened."}
              </p>
              <label className="research-check">
                <input
                  type="checkbox"
                  checked={sendTelegram}
                  onChange={(event) => setSendTelegram(event.target.checked)}
                />{" "}
                Also send this status update on Telegram
              </label>
              <button disabled={busy} type="submit">
                {hi ? "स्थिति की पुष्टि करें" : "Confirm status update"}
              </button>
            </form>
          )}
        </section>
      )}
      {editing !== undefined && options && (
        <ResearchEditor
          slug={slug}
          item={editing}
          options={options}
          request={request}
          onClose={() => setEditing(undefined)}
          onSaved={() => setReload((v) => v + 1)}
        />
      )}
      {groups && options && (
        <ClientGroups
          options={options}
          request={request}
          onClose={() => setGroups(false)}
          onSaved={async () =>
            setOptions((await request("/options")) as ResearchOptions)
          }
        />
      )}
    </section>
  );
}
/** A functional research icon uses the repository icon library instead of decorative artwork. */
function FileEmpty() {
  return <Bell size={28} aria-hidden="true" />;
}
/** Maintain named recipient cohorts with optimistic versions and tenant-scoped client selection. */
function ClientGroups({
  options,
  request,
  onClose,
  onSaved,
}: {
  options: ResearchOptions;
  request: (path: string, body: unknown) => Promise<unknown>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { locale } = useLanguage(),
    hi = locale === "hi";
  const [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [members, setMembers] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
    panelRef.current?.scrollIntoView?.({ block: "start" });
  }, []);
  return (
    <section
      className="research-group-panel"
      ref={panelRef}
      tabIndex={-1}
      aria-label={hi ? "क्लाइंट समूह" : "Client group management"}
    >
      <header>
        <h2>{hi ? "क्लाइंट समूह" : "Client groups"}</h2>
        <button onClick={onClose}>{hi ? "बंद करें" : "Close groups"}</button>
      </header>
      <p>
        {hi
          ? "समूह केवल प्राप्तकर्ता चुनते हैं; वे योजना की पहुँच नहीं बदलते।"
          : "Groups select recipients; they do not grant subscription access."}
      </p>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const old = options.groups.find((g) => g.id === selected);
            await request("/groups", {
              id: old?.id ?? crypto.randomUUID(),
              version: old?.version ?? 0,
              name,
              membershipIds: members,
            });
            await onSaved();
            setMessage(hi ? "समूह सुरक्षित है।" : "Group saved.");
            setSelected("");
            setName("");
            setMembers([]);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            {hi ? "समूह" : "Group"}
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                const g = options.groups.find((g) => g.id === e.target.value);
                setName(g?.name ?? "");
                setMembers(g?.membershipIds ?? []);
              }}
            >
              <option value="">{hi ? "नया समूह" : "New group"}</option>
              {options.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {hi ? "समूह का नाम" : "Group name"}
            <input
              required
              minLength={2}
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="research-choice-list">
            {options.clients.map((c) => (
              <label key={c.id} className="research-check">
                <input
                  type="checkbox"
                  checked={members.includes(c.id)}
                  onChange={(e) =>
                    setMembers(
                      e.target.checked
                        ? [...members, c.id]
                        : members.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
          {!options.clients.length && (
            <p>
              {hi
                ? "कोई सक्रिय सब्सक्राइबर नहीं है।"
                : "No active subscribers yet."}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <button type="submit">
            {hi ? "समूह सुरक्षित करें" : "Save group"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
