import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/App";
import { makePage } from "../../../packages/contracts/tests/fixtures";
import { resetDom } from "../dom";

afterEach(() => {
  cleanup();
  resetDom();
});

test("preferences load validated storage, apply DOM settings, persist edits and reset", async () => {
  localStorage.setItem(
    "ra-display-preferences-v1",
    JSON.stringify({ textSize: 125, contrast: true, motion: true }),
  );
  const user = userEvent.setup();
  render(<App data={makePage()} />);
  await waitFor(() =>
    assert.equal(document.documentElement.style.fontSize, "125%"),
  );
  assert.equal(document.documentElement.dataset.contrast, "high");
  assert.equal(document.documentElement.dataset.reducedMotion, "true");
  assert.match(
    document.cookie,
    /ra-language-a1b87125-42b7-4d6d-8715-78721c436a82=en/,
  );
  await user.click(screen.getByRole("button", { name: "Display preferences" }));
  await user.click(screen.getByRole("radio", { name: "Double size (200%)" }));
  await user.click(screen.getByRole("checkbox", { name: "High contrast" }));
  await user.click(screen.getByRole("checkbox", { name: "Reduce motion" }));
  assert.equal(document.documentElement.style.fontSize, "200%");
  assert.deepEqual(
    JSON.parse(localStorage.getItem("ra-display-preferences-v1")!),
    { textSize: 200, contrast: false, motion: false },
  );
  await user.click(screen.getByRole("button", { name: "Reset preferences" }));
  assert.equal(document.documentElement.style.fontSize, "100%");
  assert.equal(document.documentElement.dataset.contrast, "standard");
});

test("invalid stored values use safe defaults and enabled-language links remain tenant-scoped", () => {
  localStorage.setItem(
    "ra-display-preferences-v1",
    JSON.stringify({ textSize: 999, contrast: "true", motion: 1 }),
  );
  const page = makePage("hi");
  page.website!.languages.enabled = ["hi"];
  render(<App data={page} />);
  assert.equal(document.documentElement.style.fontSize, "100%");
  assert.equal(document.documentElement.dataset.contrast, "standard");
  assert.equal(document.documentElement.dataset.reducedMotion, "false");
  assert.equal(screen.queryByRole("link", { name: "English" }), null);
  assert.equal(
    screen.getByRole("link", { name: "हिन्दी" }).getAttribute("href"),
    "?lang=hi",
  );
});

test("malformed JSON and unavailable browser storage do not break preferences", async (context) => {
  localStorage.setItem("ra-display-preferences-v1", "not-json");
  const view = render(<App data={makePage()} />);
  assert.equal(document.documentElement.style.fontSize, "100%");
  view.unmount();
  const prototype = Object.getPrototypeOf(localStorage);
  context.mock.method(prototype, "getItem", () => {
    throw new Error("Storage unavailable");
  });
  context.mock.method(prototype, "setItem", () => {
    throw new Error("Storage unavailable");
  });
  const user = userEvent.setup();
  render(<App data={makePage()} />);
  await user.click(screen.getByRole("button", { name: "Display preferences" }));
  await user.click(screen.getByRole("radio", { name: "Large (125%)" }));
  assert.equal(document.documentElement.style.fontSize, "125%");
});
