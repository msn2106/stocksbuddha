import { useEffect, useState, type FormEvent } from "react";
import type { PageData } from "@ra/contracts";
import { useLanguage } from "../i18n";

type Document = {
  id: string;
  kind: string;
  customerId: string | null;
  name: string;
  bytes: number;
  createdAt: string;
};
const labels: Record<string, [string, string]> = {
  kyc: ["KYC document", "केवाईसी दस्तावेज़"],
  mitc: ["Signed MITC", "हस्ताक्षरित MITC"],
  recommendation: ["Recommendation evidence", "अनुशंसा प्रमाण"],
  general: ["General document", "सामान्य दस्तावेज़"],
  contract: ["Owner / RA contract", "मालिक / आरए अनुबंध"],
  owner: ["Owner document", "मालिक दस्तावेज़"],
};
/** Use the existing workspace forms for private uploads, metadata listing and authenticated downloads. */
export function Documents({ data }: { data: PageData }) {
  const { locale } = useLanguage();
  const hi = locale === "hi";
  const platform = data.account?.area === "platform";
  const role = data.account?.role;
  const kinds = platform
    ? ["contract", "owner"]
    : role === "owner"
      ? ["general", "kyc", "mitc", "recommendation"]
      : role === "analyst"
        ? ["recommendation", "general"]
        : ["kyc", "mitc"];
  const api = platform
    ? "/api/documents"
    : `/api/workspaces/${data.tenant!.slug}/documents`;
  const [kind, setKind] = useState(kinds[0]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [configured, setConfigured] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const personal = ["kyc", "mitc", "recommendation"].includes(kind);
  /** Load metadata from the authenticated app endpoint, never a public Drive link. */
  async function load(before?: string) {
    const response = await fetch(
      `${api}${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    );
    if (!response.ok) throw new Error("load");
    const result = await response.json();
    setDocuments((previous) =>
      before ? [...previous, ...result.documents] : result.documents,
    );
    setConfigured(result.configured);
    setCursor(result.nextCursor);
  }
  useEffect(() => {
    let live = true;
    Promise.all([fetch(api), fetch(`${api}/customers`)])
      .then(async ([files, people]) => {
        if (!files.ok || !people.ok) throw new Error("load");
        const [result, roster] = await Promise.all([
          files.json(),
          people.json(),
        ]);
        if (live) {
          setDocuments(result.documents);
          setCursor(result.nextCursor);
          setConfigured(result.configured);
          setCustomers(roster.customers);
        }
      })
      .catch(() => {
        if (live)
          setMessage(
            hi
              ? "दस्तावेज़ लोड नहीं हो सके। फिर प्रयास करें।"
              : "Documents could not load. Please try again.",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, hi]);
  /** Send bounded file bytes with authenticated same-origin headers and retain the form after a failure. */
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get("file") as File;
    if (!file?.size || file.size > 10 * 1024 * 1024) {
      setMessage(
        hi
          ? "अधिकतम फ़ाइल आकार 10 MiB है।"
          : "Choose a nonempty file up to 10 MiB.",
      );
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(api, {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-Document-Name": encodeURIComponent(file.name),
          "X-Document-Kind": kind,
          "X-Customer-Id": String(fields.get("customerId") ?? ""),
        },
        body: file,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error);
      }
      await load();
      form.reset();
      setMessage(hi ? "दस्तावेज़ अपलोड हो गया।" : "Document uploaded.");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === "invalid_document"
          ? hi
            ? "मान्य PDF, JPEG या PNG फ़ाइल चुनें।"
            : "Choose a valid PDF, JPEG or PNG file with a matching extension."
          : hi
            ? "अपलोड पूरा नहीं हो सका। सूची जाँचें और फिर प्रयास करें।"
            : "Upload could not complete. Check the document list before trying again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-labelledby="documents-title">
      <h1 id="documents-title">{hi ? "दस्तावेज़" : "Documents"}</h1>
      {loading ? (
        <p role="status">{hi ? "लोड हो रहा है…" : "Loading…"}</p>
      ) : (
        <>
          {!configured && (
            <p className="workspace-notice" role="status">
              {hi
                ? "दस्तावेज़ स्टोरेज अभी उपलब्ध नहीं है।"
                : "Document storage is awaiting activation."}
            </p>
          )}
          <form className="workspace-form" onSubmit={upload}>
            <label>
              {hi ? "दस्तावेज़ का प्रकार" : "Document type"}
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                {kinds.map((value) => (
                  <option key={value} value={value}>
                    {labels[value][hi ? 1 : 0]}
                  </option>
                ))}
              </select>
            </label>
            {personal && role !== "subscriber" && (
              <label>
                {hi ? "ग्राहक" : "Customer"}
                <select name="customerId" required>
                  <option value="">
                    {hi ? "ग्राहक चुनें" : "Select a customer"}
                  </option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} ({customer.id})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {hi
                ? "फ़ाइल (PDF, JPEG, PNG; अधिकतम 10 MiB)"
                : "File (PDF, JPEG, PNG; up to 10 MiB)"}
              <input
                type="file"
                name="file"
                accept="application/pdf,image/jpeg,image/png"
                required
                disabled={!configured || pending}
              />
            </label>
            <button
              className="button primary"
              disabled={
                loading ||
                pending ||
                !configured ||
                (personal && role !== "subscriber" && !customers.length)
              }
            >
              {pending
                ? hi
                  ? "अपलोड हो रहा है…"
                  : "Uploading…"
                : hi
                  ? "दस्तावेज़ अपलोड करें"
                  : "Upload document"}
            </button>
          </form>
          <p>
            {hi
              ? "हर अपलोड एक नया दस्तावेज़ बनाता है। पुरानी फ़ाइलें सुरक्षित रहती हैं।"
              : "Each upload creates a new document. Existing files are retained."}
          </p>
          {documents.length ? (
            <div className="workspace-table">
              <table>
                <caption>{hi ? "आपके दस्तावेज़" : "Your documents"}</caption>
                <thead>
                  <tr>
                    <th>{hi ? "नाम" : "Name"}</th>
                    <th>{hi ? "प्रकार" : "Type"}</th>
                    <th>{hi ? "आकार" : "Size"}</th>
                    <th>{hi ? "डाउनलोड" : "Download"}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.id}>
                      <td>
                        {document.name}
                        {document.customerId && (
                          <small>{document.customerId}</small>
                        )}
                      </td>
                      <td>{labels[document.kind]?.[hi ? 1 : 0]}</td>
                      <td>{Math.ceil(document.bytes / 1024)} KiB</td>
                      <td>
                        <a href={`${api}/${document.id}/download`}>
                          {hi ? "डाउनलोड" : "Download"}
                          <span className="sr-only"> {document.name}</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{hi ? "अभी कोई दस्तावेज़ नहीं है।" : "No documents yet."}</p>
          )}
          {cursor && (
            <button
              className="button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await load(cursor);
                } catch {
                  setMessage(
                    hi ? "सूची लोड नहीं हो सकी।" : "Could not load documents.",
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              {hi ? "और दिखाएँ" : "Load more"}
            </button>
          )}
        </>
      )}
      {message && (
        <p role="status" className="workspace-notice">
          {message}
        </p>
      )}
    </section>
  );
}
