import type { ResearchSnapshot } from "@ra/contracts";
import { useLanguage } from "../i18n";
/** Render the exact published snapshot or preview, with explicit manual price basis and immutable issuer details. */
export function ResearchReport({
  report,
  attachmentBase,
}: {
  report: ResearchSnapshot;
  attachmentBase?: string;
}) {
  const { locale } = useLanguage();
  const hi = locale === "hi";
  /** Format manually supplied prices consistently in the investor report. */
  const money = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(n);
  return (
    <article className="research-report">
      <header>
        <div>
          <p className="research-eyebrow">
            {report.offering} · {hi ? "संस्करण" : "Version"} {report.version}
          </p>
          <h2>{report.title}</h2>
          <p>
            {report.issuer.name} · SEBI {report.issuer.registration}
          </p>
        </div>
        <span className={`research-state ${report.status}`}>
          {report.status}
        </span>
      </header>
      <p className="research-muted">
        {hi ? "लेखक" : "By"} {report.issuer.author} ·{" "}
        {new Date(report.publishedAt).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        })}{" "}
        IST
      </p>
      <div className="research-report-legs">
        {report.legs.map((leg, n) => {
          const i = report.instruments[n];
          return (
            <section className="research-leg-summary" key={leg.instrumentKey}>
              <h3>
                {n + 1}. {i?.symbol ?? leg.instrumentKey}{" "}
                <span>{leg.side.toUpperCase()}</span>
              </h3>
              <p>
                {i?.exchange} · {i?.type} · {leg.horizon} · {leg.quantity}{" "}
                {hi ? "यूनिट" : "units"}
                {i?.expiry ? ` · Expiry ${i.expiry}` : ""}
                {i?.strike ? ` · Strike ${money(i.strike)}` : ""}
              </p>
              <dl className="research-prices">
                <div>
                  <dt>{hi ? "एंट्री" : "Entry range"}</dt>
                  <dd>
                    {money(leg.entryMin)} – {money(leg.entryMax)}
                  </dd>
                </div>
                <div>
                  <dt>{hi ? "स्टॉप लॉस" : "Stop-loss"}</dt>
                  <dd>{money(leg.stopLoss)}</dd>
                </div>
                <div>
                  <dt>{hi ? "लक्ष्य" : "Targets"}</dt>
                  <dd>{leg.targets.map(money).join(" / ")}</dd>
                </div>
              </dl>
              <p className="research-copy">{leg.rationale}</p>
              {leg.note && (
                <p className="research-copy research-muted">{leg.note}</p>
              )}
            </section>
          );
        })}
      </div>
      <h3>{hi ? "रिसर्च का आधार" : "Research rationale"}</h3>
      <p className="research-copy">{report.rationale}</p>
      <h3>{hi ? "प्रकटीकरण" : "Disclosures & conflicts"}</h3>
      <p className="research-copy">{report.disclosures}</p>
      <p className="research-copy">
        <strong>{hi ? "AI का उपयोग" : "AI use"}: </strong>
        {report.aiDisclosure}
      </p>
      <p>
        {hi ? "वैधता" : "Valid until"}:{" "}
        {new Date(report.validUntil).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        })}{" "}
        IST
      </p>
      {report.reason && (
        <p className="research-update">
          <strong>{hi ? "अपडेट का कारण" : "Update reason"}: </strong>
          {report.reason}
        </p>
      )}
      {!!report.attachments.length && (
        <section>
          <h3>{hi ? "सहायक दस्तावेज" : "Supporting documents"}</h3>
          <ul>
            {report.attachments.map((f) => (
              <li key={f.id}>
                {attachmentBase ? (
                  <a href={`${attachmentBase}/${f.id}`}>{f.name}</a>
                ) : (
                  f.name
                )}{" "}
                <small>({Math.ceil(f.bytes / 1024)} KB)</small>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="research-disclaimer">
        {hi
          ? "कीमतें और स्थिति RA द्वारा दर्ज हैं। लाइव बाजार मूल्य या परिणाम स्वतः सत्यापित नहीं होते। निवेश में जोखिम है; रिटर्न की गारंटी नहीं है।"
          : "Prices and status are entered by the RA. Live market prices and outcomes are not automatically verified. Investments involve risk; returns are not guaranteed."}
      </p>
    </article>
  );
}
