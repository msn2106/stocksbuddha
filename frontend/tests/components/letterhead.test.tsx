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
import {
  LetterheadSettings,
  readLetterhead,
} from "../../src/account/LetterheadSettings";
import { LanguageProvider } from "../../src/i18n";
import { makePage } from "../../../packages/contracts/tests/fixtures";
const originalFetch = globalThis.fetch,
  originalReader = globalThis.FileReader,
  originalCreate = URL.createObjectURL,
  originalRevoke = URL.revokeObjectURL,
  originalConfirm = window.confirm;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.FileReader = originalReader;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  window.confirm = originalConfirm;
});
const initial = {
  version: 0,
  name: "",
  pdf: null,
  sha256: null,
  margins: { top: 56, bottom: 20, left: 21, right: 21 },
};

/** Exercise real file reading with controlled HTTP settings and generated PDF responses. */
function fixture(stock = true, hi = false) {
  let status = 200,
    failRead = false,
    failNetwork = false;
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  globalThis.FileReader = window.FileReader;
  URL.createObjectURL = () => "blob:test-preview";
  URL.revokeObjectURL = () => {};
  globalThis.fetch = async (url, init) => {
    if (!init?.method)
      return failRead
        ? Response.json({}, { status: 503 })
        : Response.json(initial);
    const body = JSON.parse(String(init.body));
    calls.push({ path: String(url), body });
    if (failNetwork) throw "network down";
    if (status !== 200) return Response.json({}, { status });
    return String(url).endsWith("preview")
      ? new Response("%PDF-1.7 sample", {
          headers: { "Content-Type": "application/pdf" },
        })
      : Response.json({ ...body, version: 1, sha256: "hash" });
  };
  const data = makePage(hi ? "hi" : "en");
  data.tenant!.slug = stock ? "stocksbuddha" : "alpha";
  render(
    <LanguageProvider
      locale={hi ? "hi" : "en"}
      tenant={data.tenant}
      website={data.website}
    >
      <LetterheadSettings />
    </LanguageProvider>,
  );
  return {
    calls,
    setStatus: (value: number) => {
      status = value;
    },
    setReadFailure: (value: boolean) => {
      failRead = value;
    },
    setNetwork: (value: boolean) => {
      failNetwork = value;
    },
  };
}

test("RA Admin uploads, previews unsaved stationery, saves, adjusts margins and restores defaults", async () => {
  const f = fixture();
  await screen.findByText("Default: Stocks Buddha supplied letterhead");
  assert.ok(
    screen.getByRole("link", { name: "View Stocks Buddha default letterhead" }),
  );
  const file = new window.File(["%PDF-1.7 content"], "letterhead.pdf", {
    type: "application/pdf",
  });
  fireEvent.change(screen.getByLabelText("Letterhead PDF"), {
    target: { files: [] },
  });
  fireEvent.change(screen.getByLabelText("Letterhead PDF"), {
    target: { files: [file] },
  });
  await screen.findByText("Uploaded: letterhead.pdf");
  for (const key of ["Top", "Bottom", "Left", "Right"])
    fireEvent.change(screen.getByLabelText(`${key} margin (mm)`), {
      target: { value: 25 },
    });
  const guard = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(guard);
  assert.ok(guard.defaultPrevented);
  fireEvent.click(
    screen.getByRole("button", { name: "Preview letterhead agreement" }),
  );
  await screen.findByTitle("Letterhead agreement preview");
  assert.match(f.calls[0].path, /letterhead-preview$/);
  assert.equal(f.calls[0].body.name, "letterhead.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));
  await screen.findByText(/Letterhead saved/);
  assert.equal(f.calls[1].body.version, 0);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Remove uploaded letterhead / restore default",
    }),
  );
  await screen.findByText("Default: Stocks Buddha supplied letterhead");
  fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));
  await waitFor(() => assert.equal(f.calls.at(-1)?.body.pdf, null));
  fireEvent.click(
    screen.getByRole("button", { name: "Reload saved letterhead" }),
  );
  await screen.findByText("Default: Stocks Buddha supplied letterhead");
});

test("load, upload, stale-version and network failures preserve local changes and reload requires an explicit discard", async () => {
  const f = fixture(false);
  await screen.findByText("Default: standard RA stationery");
  fireEvent.change(screen.getByLabelText("Letterhead PDF"), {
    target: {
      files: [new window.File(["bad"], "x.png", { type: "image/png" })],
    },
  });
  await screen.findByRole("alert");
  fireEvent.change(screen.getByLabelText("Letterhead PDF"), {
    target: {
      files: [new window.File(["pdf"], "x.pdf", { type: "application/pdf" })],
    },
  });
  await screen.findByText("Uploaded: x.pdf");
  f.setStatus(409);
  fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));
  await screen.findByText(/changed in another session/);
  assert.ok(screen.getByText("Uploaded: x.pdf"));
  f.setStatus(422);
  fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));
  await screen.findByText(/unencrypted/);
  f.setNetwork(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Preview letterhead agreement" }),
  );
  await screen.findByText("The letterhead could not be saved.");
  window.confirm = () => false;
  fireEvent.click(
    screen.getByRole("button", { name: "Reload saved letterhead" }),
  );
  assert.ok(screen.getByText("Uploaded: x.pdf"));
  window.confirm = () => true;
  f.setReadFailure(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Reload saved letterhead" }),
  );
  await screen.findByText(/settings could not load/);
  f.setReadFailure(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Reload letterhead settings" }),
  );
  await screen.findByText("Default: standard RA stationery");
});

test("file limits, reader errors and Hindi letterhead labels remain usable", async (context) => {
  globalThis.FileReader = window.FileReader;
  for (const file of [
    new window.File([], "x.pdf", { type: "application/pdf" }),
    new window.File(["svg"], "x.svg", { type: "image/svg+xml" }),
    new window.File([new Uint8Array(2097153)], "x.pdf", {
      type: "application/pdf",
    }),
  ])
    await assert.rejects(readLetterhead(file), /Choose/);
  context.mock.method(
    window.FileReader.prototype,
    "readAsDataURL",
    function (this: FileReader) {
      this.onerror?.(
        new window.ProgressEvent("error") as ProgressEvent<FileReader>,
      );
    },
  );
  await assert.rejects(
    readLetterhead(
      new window.File(["pdf"], "x.pdf", { type: "application/pdf" }),
    ),
    /could not be read/,
  );
  fixture(true, true);
  await screen.findByText("Default: Stocks Buddha supplied letterhead");
  assert.ok(screen.getByLabelText("लेटरहेड PDF"));
});
