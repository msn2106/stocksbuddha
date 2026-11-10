import { useEffect, useState } from "react";
import type { LetterheadSettings as Settings } from "@ra/contracts";
import { useLanguage } from "../i18n";

/** Read only bounded PDFs; the server independently parses, sanitizes and verifies the page dimensions. */
export async function readLetterhead(file: File): Promise<string> {
  if (
    file.type !== "application/pdf" ||
    !file.size ||
    file.size > 2 * 1024 * 1024
  )
    throw new Error("Choose a PDF up to 2 MB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The PDF could not be read."));
    reader.readAsDataURL(file);
  });
}

/** Manage a tenant's stationery independently of agreement wording, with preview before saving and explicit default restoration. */
export function LetterheadSettings() {
  const { tenantPath, locale } = useLanguage();
  const hi = locale === "hi",
    stock = tenantPath === "/ra/stocksbuddha";
  const api = `/api/workspaces/${tenantPath.split("/").at(-1)}/onboarding`;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pending, setPending] = useState(false),
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [preview, setPreview] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${api}/letterhead`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Letterhead settings could not load.");
        setSettings(await response.json());
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Letterhead settings could not load. Try again.");
      });
    return () => controller.abort();
  }, [api, reload]);
  useEffect(() => {
    /** Warn before navigating away from unsaved artwork or an in-progress upload. */
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || pending) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, pending]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  /** Retain all local input on errors; only a successful save advances the version. */
  async function request(sample: boolean) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const { version, name, pdf, margins } = settings!;
      const response = await fetch(
        `${api}/${sample ? "letterhead-preview" : "letterhead"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version, name, pdf, margins }),
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "This letterhead changed in another session. Reload before saving; your local changes are still here."
            : "Use an unencrypted, one-page portrait A4 PDF up to 2 MB and valid margins.",
        );
      if (sample) setPreview(URL.createObjectURL(await response.blob()));
      else {
        setSettings(await response.json());
        setDirty(false);
        setMessage("Letterhead saved. New agreements will use this version.");
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The letterhead could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }
  /** Select local PDF bytes without changing the saved letterhead. */
  async function upload(file: File) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const pdf = await readLetterhead(file);
      setSettings((current) => ({
        ...current!,
        pdf,
        name: file.name.slice(0, 120),
        sha256: null,
      }));
      setDirty(true);
      setPreview("");
    } catch {
      setError(
        "Choose a PDF up to 2 MB. The previous letterhead is still available.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="letterhead-settings" aria-label="Letterhead">
      <h3>{hi ? "लेटरहेड" : "Letterhead"}</h3>
      <p>
        {hi
          ? "अपना एक-पृष्ठ A4 PDF अपलोड करें। बदलाव सहेजने से पहले नमूना देखें। पुराने अनुबंध नहीं बदलेंगे।"
          : "Upload your own one-page portrait A4 PDF, up to 2 MB. Preview the layout before saving. Existing agreements keep their original letterhead."}
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!settings ? (
        <button type="button" onClick={() => setReload(reload + 1)}>
          {hi ? "पुनः लोड करें" : "Reload letterhead settings"}
        </button>
      ) : (
        <fieldset disabled={pending}>
          <legend>
            {settings.pdf
              ? `Uploaded: ${settings.name}`
              : stock
                ? "Default: Stocks Buddha supplied letterhead"
                : "Default: standard RA stationery"}
          </legend>
          {stock && !settings.pdf && (
            <a
              href="/assets/brand/stocksbuddha-letterhead-v1.pdf"
              target="_blank"
              rel="noreferrer"
            >
              View Stocks Buddha default letterhead
            </a>
          )}
          <label>
            {hi ? "लेटरहेड PDF" : "Letterhead PDF"}
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
          <p>
            Set blank space around the printable area in millimetres. Your PDF
            header stays intact; generated identity, page numbers and
            disclosures use reserved space above your footer. Review every page
            in the preview.
          </p>
          <div className="onboarding-fields">
            {(["top", "bottom", "left", "right"] as const).map((key) => (
              <label key={key}>
                {`${key[0].toUpperCase()}${key.slice(1)} margin (mm)`}
                <input
                  type="number"
                  min={key === "left" || key === "right" ? 10 : 15}
                  max={key === "top" ? 100 : key === "bottom" ? 75 : 40}
                  value={settings.margins[key]}
                  disabled={!settings.pdf}
                  onChange={(event) => {
                    setSettings({
                      ...settings,
                      margins: {
                        ...settings.margins,
                        [key]: Number(event.target.value),
                      },
                    });
                    setDirty(true);
                    setPreview("");
                  }}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => void request(true)}
          >
            Preview letterhead agreement
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!dirty}
            onClick={() => void request(false)}
          >
            Save letterhead
          </button>
          <button
            type="button"
            onClick={() => {
              setSettings({
                ...settings,
                pdf: null,
                name: "",
                sha256: null,
                margins: { top: 56, bottom: 20, left: 21, right: 21 },
              });
              setDirty(true);
              setPreview("");
            }}
          >
            Remove uploaded letterhead / restore default
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                !dirty ||
                window.confirm("Discard unsaved letterhead changes?")
              ) {
                setDirty(false);
                setSettings(null);
                setReload(reload + 1);
              }
            }}
          >
            Reload saved letterhead
          </button>
        </fieldset>
      )}
      {pending && <p role="status">Processing letterhead…</p>}
      {preview && (
        <iframe
          title="Letterhead agreement preview"
          src={preview}
          style={{
            width: "100%",
            height: 600,
            border: "1px solid var(--border)",
          }}
        />
      )}
    </section>
  );
}
