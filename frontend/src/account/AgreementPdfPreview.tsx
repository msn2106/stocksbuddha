import type { SignatureMark, SignatureBox } from "@ra/contracts";
import { SignatureAppearance } from "./SignatureInput";
type PreviewSignature = {
  mark: SignatureMark;
  name: string;
  box: SignatureBox;
};
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

type Library = Pick<
  typeof import("pdfjs-dist"),
  "getDocument" | "GlobalWorkerOptions"
>;
type PdfLoader = (url: string) => Promise<PDFDocumentProxy>;

/** Load the browser PDF renderer and its same-origin Vite-built worker only after mounting. */
export async function pdfRuntime(
  library: () => Promise<Library> = () => import("pdfjs-dist"),
  worker: () => Promise<{ default: string }> = () =>
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
) {
  const [pdf, asset] = await Promise.all([library(), worker()]);
  pdf.GlobalWorkerOptions.workerSrc = asset.default;
  return pdf;
}

/** Fetch only the authenticated frozen agreement; no document scripting interface is exposed. */
export async function loadAgreementPdf(
  url: string,
  runtime = pdfRuntime,
): Promise<PDFDocumentProxy> {
  if (typeof window.Worker === "undefined")
    throw new Error("PDF rendering unavailable");
  const pdf = await runtime();
  return pdf.getDocument({ url, withCredentials: true, stopAtErrors: true })
    .promise;
}

/** Paint a page at the current zoom, cancel obsolete renders and keep canvas memory bounded on resize. */
function AgreementPage({
  pdf,
  number,
  width,
  hi,
  signature,
}: {
  signature?: PreviewSignature;
  pdf: PDFDocumentProxy;
  number: number;
  width: number;
  hi: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false,
      render: RenderTask | undefined;
    setReady(false);
    setError(false);
    /** Draw the frozen document; the adjacent text-version control supplies the accessible full text. */
    async function draw() {
      try {
        const page: PDFPageProxy = await pdf.getPage(number);
        if (stopped) return;
        const target = canvas.current!,
          context = target.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        const viewport = page.getViewport({
          scale: width / page.getViewport({ scale: 1 }).width,
        });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          1800 / viewport.width,
        );
        target.width = Math.floor(viewport.width * ratio);
        target.height = Math.floor(viewport.height * ratio);
        target.style.width = `${Math.floor(viewport.width)}px`;
        target.style.height = `${Math.floor(viewport.height)}px`;
        render = page.render({
          canvas: target,
          canvasContext: context,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        if (!stopped) setReady(true);
      } catch {
        if (!stopped) setError(true);
      }
    }
    void draw();
    return () => {
      stopped = true;
      render?.cancel();
    };
  }, [pdf, number, width]);
  return (
    <figure className="agreement-pdf-page">
      <figcaption>
        {hi
          ? `पृष्ठ ${number} / ${pdf.numPages}`
          : `Page ${number} of ${pdf.numPages}`}
      </figcaption>
      <div
        className="agreement-pdf-sheet"
        style={{ width, height: (width * 841.89) / 595.276 }}
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={
            hi
              ? `लेटरहेड पर अनुबंध पृष्ठ ${number}`
              : `Agreement on letterhead, page ${number}`
          }
          data-rendered={ready}
        />
        {ready && signature && (
          <div
            className="agreement-signature-overlay"
            style={{
              left: `${(signature.box.x / 595.276) * 100}%`,
              top: `${(signature.box.y / 841.89) * 100}%`,
              width: `${(signature.box.width / 595.276) * 100}%`,
              height: `${(signature.box.height / 841.89) * 100}%`,
            }}
          >
            <SignatureAppearance mark={signature.mark} name={signature.name} />
          </div>
        )}
      </div>
      {error && (
        <p>
          {hi
            ? "यह पृष्ठ नहीं खुल सका। नीचे PDF लिंक या पाठ संस्करण का उपयोग करें।"
            : "This page could not display. Use the PDF link or text version below."}
        </p>
      )}
    </figure>
  );
}

/** Display frozen letterhead pages with navigation and zoom, independently of browser PDF plugins. */
export function AgreementPdfPreview({
  url,
  hi = false,
  load = loadAgreementPdf,
  signature,
}: {
  signature?: PreviewSignature;
  url: string;
  hi?: boolean;
  load?: PdfLoader;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(100),
    [width, setWidth] = useState(600),
    [attempt, setAttempt] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  useEffect(() => {
    let stopped = false,
      document: PDFDocumentProxy | undefined;
    setPdf(null);
    setFailed(false);
    load(url)
      .then((value) => {
        document = value;
        if (stopped) void value.loadingTask.destroy();
        else {
          setPageNumber(1);
          setPdf(value);
        }
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
      if (document) void document.loadingTask.destroy();
    };
  }, [url, load, attempt]);
  useEffect(() => {
    /** Fit pages to the available reading area while keeping zoomed overflow inside the viewer. */
    const resize = () =>
      setWidth(Math.max(280, (container.current?.clientWidth || 624) - 24));
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="onboarding-agreement-preview"
      ref={container}
      aria-busy={!pdf && !failed}
    >
      <div className="agreement-pdf-toolbar">
        <button
          type="button"
          disabled={!pdf || pageNumber <= 1}
          onClick={() => setPageNumber(pageNumber - 1)}
          aria-label={hi ? "पिछला पृष्ठ" : "Previous page"}
        >
          ‹
        </button>
        <button
          type="button"
          disabled={!pdf || pageNumber >= pdf.numPages}
          onClick={() => setPageNumber(pageNumber + 1)}
          aria-label={hi ? "अगला पृष्ठ" : "Next page"}
        >
          ›
        </button>
        <button
          type="button"
          disabled={!pdf || zoom <= 50}
          onClick={() => setZoom(zoom - 25)}
          aria-label={hi ? "छोटा करें" : "Zoom out"}
        >
          −
        </button>
        <span>{zoom}%</span>
        <button
          type="button"
          disabled={!pdf || zoom >= 200}
          onClick={() => setZoom(zoom + 25)}
          aria-label={hi ? "बड़ा करें" : "Zoom in"}
        >
          +
        </button>
      </div>
      {!pdf && !failed && (
        <p aria-live="polite">
          {hi
            ? "लेटरहेड पर अनुबंध खुल रहा है…"
            : "Loading agreement on letterhead…"}
        </p>
      )}
      {failed && (
        <p>
          {hi
            ? "पूर्वावलोकन नहीं खुल सका। PDF लिंक या पाठ संस्करण का उपयोग करें।"
            : "The preview could not load. Use the PDF link or text version below."}{" "}
          <button type="button" onClick={() => setAttempt(attempt + 1)}>
            {hi ? "पुनः प्रयास करें" : "Retry preview"}
          </button>
        </p>
      )}
      <div
        className="agreement-pdf-pages"
        role="region"
        aria-label={hi ? "अनुबंध और MITC के पृष्ठ" : "Agreement and MITC pages"}
        tabIndex={0}
      >
        {pdf && (
          <AgreementPage
            key={pageNumber}
            pdf={pdf}
            signature={signature}
            number={pageNumber}
            width={(width * zoom) / 100}
            hi={hi}
          />
        )}
      </div>
    </div>
  );
}
