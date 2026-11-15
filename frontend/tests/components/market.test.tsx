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
import { MarketSetup, MarketReminder } from "../../src/account/MarketSetup";
import type { MarketView } from "@ra/contracts";
globalThis.FormData = window.FormData;
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
const view: MarketView = {
  version: 0,
  trades: [],
  holdings: [],
  recommendations: [],
  declaration: null,
  today: "2026-11-14",
  requiredFrom: "2026-10-15",
  declarationCurrent: false,
  catalogue: {
    count: 52917,
    importedAt: "2026-11-14T05:00:00Z",
    sourceModified: "2026-11-14T00:00:00Z",
    stale: false,
  },
  plans: [{ id: "plan", name: "Equity Research", offerings: ["equity"] }],
};
test("daily declaration clearly discloses 30/5 restrictions and submits the covered period with optimistic version", async () => {
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      return Response.json({
        view: { ...view, version: 1, declarationCurrent: true },
        warnings: [],
      });
    }
    return Response.json(view);
  };
  render(<MarketSetup slug="alpha" />);
  await screen.findByText("Personal trading restrictions");
  assert.ok(screen.getByText("days before publication"));
  assert.ok(screen.getByText("days after publication"));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Confirm today's declaration" })
      .closest("form")!,
  );
  await screen.findByText("Declared today");
  assert.deepEqual(calls[0], {
    action: "declare",
    coveredFrom: "2026-10-15",
    confirmed: true,
    version: 0,
  });
  fireEvent.click(screen.getByRole("button", { name: "Data & plan access" }));
  await screen.findByText("52,917");
  assert.ok(screen.getByText("Equity Research"));
});
test("failed requests show recovery and daily reminder does not invent a completed declaration", async () => {
  globalThis.fetch = async () => Response.json({}, { status: 503 });
  render(<MarketSetup slug="alpha" />);
  await screen.findByRole("alert");
  globalThis.fetch = async () => Response.json(view);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Declaration due");
  cleanup();
  render(<MarketReminder slug="alpha" />);
  await screen.findByText("Your daily trading declaration is due");
  await waitFor(() =>
    assert.equal(
      screen.getByRole("link").getAttribute("href"),
      "/ra/alpha/workspace/market?lang=en",
    ),
  );
});

import { act } from "@testing-library/react";
import { LanguageProvider } from "../../src/i18n";
import type {
  MarketInstrument,
  MarketState,
  ResearchCheck,
  Locale,
} from "@ra/contracts";
const stock: MarketInstrument = {
  key: "NSE_EQ|INE1",
  name: "Example Limited",
  symbol: "EXAMPLE",
  exchange: "NSE",
  type: "EQ",
  underlying: "ISIN:INE1",
  expiry: null,
  strike: null,
  lotSize: 1,
  tickSize: 0.05,
};
const option: MarketInstrument = {
  ...stock,
  key: "NSE_FO|1",
  symbol: "EXAMPLE 100 CE",
  type: "CE",
  expiry: "2026-11-30",
  strike: 100,
  lotSize: 50,
};
/** Simulate server projections while testing browser payloads, recovery and instrument identity independently of persistence. */
function marketHarness(initial: MarketView = structuredClone(view)) {
  const state = {
    view: structuredClone(initial),
    calls: [] as Record<string, unknown>[],
    saveError: "",
    searchError: false,
    checkError: false,
    check: { allowed: true, reasons: [], conflicts: [] } as ResearchCheck,
    warnings: [] as string[],
  };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/instruments?"))
      return state.searchError
        ? Response.json({}, { status: 503 })
        : Response.json({
            instruments: [
              stock,
              option,
              { ...stock, key: "INDEX", type: "INDEX" },
            ],
          });
    if (String(url).endsWith("/check"))
      return state.checkError
        ? Response.json({}, { status: 503 })
        : Response.json(state.check);
    if (init?.method !== "POST") return Response.json(state.view);
    const c = JSON.parse(String(init.body));
    state.calls.push(c);
    if (state.saveError)
      return Response.json({ error: state.saveError }, { status: 409 });
    const v = state.view;
    v.version++;
    if (c.action === "declare") v.declarationCurrent = true;
    if (c.action === "trade" || c.action === "holding") {
      const record = {
        ...c.value,
        id: `record-${v.version}`,
        instrument: stock,
        recordedAt: "2026-11-14T05:00:00Z",
      };
      if (c.action === "trade") v.trades.push(record);
      else v.holdings.push(record);
      v.declarationCurrent = false;
    }
    if (c.action === "correct") {
      const r = [...v.trades, ...v.holdings].find((r) => r.id === c.id)!;
      r.voidReason = c.reason;
    }
    if (c.action === "external")
      v.recommendations.push({
        ...c.value,
        id: `rec-${v.version}`,
        instrument: stock,
        recordedAt: "2026-11-14T05:00:00Z",
      });
    if (c.action === "close") {
      const r = v.recommendations.find((r) => r.id === c.id)!;
      r.closedOn = v.today;
      r.closeReason = c.reason;
    }
    if (c.action === "plan")
      v.plans.find((p) => p.id === c.planId)!.offerings = c.offerings;
    return Response.json({ view: v, warnings: state.warnings });
  };
  return state;
}
/** Render the actual bilingual context and navigate by the text exposed to the user. */
function marketRender(locale: Locale) {
  return render(
    <LanguageProvider locale={locale} tenant={null} website={null}>
      <MarketSetup slug="alpha" />
    </LanguageProvider>,
  );
}
/** Select a fetched contract through the visible picker; no invented client instrument details are submitted. */
async function choose(locale: Locale, key = stock.key) {
  fireEvent.change(
    screen.getByLabelText(locale === "hi" ? "नाम / सिंबल" : "Name / symbol"),
    { target: { value: "EXAMPLE" } },
  );
  await screen.findByRole("option", { name: "NSE · EXAMPLE · EQ" });
  fireEvent.change(
    screen.getByLabelText(
      locale === "hi" ? /^मिलते हुए कॉन्ट्रैक्ट/ : /^Matching contracts/,
    ),
    { target: { value: key } },
  );
}
/** Fill an actual named form control and dispatch the event React observes. */
function field(form: HTMLFormElement, name: string, value: string) {
  fireEvent.change(form.elements.namedItem(name) as HTMLInputElement, {
    target: { value },
  });
}
for (const locale of ["en", "hi"] as const)
  test(`market ${locale}: transactions, holdings, corrections, restrictions and plan payloads retain versions`, async () => {
    const h = marketHarness();
    marketRender(locale);
    const hi = locale === "hi";
    await screen.findByText(hi ? "घोषणा बाकी" : "Declaration due");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 270));
    });
    const add = screen.getByRole("button", {
        name: hi ? "रिकॉर्ड जोड़ें" : "Add record",
      }),
      form = add.closest("form")!;
    assert.equal((add as HTMLButtonElement).disabled, true);
    fireEvent.submit(form);
    assert.equal(h.calls.length, 0);
    await choose(locale);
    field(form, "person", "Analyst");
    field(form, "account", "Personal");
    field(form, "quantity", "10");
    field(form, "note", "Declared buy");
    h.saveError = "invalid_fields";
    fireEvent.submit(form);
    await screen.findByRole("alert");
    assert.equal(
      (form.elements.namedItem("person") as HTMLInputElement).value,
      "Analyst",
    );
    h.saveError = "";
    h.warnings = ["potential-conflict"];
    fireEvent.submit(form);
    await screen.findByText(/Saved. A potential trading conflict/);
    assert.equal(h.calls.at(-1)?.action, "trade");
    assert.equal(h.view.trades.length, 1);
    h.warnings = [];
    fireEvent.change(
      screen.getByLabelText(hi ? /^रिकॉर्ड प्रकार/ : /^Record type/),
      { target: { value: "holding" } },
    );
    field(form, "person", "Analyst");
    field(form, "account", "Personal");
    field(form, "quantity", "12");
    fireEvent.submit(form);
    await waitFor(() => assert.equal(h.view.holdings.length, 1));
    await screen.findByText(hi ? "सुरक्षित किया गया।" : "Saved successfully.");
    const correct = screen.getAllByRole("button", {
      name: "Correct record",
    })[0];
    fireEvent.click(correct);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Correct record" })[0],
    );
    const reason = screen.getByLabelText("Reason (retained in audit history)");
    fireEvent.change(reason, {
      target: { value: "Correct duplicate holding" },
    });
    h.saveError = "market_version_conflict";
    fireEvent.submit(reason.closest("form")!);
    await screen.findByText(/This page changed in another session/);
    h.saveError = "";
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => assert.equal(screen.queryByRole("alert"), null));
    fireEvent.submit(reason.closest("form")!);
    await screen.findByText("Corrected: Correct duplicate holding");
    const declare = screen.getByRole("button", {
      name: hi ? "आज की घोषणा सुरक्षित करें" : "Confirm today's declaration",
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(declare.closest("form")!);
    await screen.findByText(hi ? "आज की घोषणा पूर्ण" : "Declared today");
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "अनुशंसाएँ और प्रतिबंध" : "Recommendations & restrictions",
      }),
    );
    const external = screen
      .getByRole("button", { name: "Record recommendation" })
      .closest("form")!;
    fireEvent.submit(external);
    const count = h.calls.length;
    assert.equal(
      (
        screen.getByRole("button", {
          name: hi ? "प्रतिबंध जाँचें" : "Check restrictions",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
    await choose(locale);
    const checkButton = screen.getByRole("button", {
      name: hi ? "प्रतिबंध जाँचें" : "Check restrictions",
    });
    h.checkError = true;
    fireEvent.click(checkButton);
    await screen.findByText("Unable to check restrictions");
    h.checkError = false;
    fireEvent.click(checkButton);
    await screen.findByText(/No declared lookback conflict/);
    h.check = {
      allowed: false,
      reasons: ["personal_trade_lookback"],
      conflicts: [
        {
          id: "trade",
          symbol: "EXAMPLE",
          date: "2026-11-14",
          until: "2026-12-15",
        },
      ],
    };
    fireEvent.click(checkButton);
    await screen.findByText("Publication is blocked.");
    assert.ok(screen.getByText(/Earliest publication: 2026-12-15/));
    field(external, "audience", "Equity group on email");
    field(external, "rationale", "Cash flow and valuation analysis");
    fireEvent.submit(external);
    await screen.findByText(/Equity group on email · Published/);
    assert.equal(h.calls.length, count + 1);
    assert.ok(screen.getByText(/Potential breach: buy/));
    fireEvent.click(
      screen.getByRole("button", { name: "Close recommendation" }),
    );
    const close = screen.getByLabelText("Reason (retained in audit history)");
    fireEvent.change(close, {
      target: { value: "Target reached, research closed" },
    });
    fireEvent.submit(close.closest("form")!);
    await screen.findByText(/Closed 2026-11-14: Target reached/);
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "डेटा और योजनाएँ" : "Data & plan access",
      }),
    );
    await choose(locale);
    assert.ok(screen.getByText("Tick size (INR)"));
    assert.ok(screen.getAllByText("—").length >= 2);
    fireEvent.change(screen.getByLabelText(hi ? /^प्रकार/ : /^Type/), {
      target: { value: "CE" },
    });
    assert.equal(screen.queryByText("Tick size (INR)"), null);
    fireEvent.change(
      screen.getByLabelText(hi ? "एक्सपायरी (वैकल्पिक)" : "Expiry (optional)"),
      { target: { value: "2026-11-30" } },
    );
    await choose(locale, option.key);
    assert.ok(screen.getByText("100"));
    assert.ok(screen.getByText("2026-11-30"));
    fireEvent.change(
      screen.getByLabelText(
        hi ? /^मिलते हुए कॉन्ट्रैक्ट/ : /^Matching contracts/,
      ),
      { target: { value: "" } },
    );
    assert.equal(screen.queryByText("Tick size (INR)"), null);
    fireEvent.click(screen.getByRole("checkbox", { name: "options" }));
    const plan = screen
      .getByRole("button", { name: "Save access" })
      .closest("form")!;
    fireEvent.submit(plan);
    await waitFor(() => assert.equal(h.calls.at(-1)?.action, "plan"));
    assert.deepEqual(h.calls.at(-1)?.offerings, ["equity", "options"]);
  });
for (const locale of ["en", "hi"] as const)
  test(`market ${locale}: failed loading/search, absent catalogue and stale source are explicit`, async () => {
    const hi = locale === "hi";
    globalThis.fetch = async () => Response.json({}, { status: 503 });
    marketRender(locale);
    await screen.findByRole("alert");
    assert.ok(
      screen.getByRole("button", { name: hi ? "फिर प्रयास करें" : "Retry" }),
    );
    const h = marketHarness({ ...view, catalogue: null, plans: [] });
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "फिर प्रयास करें" : "Retry" }),
    );
    await screen.findByText(hi ? "घोषणा बाकी" : "Declaration due");
    h.searchError = true;
    fireEvent.change(
      screen.getByLabelText(hi ? "नाम / सिंबल" : "Name / symbol"),
      { target: { value: "EX" } },
    );
    await screen.findByText(
      hi
        ? "खोज उपलब्ध नहीं है। फिर प्रयास करें।"
        : "Search unavailable. Try again.",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "डेटा और योजनाएँ" : "Data & plan access",
      }),
    );
    assert.ok(screen.getByText(/No catalogue imported/));
    assert.ok(screen.getByText("Create a plan first in Plans and discounts."));
    cleanup();
    marketHarness({
      ...view,
      catalogue: { ...view.catalogue!, sourceModified: null, stale: true },
    });
    marketRender(locale);
    await screen.findByText(hi ? "घोषणा बाकी" : "Declaration due");
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "डेटा और योजनाएँ" : "Data & plan access",
      }),
    );
    assert.ok(screen.getByText("Unknown"));
    assert.ok(screen.getByText(/Stale \/ unverified provider date/));
  });
test("daily reminder handles Hindi, completed declarations, failures and unmount before resolution", async () => {
  marketHarness();
  render(
    <LanguageProvider locale="hi" tenant={null} website={null}>
      <MarketReminder slug="alpha" />
    </LanguageProvider>,
  );
  await screen.findByText("आज की ट्रेडिंग घोषणा आवश्यक है");
  assert.equal(
    screen.getByRole("link").getAttribute("href"),
    "/ra/alpha/workspace/market?lang=hi",
  );
  cleanup();
  for (const response of [
    () => Promise.resolve(Response.json({ ...view, declarationCurrent: true })),
    () => Promise.resolve(Response.json({}, { status: 503 })),
    () => Promise.reject(new Error("offline")),
  ]) {
    globalThis.fetch = response;
    render(<MarketReminder slug="alpha" />);
    await act(async () => {
      await new Promise(setImmediate);
    });
    assert.equal(screen.queryByRole("link"), null);
    cleanup();
  }
  let done!: (r: Response) => void;
  globalThis.fetch = () =>
    new Promise((r) => {
      done = r;
    });
  const { unmount } = render(<MarketReminder slug="alpha" />);
  unmount();
  await act(async () => {
    done(Response.json(view));
  });
  assert.equal(screen.queryByRole("link"), null);
});
test("recommendation register distinguishes historic, corrected, contrary and unrelated trades", async () => {
  const trade = {
    id: "t",
    instrument: stock,
    instrumentKey: stock.key,
    person: "Analyst",
    account: "Self",
    date: "2026-11-14",
    side: "sell" as const,
    quantity: 1,
    note: "",
    recordedAt: "2026-11-14T00:00:00Z",
  };
  const rec = {
    id: "r",
    instrument: stock,
    instrumentKey: stock.key,
    publishedOn: "2026-10-01",
    direction: "buy" as const,
    audience: "Equity group",
    rationale: "Valuation review",
    recordedAt: trade.recordedAt,
  };
  const trades: MarketState["trades"] = [
    trade,
    { ...trade, id: "void", voidReason: "Corrected" },
    { ...trade, id: "old", date: "2025-01-01" },
    {
      ...trade,
      id: "unrelated",
      instrument: { ...stock, underlying: "OTHER" },
    },
    { ...trade, id: "same", side: "buy" },
  ];
  marketHarness({
    ...view,
    trades,
    recommendations: [
      rec,
      { ...rec, id: "hold", direction: "hold" },
      {
        ...rec,
        id: "closed",
        closedOn: "2026-10-10",
        closeReason: "Target met",
      },
    ],
  });
  marketRender("en");
  await screen.findByText("Declaration due");
  fireEvent.click(
    screen.getByRole("button", { name: "Recommendations & restrictions" }),
  );
  assert.equal(screen.getAllByText(/Potential breach:/).length, 3);
  assert.ok(screen.getByText("Closed 2026-10-10: Target met"));
});
