import { useEffect, useState } from "react";
import type {
  MarketInstrument,
  MarketView,
  ResearchCheck,
  ResearchOffering,
} from "@ra/contracts";
import { researchOfferings } from "@ra/contracts";
import { useLanguage } from "../i18n";

const guidance =
  "https://www.sebi.gov.in/sebi_data/attachdocs/oct-2026/1792127227860.pdf";
/** Render a persistent daily reminder without blocking access to unrelated workspace operations. */
export function MarketReminder({ slug }: { slug: string }) {
  const { locale } = useLanguage();
  const [due, setDue] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/workspaces/${encodeURIComponent(slug)}/market`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (active) setDue(!!v && !v.declarationCurrent);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [slug]);
  return due ? (
    <aside className="market-reminder">
      <strong>
        {locale === "hi"
          ? "आज की ट्रेडिंग घोषणा आवश्यक है"
          : "Your daily trading declaration is due"}
      </strong>
      <p>
        {locale === "hi"
          ? "अनुशंसा प्रकाशित करने से पहले अपने लेनदेन की पुष्टि करें।"
          : "Confirm all transactions since your last declaration before publishing research."}
      </p>
      <a href={`/ra/${slug}/workspace/market?lang=${locale}`}>
        {locale === "hi" ? "घोषणा खोलें" : "Open trading declaration"}
      </a>
    </aside>
  ) : null;
}
/** Search instruments without discarding the selected identity when search filters change. */
export function InstrumentPicker({
  base,
  onSelect,
  offering,
  selectedKey,
  onResolve,
}: {
  base: string;
  offering?: ResearchOffering;
  selectedKey?: string;
  onResolve?: (instrument: MarketInstrument) => void;
  onSelect: (i: MarketInstrument | null) => void;
}) {
  const { locale } = useLanguage(),
    hi = locale === "hi";
  const [q, setQ] = useState(""),
    [type, setType] = useState(
      offering === "equity"
        ? "EQ"
        : offering === "futures"
          ? "FUT"
          : offering === "options"
            ? "CE"
            : "",
    ),
    [expiry, setExpiry] = useState(""),
    [rows, setRows] = useState<MarketInstrument[]>([]),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState(selectedKey ?? "");
  const allowedTypes =
    offering === "equity"
      ? ["EQ"]
      : offering === "futures"
        ? ["FUT"]
        : offering === "options"
          ? ["CE", "PE"]
          : ["EQ", "FUT", "CE", "PE"];
  const value = selectedKey ?? selected;
  const [resolved, setResolved] = useState<MarketInstrument | null>(null);
  const [resolveError, setResolveError] = useState(false);
  const [searched, setSearched] = useState(false);
  const current =
    resolved?.key === value ? resolved : rows.find((i) => i.key === value);
  useEffect(() => {
    if (!value || current) return;
    const controller = new AbortController();
    setResolveError(false);
    fetch(`${base}/instruments/${encodeURIComponent(value)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(({ instrument }) => {
        if (!controller.signal.aborted && instrument?.key === value) {
          setResolved(instrument);
          onResolve?.(instrument);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolveError(true);
      });
    return () => controller.abort();
  }, [base, value, current, onResolve]);
  const selectedLabel = current
    ? `${current.exchange} · ${current.symbol} · ${current.type}`
    : value;

  const matches = rows.filter(
    (i) => allowedTypes.includes(i.type) && (!type || i.type === type),
  );
  const contractExpiry = ["FUT", "CE", "PE"].includes(type) ? expiry : "";
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (q.trim().length < 2) {
        setRows([]);
        setLoading(false);
        setSearched(false);
        return;
      }
      setLoading(true);
      setSearched(false);
      setError(false);
      fetch(
        `${base}/instruments?${new URLSearchParams({ q, type, expiry: contractExpiry })}`,
        {
          signal: controller.signal,
        },
      )
        .then(async (r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((v) => {
          if (!controller.signal.aborted) {
            setRows(v.instruments);
            setSearched(true);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [base, q, type, contractExpiry]);
  return (
    <fieldset className="market-picker">
      <legend>{hi ? "इंस्ट्रूमेंट चुनें" : "Select instrument"}</legend>
      {value && (
        <p className="research-selected">
          {hi ? "चुना गया इंस्ट्रूमेंट" : "Selected instrument"}:{" "}
          <strong>{selectedLabel}</strong>
          {current && (
            <span>
              {" "}
              {current.expiry ? ` · Expiry ${current.expiry}` : ""}
              {current.strike !== null ? ` · Strike ₹${current.strike}` : ""}
              {current.type !== "EQ" ? ` · Lot size ${current.lotSize}` : ""}
            </span>
          )}
        </p>
      )}
      {resolveError && (
        <p role="alert">
          {hi
            ? "इंस्ट्रूमेंट विवरण उपलब्ध नहीं है; चयन सुरक्षित है।"
            : "Instrument details are unavailable; your selection is preserved. Reopen the draft or search again."}
        </p>
      )}
      <div className="market-grid">
        <label>
          {hi ? "नाम / सिंबल" : "Name / symbol"}
          <input
            value={q}
            placeholder="RELIANCE, NIFTY…"
            onChange={(e) => {
              setQ(e.target.value);
              setRows([]);
              setSearched(false);
            }}
          />
        </label>
        <label>
          {hi ? "प्रकार" : "Type"}
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setExpiry("");
              setRows([]);
              setSearched(false);
            }}
          >
            {allowedTypes.length === 4 && (
              <option value="">{hi ? "सभी" : "All"}</option>
            )}
            {allowedTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {["FUT", "CE", "PE"].includes(type) && (
          <label>
            {hi
              ? "कॉन्ट्रैक्ट एक्सपायरी (वैकल्पिक)"
              : "Contract expiry (optional)"}
            <input
              type="date"
              value={contractExpiry}
              onChange={(e) => {
                setExpiry(e.target.value);
                setRows([]);
                setSearched(false);
              }}
            />
          </label>
        )}
      </div>
      <label>
        {hi ? "मिलते हुए इंस्ट्रूमेंट" : "Matching instruments"}
        <select
          value={value}
          onChange={(e) => {
            setSelected(e.target.value);
            const instrument = matches.find((i) => i.key === e.target.value);
            if (instrument) {
              setResolved(instrument);
              onResolve?.(instrument);
            }
            if (instrument || !e.target.value) onSelect(instrument ?? null);
          }}
        >
          <option value="">
            {loading
              ? "Loading…"
              : hi
                ? "इंस्ट्रूमेंट चुनें"
                : "Choose an instrument"}
          </option>
          {value && !matches.some((i) => i.key === value) && (
            <option value={value}>
              {selectedLabel} · {hi ? "पहले चुना गया" : "Previously selected"}
            </option>
          )}
          {matches.map((i) => (
            <option key={i.key} value={i.key}>
              {i.exchange} · {i.symbol} · {i.type}
            </option>
          ))}
        </select>
      </label>
      {searched && !loading && !error && matches.length === 0 && (
        <p role="status">
          {hi
            ? "इन फ़िल्टर से कोई इंस्ट्रूमेंट नहीं मिला।"
            : "No instruments match these filters."}
        </p>
      )}
      {value &&
        searched &&
        !loading &&
        !matches.some((i) => i.key === value) && (
          <p>
            {hi
              ? "आपका पिछला चयन नहीं बदला है। नया इंस्ट्रूमेंट चुनने पर ही बदलेगा।"
              : "Your previous selection is unchanged and is outside these search results. Choose a replacement to change it."}
          </p>
        )}
      <small>
        {hi
          ? "कम से कम 2 अक्षर लिखें। अधिकतम 50 परिणाम।"
          : "Enter at least 2 characters. Up to 50 matches; narrow your search if needed."}
      </small>
      {error && (
        <p role="alert">
          {hi
            ? "खोज उपलब्ध नहीं है। फिर प्रयास करें।"
            : "Search unavailable. Try again."}
        </p>
      )}
    </fieldset>
  );
}
/** Market setup uses the organisation's existing workspace visual language and private API. */
export function MarketSetup({ slug }: { slug: string }) {
  const { locale } = useLanguage(),
    hi = locale === "hi",
    base = `/api/workspaces/${encodeURIComponent(slug)}/market`;
  const [view, setView] = useState<MarketView | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("declarations"),
    [instrument, setInstrument] = useState<MarketInstrument | null>(null),
    [mode, setMode] = useState("trade"),
    [check, setCheck] = useState<ResearchCheck | null>(null),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    fetch(base, { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setView)
      .catch(() => {
        if (!c.signal.aborted)
          setError(
            hi
              ? "मार्केट सेटअप उपलब्ध नहीं है।"
              : "Market Setup is unavailable. Please retry.",
          );
      });
    return () => c.abort();
  }, [base, hi, reload]);
  /** Save against the displayed version and preserve actionable conflicts without discarding entered form values. */
  async function mutate(payload: Record<string, unknown>) {
    if (!view) return;
    setBusy(true);
    setError("");
    setMessage("");
    setCheck(null);
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, version: view.version }),
      });
      const result = await r.json();
      if (!r.ok) {
        throw new Error(
          result.error === "market_version_conflict"
            ? "This page changed in another session. Reload before saving."
            : `Unable to save: ${result.error}`,
        );
      }
      setView(result.view);
      setMessage(
        result.warnings?.length
          ? "Saved. A potential trading conflict was recorded. Review Recommendations & restrictions."
          : hi
            ? "सुरक्षित किया गया।"
            : "Saved successfully.",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  /** Request the server restriction decision for the selected contract without publishing research. */
  async function preview() {
    if (!instrument) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${base}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [instrument.key] }),
      });
      if (!r.ok) throw new Error("Unable to check restrictions");
      setCheck(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title = hi ? "मार्केट सेटअप" : "Market Setup";
  if (!view)
    return (
      <section>
        <h1>{title}</h1>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p role="status">{hi ? "लोड हो रहा है…" : "Loading market setup…"}</p>
        )}
        <button
          onClick={() => {
            setError("");
            setReload((v) => v + 1);
          }}
        >
          {hi ? "फिर प्रयास करें" : "Retry"}
        </button>
      </section>
    );
  return (
    <section className="market-setup">
      <header className="market-heading">
        <div>
          <p className="market-kicker">
            {hi ? "रिसर्च की तैयारी" : "Research readiness"}
          </p>
          <h1>{title}</h1>
          <p>
            {hi
              ? "इंस्ट्रूमेंट, व्यक्तिगत घोषणाएँ और रिसर्च पहुँच एक जगह।"
              : "Instrument reference data, personal declarations and research access in one place."}
          </p>
        </div>
        <span
          className={`market-status ${view.declarationCurrent ? "current" : "due"}`}
        >
          {view.declarationCurrent
            ? hi
              ? "आज की घोषणा पूर्ण"
              : "Declared today"
            : hi
              ? "घोषणा बाकी"
              : "Declaration due"}
        </span>
      </header>
      <nav className="market-tabs" aria-label={title}>
        {[
          ["declarations", hi ? "व्यक्तिगत घोषणाएँ" : "Personal declarations"],
          [
            "restrictions",
            hi ? "अनुशंसाएँ और प्रतिबंध" : "Recommendations & restrictions",
          ],
          ["data", hi ? "डेटा और योजनाएँ" : "Data & plan access"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              setTab(id);
              setInstrument(null);
              setCheck(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div role="alert" className="account-error">
          {error}
          <button
            onClick={() => {
              setError("");
              setReload((v) => v + 1);
            }}
          >
            Reload
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="workspace-notice">
          {message}
        </p>
      )}
      <aside className="market-rules">
        <h2>
          {hi ? "व्यक्तिगत ट्रेडिंग नियम" : "Personal trading restrictions"}
        </h2>
        <div className="market-periods">
          <strong>
            30{" "}
            <span>
              {hi ? "दिन प्रकाशन से पहले" : "days before publication"}
            </span>
          </strong>
          <strong>
            5{" "}
            <span>{hi ? "दिन प्रकाशन के बाद" : "days after publication"}</span>
          </strong>
        </div>
        <p>
          {hi
            ? "कवर किए गए विश्लेषकों और सहयोगियों के खरीद व बिक्री लेनदेन इन प्रतिबंधों के अधीन हैं। जारी अनुशंसा के विपरीत ट्रेडिंग अलग से प्रतिबंधित है।"
            : "Covered analysts and associates must observe the dealing/trading restrictions, including both purchases and sales. Trading contrary to an outstanding recommendation is separately restricted."}
        </p>
        <p>
          {hi
            ? "जाँच आपकी घोषणा पर आधारित है; ब्रोकर लेनदेन स्वतंत्र रूप से सत्यापित नहीं होते।"
            : "Checks rely on your declarations. Broker transactions are not independently verified. This screen cannot prevent external trades."}
        </p>
        <a href={guidance} target="_blank" rel="noreferrer">
          {hi ? "सेबी विनियम 16 पढ़ें" : "Read SEBI Regulation 16"}
        </a>
      </aside>
      {tab === "declarations" && (
        <>
          <section className="market-panel">
            <h2>{hi ? "आज की पुष्टि" : "Today's confirmation"}</h2>
            <p>
              {hi
                ? "इस अवधि के सभी कवर किए गए व्यक्तियों और खातों के लेनदेन दर्ज करें:"
                : "Record all transactions for covered persons and accounts for this period:"}{" "}
              <strong>
                {view.requiredFrom} — {view.today}
              </strong>{" "}
              (IST).
            </p>
            <p>
              {hi
                ? "पहली घोषणा से पहले वर्तमान होल्डिंग भी दर्ज करें।"
                : "Before your first declaration, also enter current holdings. Report transactions from every broker, including trades outside StocksBuddha."}
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await mutate({
                  action: "declare",
                  coveredFrom: view.requiredFrom,
                  confirmed: f.get("confirmed") === "on",
                });
              }}
            >
              <label className="market-checkbox">
                <input
                  type="checkbox"
                  name="confirmed"
                  required
                  disabled={busy}
                />
                {hi
                  ? "मैं पुष्टि करता/करती हूँ कि सभी लेनदेन और होल्डिंग दर्ज हैं, या कोई नया लेनदेन नहीं हुआ है।"
                  : "I confirm all transactions and holdings are recorded, or there have been no new transactions, for the period above."}
              </label>
              <button disabled={busy} className="button primary">
                {hi
                  ? "आज की घोषणा सुरक्षित करें"
                  : "Confirm today's declaration"}
              </button>
            </form>
          </section>
          <section className="market-panel">
            <h2>
              {hi
                ? "लेनदेन या होल्डिंग दर्ज करें"
                : "Record a transaction or holding"}
            </h2>
            <label>
              {hi ? "रिकॉर्ड प्रकार" : "Record type"}
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="trade">{hi ? "लेनदेन" : "Transaction"}</option>
                <option value="holding">
                  {hi ? "वर्तमान होल्डिंग" : "Current holding"}
                </option>
              </select>
            </label>
            <InstrumentPicker base={base} onSelect={setInstrument} />
            <form
              className="workspace-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!instrument) return;
                const form = e.currentTarget,
                  f = new FormData(form);
                const value = {
                  instrumentKey: instrument.key,
                  person: f.get("person"),
                  account: f.get("account"),
                  quantity: Number(f.get("quantity")),
                  ...(mode === "trade"
                    ? {
                        date: f.get("date"),
                        side: f.get("side"),
                        note: f.get("note"),
                      }
                    : {}),
                };
                if (await mutate({ action: mode, value })) {
                  form.reset();
                }
              }}
            >
              <div className="market-grid">
                <label>
                  {hi ? "व्यक्ति का नाम" : "Covered person"}
                  <input name="person" required maxLength={160} />
                </label>
                <label>
                  {hi ? "खाते का लेबल" : "Account label"}
                  <input
                    name="account"
                    required
                    maxLength={160}
                    placeholder={
                      hi ? "जैसे व्यक्तिगत खाता" : "e.g. Personal account"
                    }
                  />
                </label>
                <label>
                  {hi ? "मात्रा (यूनिट)" : "Quantity (units)"}
                  <input
                    name="quantity"
                    required
                    type="number"
                    min="0.000001"
                    step="any"
                    max="1000000000000"
                  />
                </label>
                {mode === "trade" && (
                  <>
                    <label>
                      {hi ? "ट्रेड तारीख" : "Trade date (IST)"}
                      <input
                        name="date"
                        type="date"
                        min="2000-01-01"
                        max={view.today}
                        defaultValue={view.today}
                        required
                      />
                    </label>
                    <label>
                      {hi ? "दिशा" : "Side"}
                      <select name="side">
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                      </select>
                    </label>
                    <label>
                      {hi ? "नोट" : "Note"}
                      <input name="note" maxLength={1000} />
                    </label>
                  </>
                )}
              </div>
              <button className="button primary" disabled={busy || !instrument}>
                {hi ? "रिकॉर्ड जोड़ें" : "Add record"}
              </button>
              <small>
                {hi
                  ? "नया रिकॉर्ड जोड़ने के बाद फिर घोषणा करें।"
                  : "Adding or correcting a record requires a new declaration."}
              </small>
            </form>
          </section>
          <section className="market-panel">
            <h2>{hi ? "घोषित रिकॉर्ड" : "Declared records"}</h2>
            {![...view.trades, ...view.holdings].length && (
              <p>{hi ? "अभी कोई रिकॉर्ड नहीं है।" : "No records yet."}</p>
            )}
            {[...view.trades, ...view.holdings]
              .slice()
              .reverse()
              .map((r) => (
                <article className="market-row" key={r.id}>
                  <div>
                    <strong>{r.instrument.symbol}</strong>
                    <p>
                      {r.person} · {r.account} ·{" "}
                      {"date" in r && "side" in r
                        ? `${r.side} · ${r.date}`
                        : "Holding"}{" "}
                      · {r.quantity} units
                    </p>
                    {r.voidReason && <p>Corrected: {r.voidReason}</p>}
                  </div>
                  {!r.voidReason && (
                    <Correction
                      busy={busy}
                      onSave={(reason) =>
                        mutate({ action: "correct", id: r.id, reason })
                      }
                    />
                  )}
                </article>
              ))}
          </section>
        </>
      )}
      {tab === "restrictions" && (
        <>
          <section className="market-panel">
            <h2>{hi ? "प्रकाशन से पहले जाँच" : "Check before publication"}</h2>
            <InstrumentPicker
              base={base}
              onSelect={(i) => {
                setInstrument(i);
                setCheck(null);
              }}
            />
            <button disabled={!instrument || busy} onClick={preview}>
              {hi ? "प्रतिबंध जाँचें" : "Check restrictions"}
            </button>
            {check && (
              <div role="status">
                <strong>
                  {check.allowed
                    ? "No declared lookback conflict. Reconfirmation is required at publication."
                    : "Publication is blocked."}
                </strong>
                {check.reasons.map((r) => (
                  <p key={r}>{r.replaceAll("_", " ")}</p>
                ))}
                {check.conflicts.map((c) => (
                  <p key={c.id}>
                    {c.symbol} · Trade: {c.date} · Earliest publication:{" "}
                    {c.until}
                  </p>
                ))}
              </div>
            )}
          </section>
          <section className="market-panel">
            <h2>
              {hi
                ? "बाहरी अनुशंसा दर्ज करें"
                : "Record an external recommendation"}
            </h2>
            <p>
              {hi
                ? "अन्य चैनल पर पहले से भेजी गई अनुशंसा दर्ज करें। इससे कोई संदेश नहीं भेजा जाएगा।"
                : "Record research already issued through another channel. This records history; it does not publish or send a notification."}
            </p>
            <form
              className="workspace-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!instrument) return;
                const form = e.currentTarget,
                  f = new FormData(form);
                if (
                  await mutate({
                    action: "external",
                    value: {
                      instrumentKey: instrument.key,
                      publishedOn: f.get("publishedOn"),
                      direction: f.get("direction"),
                      audience: f.get("audience"),
                      rationale: f.get("rationale"),
                    },
                  })
                )
                  form.reset();
              }}
            >
              <p>
                {instrument
                  ? `Selected: ${instrument.symbol}`
                  : "Select an instrument above."}
              </p>
              <div className="market-grid">
                <label>
                  Publication date (IST)
                  <input
                    required
                    name="publishedOn"
                    type="date"
                    min="2000-01-01"
                    max={view.today}
                    defaultValue={view.today}
                  />
                </label>
                <label>
                  Direction
                  <select name="direction">
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                    <option value="hold">Hold</option>
                  </select>
                </label>
              </div>
              <label>
                Client / group / plan and channel
                <input name="audience" required maxLength={500} />
              </label>
              <label>
                Research rationale
                <textarea
                  name="rationale"
                  required
                  minLength={10}
                  maxLength={4000}
                />
              </label>
              <button disabled={busy || !instrument}>
                Record recommendation
              </button>
            </form>
          </section>
          <section className="market-panel">
            <h2>{hi ? "अनुशंसा रजिस्टर" : "Recommendation register"}</h2>
            {!view.recommendations.length && (
              <p>
                No recommendations recorded. Platform publications will appear
                here when the publishing workflow is introduced.
              </p>
            )}
            {view.recommendations
              .slice()
              .reverse()
              .map((r) => (
                <article className="market-row" key={r.id}>
                  <div>
                    <strong>
                      {r.instrument.symbol} · {r.direction}
                    </strong>
                    <p>
                      {r.audience} · Published {r.publishedOn}
                    </p>
                    <p>
                      Post-publication restriction through{" "}
                      {new Date(Date.parse(r.publishedOn) + 5 * 86400000)
                        .toISOString()
                        .slice(0, 10)}{" "}
                      (IST)
                    </p>
                    <p>
                      {r.closedOn
                        ? `Closed ${r.closedOn}: ${r.closeReason}`
                        : "Outstanding recommendation — contrary-trading restriction remains."}
                    </p>
                    {view.trades
                      .filter(
                        (t) =>
                          !t.voidReason &&
                          t.instrument.underlying === r.instrument.underlying &&
                          ((t.date >=
                            new Date(Date.parse(r.publishedOn) - 30 * 86400000)
                              .toISOString()
                              .slice(0, 10) &&
                            t.date <=
                              new Date(Date.parse(r.publishedOn) + 5 * 86400000)
                                .toISOString()
                                .slice(0, 10)) ||
                            (t.date >= r.publishedOn &&
                              (!r.closedOn || t.date <= r.closedOn) &&
                              (r.direction === "hold" ||
                                r.direction !== t.side))),
                      )
                      .map((t) => (
                        <p className="account-error" key={t.id}>
                          Potential breach: {t.side} on {t.date} · {t.person}
                        </p>
                      ))}
                  </div>
                  {r.sourceResearchId && (
                    <a
                      href={`/ra/${slug}/workspace/recommendations?lang=${locale}`}
                    >
                      Manage published recommendation
                    </a>
                  )}
                  {!r.closedOn && !r.sourceResearchId && (
                    <Correction
                      busy={busy}
                      label="Close recommendation"
                      onSave={(reason) =>
                        mutate({ action: "close", id: r.id, reason })
                      }
                    />
                  )}
                </article>
              ))}
          </section>
        </>
      )}
      {tab === "data" && (
        <>
          <section className="market-panel">
            <h2>{hi ? "इंस्ट्रूमेंट कैटलॉग" : "Instrument catalogue"}</h2>
            <p>
              Upstox public NSE / BSE instrument files · Reference data only
            </p>
            {view.catalogue ? (
              <dl className="market-facts">
                <dt>Available instruments</dt>
                <dd>{view.catalogue.count.toLocaleString()}</dd>
                <dt>Provider last modified</dt>
                <dd>{view.catalogue.sourceModified ?? "Unknown"}</dd>
                <dt>Last successful import</dt>
                <dd>
                  {new Date(view.catalogue.importedAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  IST
                </dd>
                <dt>Status</dt>
                <dd>
                  {view.catalogue.stale
                    ? "Stale / unverified provider date — publication checks blocked"
                    : "Available"}
                </dd>
              </dl>
            ) : (
              <p>
                No catalogue imported. Ask the platform administrator to import
                the instrument files.
              </p>
            )}
            <p>
              No broker account or API token is required for this reference
              catalogue. Live prices, order placement and broker connections are
              not enabled.
            </p>
            <InstrumentPicker base={base} onSelect={setInstrument} />
            {instrument && (
              <dl className="market-facts">
                {Object.entries({
                  Symbol: instrument.symbol,
                  Exchange: instrument.exchange,
                  Type: instrument.type,
                  Expiry: instrument.expiry ?? "—",
                  Strike: instrument.strike ?? "—",
                  "Lot size": instrument.lotSize,
                  "Tick size (INR)": instrument.tickSize,
                }).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className="market-panel">
            <h2>{hi ? "योजना की रिसर्च पहुँच" : "Plan research access"}</h2>
            <p>
              Changes apply to future checkouts. Existing subscriptions retain
              their original grants; older subscriptions without explicit grants
              remain ineligible for the new research module.
            </p>
            {!view.plans.length && (
              <p>Create a plan first in Plans and discounts.</p>
            )}
            {view.plans.map((p) => (
              <form
                className="market-plan"
                key={`${p.id}-${view.version}`}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  await mutate({
                    action: "plan",
                    planId: p.id,
                    offerings: f.getAll("offering") as ResearchOffering[],
                  });
                }}
              >
                <h3>{p.name}</h3>
                <div className="market-offerings">
                  {researchOfferings.map((o) => (
                    <label className="market-checkbox" key={o}>
                      <input
                        type="checkbox"
                        name="offering"
                        value={o}
                        defaultChecked={p.offerings.includes(o)}
                      />
                      {o}
                    </label>
                  ))}
                </div>
                <button disabled={busy}>Save access</button>
              </form>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
/** Inline reason capture keeps corrections deliberate and keyboard-accessible, without deleting evidence. */
function Correction({
  busy,
  label = "Correct record",
  onSave,
}: {
  busy: boolean;
  label?: string;
  onSave: (reason: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {!open ? (
        <button disabled={busy} onClick={() => setOpen(true)}>
          {label}
        </button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (await onSave(String(f.get("reason")))) setOpen(false);
          }}
        >
          <label>
            Reason (retained in audit history)
            <input name="reason" required minLength={10} maxLength={1000} />
          </label>
          <button disabled={busy}>{label}</button>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
