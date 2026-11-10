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
import type { SignatureMark } from "@ra/contracts";
import {
  SignatureInput,
  SignatureAppearance,
} from "../../src/account/SignatureInput";
const originalContext = window.HTMLCanvasElement.prototype.getContext,
  originalData = window.HTMLCanvasElement.prototype.toDataURL;
const originalBitmap = globalThis.createImageBitmap,
  originalPointer = window.PointerEvent;
afterEach(() => {
  cleanup();
  window.HTMLCanvasElement.prototype.getContext = originalContext;
  window.HTMLCanvasElement.prototype.toDataURL = originalData;
  globalThis.createImageBitmap = originalBitmap;
  window.PointerEvent = originalPointer;
});

/** Render the signature chooser with observable private draft changes and deterministic canvas pixels. */
function fixture(hi = false) {
  const marks: (SignatureMark | null)[] = [],
    busy: boolean[] = [];
  const context = {
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    clearRect() {},
    drawImage() {},
  };
  window.HTMLCanvasElement.prototype.getContext = (() =>
    context) as unknown as typeof originalContext;
  window.HTMLCanvasElement.prototype.toDataURL = () =>
    "data:image/png;base64,signature";
  globalThis.createImageBitmap = async () =>
    ({ width: 512, height: 160, close() {} }) as ImageBitmap;
  window.PointerEvent = window.MouseEvent as typeof PointerEvent;
  const view = render(
    <SignatureInput
      value={{ mode: "typed", font: "allura" }}
      onChange={(value) => marks.push(value)}
      onBusy={(value) => busy.push(value)}
      name="Example Investor"
      hi={hi}
      disabled={false}
    />,
  );
  return { view, marks, busy };
}

test("signature styles, upload normalization and localized errors preserve the private draft", async () => {
  for (const hi of [false, true]) {
    const f = fixture(hi);
    fireEvent.change(
      screen.getByLabelText(hi ? "हस्ताक्षर फ़ॉन्ट" : "Signature font"),
      { target: { value: "caveat" } },
    );
    assert.deepEqual(f.marks.at(-1), { mode: "typed", font: "caveat" });
    fireEvent.change(
      screen.getByLabelText(hi ? "हस्ताक्षर का तरीका" : "Signature method"),
      { target: { value: "upload" } },
    );
    const input = screen.getByLabelText(
      hi ? "हस्ताक्षर की छवि" : "Signature image",
    );
    fireEvent.change(input, { target: { files: [] } });
    fireEvent.change(input, {
      target: {
        files: [new window.File(["pixels"], "sign.png", { type: "image/png" })],
      },
    });
    await waitFor(() => assert.equal(f.marks.at(-1)?.mode, "upload"));
    assert.deepEqual(f.busy, [true, false]);
    fireEvent.change(input, {
      target: {
        files: [new window.File(["x"], "bad.svg", { type: "image/svg+xml" })],
      },
    });
    await screen.findByRole("alert");
    assert.equal(f.marks.at(-1), null);
    fireEvent.change(
      screen.getByLabelText(hi ? "हस्ताक्षर का तरीका" : "Signature method"),
      { target: { value: "typed" } },
    );
    assert.deepEqual(f.marks.at(-1), { mode: "typed", font: "allura" });
    cleanup();
  }
  render(
    <SignatureAppearance
      mark={{ mode: "draw", image: "data:image/png;base64,x" }}
      name="Investor"
    />,
  );
  assert.ok(screen.getByAltText("Selected signature"));
});

test("mouse and touch drawing commits completed strokes, supports clearing and rejects interrupted or unavailable drawings", () => {
  for (const hi of [false, true]) {
    const f = fixture(hi);
    fireEvent.change(
      screen.getByLabelText(hi ? "हस्ताक्षर का तरीका" : "Signature method"),
      { target: { value: "draw" } },
    );
    const canvas = screen.getByLabelText(
      hi ? "यहाँ हस्ताक्षर बनाएं" : "Draw your signature here",
    ) as HTMLCanvasElement;
    canvas.setPointerCapture = () => {};
    canvas.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 512,
      height: 160,
      right: 512,
      bottom: 160,
      toJSON() {},
    });
    fireEvent.pointerMove(canvas, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(canvas);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 60 });
    fireEvent.pointerUp(canvas);
    assert.equal(f.marks.at(-1)?.mode, "draw");
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "साफ करें" : "Clear drawing" }),
    );
    assert.equal(f.marks.at(-1), null);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas);
    assert.equal(f.marks.at(-1), null);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 60 });
    fireEvent.pointerCancel(canvas);
    assert.equal(f.marks.at(-1), null);
    window.HTMLCanvasElement.prototype.toDataURL = () => "x".repeat(140000);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 60 });
    fireEvent.pointerUp(canvas);
    assert.ok(screen.getByRole("alert"));
    window.HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof originalContext;
    fireEvent.pointerDown(canvas);
    assert.ok(
      screen.getByText(hi ? /चित्र बनाना उपलब्ध/ : /Drawing is unavailable/),
    );
    cleanup();
  }
});

test("typed preview fits long names after fonts load and uses Devanagari fallback", async () => {
  const prototype = window.SVGElement.prototype;
  Object.defineProperty(prototype, "getComputedTextLength", {
    configurable: true,
    value: () => 352,
  });
  try {
    render(
      <SignatureAppearance
        mark={{ mode: "typed", font: "allura" }}
        name="हिंदी Investor"
      />,
    );
    const text = screen.getByText("हिंदी Investor");
    await waitFor(() =>
      assert.match(text.getAttribute("transform")!, /scale\(0.5\)/),
    );
    assert.equal(text.getAttribute("class"), "signature-font-formal");
  } finally {
    Reflect.deleteProperty(prototype, "getComputedTextLength");
  }
});
