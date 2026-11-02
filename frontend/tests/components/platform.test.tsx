import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, within } from "@testing-library/react";
import { App } from "../../src/App";
import { render as renderPage } from "../../src/entry-server";
import { makePage } from "../../../packages/contracts/tests/fixtures";
import type { PageData } from "@ra/contracts";
import { resetDom } from "../dom";

afterEach(() => {
  cleanup();
  resetDom();
});

/** Create a tenant-independent platform page for both SSR and hydrated component tests. */
function platform(overrides: Partial<PageData> = {}): PageData {
  return {
    tenant: null,
    website: null,
    page: "platform",
    locale: "en",
    ...overrides,
  };
}

test("platform website has distinct RA, investor and platform entry points without public owner signup", () => {
  render(<App data={platform()} />);
  assert.ok(
    screen.getByRole("heading", {
      name: "Your research business. Its own place online.",
    }),
  );
  assert.equal(
    screen
      .getByRole("link", { name: "Platform owner sign in" })
      .getAttribute("href"),
    "/workspace/login?lang=en",
  );
  assert.equal(
    screen
      .getByRole("link", { name: "Explore an RA website" })
      .getAttribute("href"),
    "/ra/stocksbuddha?lang=en",
  );
  const input = screen.getByLabelText("RA website name");
  const form = input.closest("form")!;
  assert.equal(form.getAttribute("action"), "/access");
  assert.equal(form.getAttribute("method"), "get");
  assert.equal(
    within(form)
      .getByRole("button", { name: "RA Admin / team sign in" })
      .getAttribute("value"),
    "organisation",
  );
  assert.equal(
    within(form)
      .getByRole("button", { name: "Investor sign in" })
      .getAttribute("value"),
    "investor",
  );
  assert.match(
    screen
      .getByRole("link", { name: "Email to request a demo" })
      .getAttribute("href")!,
    /^mailto:support@stocksbuddha.com\?subject=/,
  );
  assert.equal(document.querySelector('a[href*="/workspace/signup"]'), null);
  assert.equal(document.querySelector('input[type="password"]'), null);
  assert.equal(document.body.textContent?.includes("INH0000210695"), false);
});

test("platform SSR has its own localized metadata and an indexing policy isolated from RA pages", () => {
  for (const locale of ["en", "hi"] as const) {
    const data = platform({ locale, platformAccessError: true });
    const result = renderPage(data);
    assert.equal(result.lang, locale);
    assert.match(result.head, /StocksBuddha/);
    assert.match(result.head, /noindex,nofollow/);
    assert.match(result.html, /role="alert"/);
    assert.match(result.html, /name="lang" value="/);
    assert.equal(result.html.includes("INH0000210695"), false);
    assert.match(
      renderPage({ ...data, indexable: true }).head,
      /content="index,follow"/,
    );
  }
  assert.match(
    renderPage({ ...makePage(), indexable: true }).head,
    /noindex,nofollow/,
  );
  assert.match(
    renderPage({ ...platform(), page: "not-found", indexable: true }).head,
    /noindex,nofollow/,
  );
});
