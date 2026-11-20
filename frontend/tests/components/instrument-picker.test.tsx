import "../dom";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { InstrumentPicker } from "../../src/account/MarketSetup";
import type { MarketInstrument } from "@ra/contracts";
const fetchBefore = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = fetchBefore;
});
const stock: MarketInstrument = {
  key: "NSE_EQ|1",
  symbol: "EXAMPLE",
  name: "Example",
  exchange: "NSE",
  type: "EQ",
  expiry: null,
  strike: null,
  underlying: "ISIN:1",
  lotSize: 1,
  tickSize: 0.05,
};
test("equity selection survives searches and reopening without an expiry filter", async () => {
  const urls: string[] = [];
  const selected: (MarketInstrument | null)[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json(
      String(url).includes("/instruments/")
        ? { instrument: stock }
        : { instruments: [stock] },
    );
  };
  const v = render(
    <InstrumentPicker
      base="/market"
      offering="equity"
      selectedKey={stock.key}
      onSelect={(i) => selected.push(i)}
    />,
  );
  assert.equal(
    (screen.getByLabelText("Matching instruments") as HTMLSelectElement).value,
    stock.key,
  );
  assert.equal(screen.queryByLabelText("Contract expiry (optional)"), null);
  assert.deepEqual(
    Array.from(
      (screen.getByLabelText("Type") as HTMLSelectElement).options,
    ).map((o) => o.value),
    ["EQ"],
  );
  fireEvent.change(screen.getByLabelText("Name / symbol"), {
    target: { value: "EXAMPLE" },
  });
  await screen.findByRole("option", { name: "NSE · EXAMPLE · EQ" });
  fireEvent.change(screen.getByLabelText("Name / symbol"), {
    target: { value: "OTHER" },
  });
  await waitFor(() => assert.ok(urls.some((u) => u.includes("q=OTHER"))));
  assert.ok(
    urls
      .filter((url) => url.includes("?"))
      .every(
        (u) => new URL(u, "http://test").searchParams.get("expiry") === "",
      ),
  );
  assert.equal(selected.length, 0);
  v.unmount();
  render(
    <InstrumentPicker
      base="/market"
      offering="equity"
      selectedKey={stock.key}
      onSelect={() => {}}
    />,
  );
  assert.equal(
    (screen.getByLabelText("Matching instruments") as HTMLSelectElement).value,
    stock.key,
  );
});
test("hedge legs filter derivative expiry independently and clear it when switching to equity", async () => {
  const urls: string[] = [];
  const selected: (MarketInstrument | null)[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({ instruments: [] });
  };
  render(
    <InstrumentPicker
      base="/market"
      offering="hedges"
      onSelect={(i) => selected.push(i)}
    />,
  );
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "FUT" } });
  fireEvent.change(screen.getByLabelText("Name / symbol"), {
    target: { value: "EXAMPLE" },
  });
  fireEvent.change(screen.getByLabelText("Contract expiry (optional)"), {
    target: { value: "2026-12-31" },
  });
  await waitFor(() =>
    assert.ok(urls.some((u) => u.includes("expiry=2026-12-31"))),
  );
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "EQ" } });
  assert.equal(screen.queryByLabelText("Contract expiry (optional)"), null);
  await waitFor(() =>
    assert.equal(
      new URL(urls.at(-1)!, "http://test").searchParams.get("type"),
      "EQ",
    ),
  );
  assert.equal(
    new URL(urls.at(-1)!, "http://test").searchParams.get("expiry"),
    "",
  );
  assert.equal(selected.length, 0);
});

test("saved derivative identity resolves without changing quantity or selection and no-match filters are explained", async () => {
  const option = {
    ...stock,
    key: "NSE_FO|1",
    symbol: "EXAMPLE 100 PE",
    type: "PE" as const,
    expiry: "2026-12-31",
    strike: 100,
    lotSize: 50,
  };
  const selected: unknown[] = [];
  globalThis.fetch = async (url) =>
    Response.json(
      String(url).includes("/instruments/")
        ? { instrument: option }
        : { instruments: [] },
    );
  render(
    <InstrumentPicker
      base="/market"
      offering="options"
      selectedKey={option.key}
      onSelect={(i) => selected.push(i)}
    />,
  );
  await screen.findByText("NSE · EXAMPLE 100 PE · PE", { exact: true });
  assert.ok(screen.getByText(/Lot size 50/));
  fireEvent.change(screen.getByLabelText("Name / symbol"), {
    target: { value: "MISSING" },
  });
  await screen.findByText("No instruments match these filters.");
  assert.ok(screen.getByText(/Your previous selection is unchanged/));
  assert.equal(
    (screen.getByLabelText("Matching instruments") as HTMLSelectElement).value,
    option.key,
  );
  assert.equal(selected.length, 0);
});
