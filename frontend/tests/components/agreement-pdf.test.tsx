import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  AgreementPdfPreview,
  loadAgreementPdf,
  pdfRuntime,
} from "../../src/account/AgreementPdfPreview";
const originalContext = window.HTMLCanvasElement.prototype.getContext;
const originalWorker = window.Worker;
afterEach(() => {
  cleanup();
  window.HTMLCanvasElement.prototype.getContext = originalContext;
  window.Worker = originalWorker;
});

/** Supply deterministic PDF pages while exercising the real renderer lifecycle and controls. */
function fixture() {
  const state = { destroyed: 0, cancelled: 0, fail: false };
  window.HTMLCanvasElement.prototype.getContext =
    (() => ({})) as unknown as typeof originalContext;
  const pdf = {
    numPages: 2,
    loadingTask: {
      destroy: async () => {
        state.destroyed++;
      },
    },
    getPage: async () => {
      if (state.fail) throw new Error("broken page");
      return {
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render: () => ({
          promise: Promise.resolve(),
          cancel: () => {
            state.cancelled++;
          },
        }),
      };
    },
  } as unknown as PDFDocumentProxy;
  return { state, pdf, load: async () => pdf };
}

test("PDF runtime uses its bundled worker and private authenticated document URL", async () => {
  const options = { workerSrc: "" };
  const calls: unknown[] = [];
  const f = fixture();
  const library = {
    GlobalWorkerOptions: options,
    getDocument: (value: unknown) => {
      calls.push(value);
      return { promise: Promise.resolve(f.pdf) };
    },
  } as unknown as Awaited<ReturnType<typeof pdfRuntime>>;
  assert.equal(
    await pdfRuntime(
      async () => library,
      async () => ({ default: "/assets/pdf-worker.mjs" }),
    ),
    library,
  );
  assert.equal(options.workerSrc, "/assets/pdf-worker.mjs");
  window.Worker = class {} as unknown as typeof Worker;
  assert.equal(
    await loadAgreementPdf("/private/agreement", async () => library),
    f.pdf,
  );
  assert.deepEqual(calls, [
    { url: "/private/agreement", withCredentials: true, stopAtErrors: true },
  ]);
  window.Worker = undefined as unknown as typeof Worker;
  await assert.rejects(loadAgreementPdf("/private/agreement"), /unavailable/);
});

test("reader renders pages, supports bounded zoom and navigation, and releases its document", async () => {
  const f = fixture();
  const view = render(<AgreementPdfPreview url="/agreement" load={f.load} />);
  await waitFor(() =>
    assert.equal(screen.getByRole("img").getAttribute("data-rendered"), "true"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Page 2 of 2");
  assert.equal(
    (screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement)
      .disabled,
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  for (let i = 0; i < 4; i++)
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  assert.ok(screen.getByText("200%"));
  for (let i = 0; i < 6; i++)
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  assert.ok(screen.getByText("50%"));
  view.unmount();
  assert.equal(f.state.destroyed, 1);
  assert.ok(f.state.cancelled > 0);
});

test("reader offers retry on download failures and handles page failures in both languages", async () => {
  for (const hi of [false, true]) {
    const f = fixture();
    let first = true;
    const load = async () => {
      if (first) {
        first = false;
        throw new Error("offline");
      }
      return f.pdf;
    };
    f.state.fail = true;
    render(<AgreementPdfPreview url="/agreement" hi={hi} load={load} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: hi ? "पुनः प्रयास करें" : "Retry preview",
      }),
    );
    await screen.findByText(
      hi ? /यह पृष्ठ नहीं खुल सका/ : /This page could not display/,
    );
    assert.ok(
      screen.getByRole("button", { name: hi ? "अगला पृष्ठ" : "Next page" }),
    );
    cleanup();
  }
});

test("unmounted downloads release late documents and canvas failures remain readable", async () => {
  const f = fixture();
  let resolve!: (pdf: PDFDocumentProxy) => void;
  const load = () =>
    new Promise<PDFDocumentProxy>((done) => {
      resolve = done;
    });
  const view = render(<AgreementPdfPreview url="/agreement" load={load} />);
  view.unmount();
  resolve(f.pdf);
  await waitFor(() => assert.equal(f.state.destroyed, 1));
  window.HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof originalContext;
  render(<AgreementPdfPreview url="/agreement" load={f.load} />);
  await screen.findByText(/This page could not display/);
});

test("reader resizes within its viewport and cancels work when closed mid-render", async () => {
  const f = fixture();
  let resize!: () => void,
    disconnected = false;
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  } as unknown as typeof ResizeObserver;
  try {
    const view = render(
      <AgreementPdfPreview hi url="/agreement" load={f.load} />,
    );
    await waitFor(() =>
      assert.equal(
        screen.getByRole("img").getAttribute("data-rendered"),
        "true",
      ),
    );
    const container = view.container.firstElementChild!;
    Object.defineProperty(container, "clientWidth", { value: 390 });
    const { act } = await import("@testing-library/react");
    await act(async () => {
      resize();
    });
    fireEvent.click(screen.getByRole("button", { name: "बड़ा करें" }));
    fireEvent.click(screen.getByRole("button", { name: "छोटा करें" }));
    fireEvent.click(screen.getByRole("button", { name: "अगला पृष्ठ" }));
    fireEvent.click(screen.getByRole("button", { name: "पिछला पृष्ठ" }));
    view.unmount();
    assert.equal(disconnected, true);
  } finally {
    globalThis.ResizeObserver = previous;
  }
  let resolve!: (
    page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>,
  ) => void;
  f.pdf.getPage = () =>
    new Promise((done) => {
      resolve = done;
    });
  const view = render(<AgreementPdfPreview url="/agreement" load={f.load} />);
  await waitFor(() => assert.ok(resolve));
  view.unmount();
  resolve({} as Awaited<ReturnType<PDFDocumentProxy["getPage"]>>);
  await Promise.resolve();
});

test("browser-only runtime cannot initialize bundled worker assets in the server test environment", async () => {
  await assert.rejects(pdfRuntime());
});

test("each preview page shows the selected signature in its reserved footer position", async () => {
  const f = fixture();
  render(
    <AgreementPdfPreview
      url="/agreement"
      load={f.load}
      signature={{
        name: "Example Investor",
        mark: { mode: "typed", font: "allura" },
        box: { x: 355, y: 686, width: 180, height: 54 },
      }}
    />,
  );
  await screen.findByText("Example Investor");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Page 2 of 2");
  await screen.findByText("Example Investor");
});
