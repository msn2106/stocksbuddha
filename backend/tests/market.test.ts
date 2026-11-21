import type { EntityManager } from "typeorm";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import {
  emptyMarket,
  indiaDate,
  addDays,
  publicationCheck,
  tradeWarnings,
  requiredFrom,
} from "../src/market/policy";
import {
  InstrumentCatalogue,
  importCatalogue,
  normalizeInstruments,
} from "../src/market/catalogue";
import { catalogueSlot } from "../src/market/scheduler";
import { MarketService } from "../src/market/service";
import {
  offeringEligible,
  freezeResearchOfferings,
} from "../src/market/entitlements";
import { onboardingFixture } from "./onboarding-fixture";
import { marketMutationSchema, recommendationSchema } from "@ra/contracts";
const raw = {
  instrument_key: "NSE_EQ|INE123",
  name: "Example Limited",
  trading_symbol: "EXAMPLE",
  segment: "NSE_EQ",
  exchange: "NSE",
  instrument_type: "EQ",
  lot_size: 1,
  tick_size: 5,
};
const bytes = gzipSync(JSON.stringify([raw]));
const instrument = normalizeInstruments(bytes)[0];
const now = new Date("2026-11-14T07:00:00Z");
test("lookback boundaries, India midnight and outstanding contrary trading are independent", () => {
  assert.equal(indiaDate(new Date("2026-11-13T18:30:00Z")), "2026-11-14");
  const state = emptyMarket();
  assert.equal(publicationCheck(state, [instrument], now).allowed, false);
  state.declaration = {
    at: now.toISOString(),
    actorId: "owner",
    coveredFrom: "2026-10-15",
  };
  state.trades.push({
    id: "trade",
    instrument,
    instrumentKey: instrument.key,
    person: "Owner",
    account: "Personal",
    date: "2026-10-15",
    side: "sell",
    quantity: 2,
    note: "",
    recordedAt: now.toISOString(),
  });
  assert.equal(publicationCheck(state, [instrument], now).allowed, false);
  assert.equal(
    publicationCheck(state, [instrument], now).conflicts[0].until,
    "2026-11-15",
  );
  state.trades[0].date = "2026-10-14";
  assert.equal(publicationCheck(state, [instrument], now).allowed, true);
  state.declaration.invalidated = true;
  assert.equal(publicationCheck(state, [instrument], now).allowed, false);
  assert.equal(requiredFrom(state, "2026-12-31"), "2026-11-14");
  state.recommendations.push({
    id: "rec",
    instrument,
    instrumentKey: instrument.key,
    publishedOn: "2026-11-01",
    direction: "buy",
    audience: "Equity",
    rationale: "Research supported by analysis",
    recordedAt: now.toISOString(),
  });
  assert.deepEqual(tradeWarnings(state, instrument, "2026-11-06", "buy"), [
    "rec",
  ]);
  assert.deepEqual(tradeWarnings(state, instrument, "2026-11-07", "buy"), []);
  assert.deepEqual(tradeWarnings(state, instrument, "2026-11-14", "sell"), [
    "rec",
  ]);
  state.recommendations[0].closedOn = "2026-11-10";
  assert.deepEqual(tradeWarnings(state, instrument, "2026-11-14", "sell"), []);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
test("catalogue parsing rejects corruption and replacement is atomic; expired contracts remain identifiable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "market-"));
  try {
    assert.throws(() => normalizeInstruments(gzipSync("{}")));
    assert.throws(() =>
      normalizeInstruments(gzipSync(JSON.stringify([raw, raw]))),
    );
    await importCatalogue(dir, [{ bytes, modified: now.toUTCString() }], now);
    const before = await readFile(path.join(dir, "current.json.gz"));
    await assert.rejects(
      importCatalogue(dir, [{ bytes: Buffer.from("bad"), modified: null }]),
    );
    assert.deepEqual(await readFile(path.join(dir, "current.json.gz")), before);
    const c = new InstrumentCatalogue(dir);
    await c.load();
    assert.equal(c.search("EX", "EQ", "", now).length, 1);
    assert.equal(c.get(instrument.key)?.tickSize, 0.05);
    assert.equal(c.metadata(now)?.stale, false);
    assert.equal(c.metadata(new Date("2026-11-20"))?.stale, true);
    assert.equal(c.search("X", "", "", now).length, 0);
    assert.equal(catalogueSlot(new Date("2026-11-14T00:59:00Z")), null);
    assert.equal(
      catalogueSlot(new Date("2026-11-14T01:00:00Z")),
      "2026-11-14:06:30",
    );
    assert.equal(
      catalogueSlot(new Date("2026-11-14T03:00:00Z")),
      "2026-11-14:08:30",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("owner-only declarations preserve encrypted audit, reject stale writes, and never hide a declared breach", async () => {
  const f = onboardingFixture(),
    dir = await mkdtemp(path.join(tmpdir(), "market-service-"));
  try {
    await importCatalogue(dir, [{ bytes, modified: now.toUTCString() }], now);
    const service = new MarketService(
      f.db,
      new InstrumentCatalogue(dir),
      { ONBOARDING_DATA_KEY: "a".repeat(64) },
      () => now,
    );
    await assert.rejects(service.read(f.investor), /forbidden/);
    await assert.rejects(
      service.read({ ...f.admin, tenantId: f.otherTenantId }),
      /forbidden/,
    );
    let v = await service.read(f.admin);
    assert.equal(v.declarationCurrent, false);
    await assert.rejects(
      service.mutate(f.admin, {
        action: "declare",
        version: 0,
        coveredFrom: "2026-11-14",
        confirmed: true,
      }),
      /declaration_gap/,
    );
    let result = await service.mutate(f.admin, {
      action: "declare",
      version: 0,
      coveredFrom: "2026-10-15",
      confirmed: true,
    });
    assert.equal(result.view.declarationCurrent, true);
    await assert.rejects(
      service.mutate(f.admin, {
        action: "declare",
        version: 0,
        coveredFrom: "2026-10-15",
        confirmed: true,
      }),
      /market_version_conflict/,
    );
    result = await service.mutate(f.admin, {
      action: "external",
      version: 1,
      value: {
        instrumentKey: instrument.key,
        publishedOn: "2026-11-13",
        direction: "buy",
        audience: "Telegram group",
        rationale: "Long-term cashflow analysis",
      },
    });
    result = await service.mutate(f.admin, {
      action: "trade",
      version: 2,
      value: {
        instrumentKey: instrument.key,
        person: "Owner",
        account: "Self",
        date: "2026-11-14",
        side: "buy",
        quantity: 1,
        note: "",
      },
    });
    assert.equal(result.warnings.length, 1);
    assert.equal(result.view.declarationCurrent, false);
    assert.equal(
      (await service.check(f.admin, [instrument.key])).allowed,
      false,
    );
    result = await service.mutate(f.admin, {
      action: "correct",
      version: 3,
      id: result.view.trades[0].id,
      reason: "Wrong security entered; replacement follows",
    });
    assert.ok(result.view.trades[0].voidReason);
    assert.equal(result.view.declarationCurrent, false);
    result = await service.mutate(f.admin, {
      action: "declare",
      version: 4,
      coveredFrom: "2026-11-14",
      confirmed: true,
    });
    assert.equal(
      (await service.check(f.admin, [instrument.key])).allowed,
      true,
    );
    v = await service.read(f.admin);
    assert.equal(v.version, 5);
    const rows = await f.query("SELECT snapshot_cipher FROM ra_market_events");
    assert.equal(rows.length, 5);
    assert.ok(!String(rows[0].snapshot_cipher).includes("Owner"));
    await assert.rejects(
      service.mutate(f.admin, {
        action: "close",
        version: 5,
        id: randomUUID(),
        reason: "Closing another organisation's record",
      }),
      /record_not_found/,
    );
  } finally {
    f.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("research offering grants are frozen at checkout and require current KYC plus the same qualifying order", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup(),
      orderId = randomUUID();
    await f.query(
      "INSERT INTO research_plan_offerings(tenant_id,plan_id,offering) VALUES (?,?,?)",
      [f.tenantId, planId, "equity"],
    );
    await freezeResearchOfferings(
      f.db.manager ?? ({ query: f.query } as unknown as EntityManager),
      f.tenantId,
      planId,
      orderId,
    );
    await f.query("DELETE FROM research_plan_offerings WHERE tenant_id=?", [
      f.tenantId,
    ]);
    await f.query(
      "INSERT INTO subscription_orders(id,tenant_id,membership_id,status,starts_at,ends_at,agreement_id,dev) VALUES (?,?,?,'paid',?,?,?,0)",
      [
        orderId,
        f.tenantId,
        f.memberId,
        "2026-11-01",
        "2026-12-01",
        randomUUID(),
      ],
    );
    assert.equal(
      await offeringEligible(
        { query: f.query } as unknown as EntityManager,
        f.tenantId,
        f.memberId,
        "equity",
        { NODE_ENV: "production" },
        now,
      ),
      true,
    );
    await f.query("UPDATE subscription_orders SET dev=1 WHERE id=?", [orderId]);
    for (const [appEnv, dbEnv, expected] of [
      ["dev", "dev", true],
      ["production", "prod", false],
    ] as const) {
      assert.equal(
        await offeringEligible(
          f.db,
          f.tenantId,
          f.memberId,
          "equity",
          { NODE_ENV: "production", APP_ENV: appEnv, DB_ENV: dbEnv },
          now,
        ),
        expected,
      );
    }
    await f.query("UPDATE subscription_orders SET dev=0 WHERE id=?", [orderId]);
    assert.equal(
      await offeringEligible(
        { query: f.query } as unknown as EntityManager,
        f.tenantId,
        f.memberId,
        "options",
        { NODE_ENV: "production" },
        now,
      ),
      false,
    );
    assert.equal(
      await offeringEligible(
        { query: f.query } as unknown as EntityManager,
        f.otherTenantId,
        f.memberId,
        "equity",
        {},
        now,
      ),
      false,
    );
    assert.equal(
      await offeringEligible(
        { query: f.query } as unknown as EntityManager,
        f.tenantId,
        f.memberId,
        "equity",
        {},
        new Date("2027-01-01"),
      ),
      false,
    );
  } finally {
    f.close();
  }
});
test("transport contracts reject impossible dates and incomplete recommendation drafts", () => {
  assert.equal(
    marketMutationSchema.safeParse({
      action: "declare",
      version: 0,
      coveredFrom: "2026-02-30",
      confirmed: true,
    }).success,
    false,
  );
  assert.equal(
    recommendationSchema.safeParse({ title: "Trade" }).success,
    false,
  );
});
test("market holdings, historical recommendation closure and plan changes preserve tenant boundaries and invalidation", async () => {
  const f = onboardingFixture(),
    dir = await mkdtemp(path.join(tmpdir(), "market-actions-"));
  try {
    const { planId } = await f.setup();
    await importCatalogue(dir, [{ bytes, modified: now.toUTCString() }], now);
    const catalogue = new InstrumentCatalogue(dir),
      service = new MarketService(
        f.db,
        catalogue,
        { ONBOARDING_DATA_KEY: "a".repeat(64) },
        () => now,
      );
    assert.throws(
      () => new MarketService(f.db, catalogue, {}),
      /market_key_required/,
    );
    await assert.rejects(
      service.read({ ...f.admin, token: "missing" }),
      /unauthorized/,
    );
    assert.equal(
      (await service.search(f.admin, "EX", "EQ", "")).instruments.length,
      1,
    );
    await assert.rejects(service.check(f.admin, []), /instrument_not_found/);
    await assert.rejects(
      service.check(f.admin, ["missing"]),
      /instrument_not_found/,
    );
    await assert.rejects(
      service.check(f.admin, Array(11).fill(instrument.key)),
      /instrument_not_found/,
    );
    let version = 0;
    const save = async (command: Record<string, unknown>) => {
      const result = await service.mutate(f.admin, { ...command, version });
      version = result.view.version;
      return result;
    };
    const holding = {
      instrumentKey: instrument.key,
      person: "Owner",
      account: "Self",
      quantity: 5,
    };
    let result = await save({ action: "holding", value: holding });
    assert.equal(result.view.holdings.length, 1);
    await save({
      action: "correct",
      id: result.view.holdings[0].id,
      reason: "Duplicate imported holding",
    });
    await assert.rejects(
      save({
        action: "correct",
        id: result.view.holdings[0].id,
        reason: "Duplicate imported holding",
      }),
      /record_not_found/,
    );
    await save({
      action: "trade",
      value: { ...holding, date: "2026-11-14", side: "sell", note: "" },
    });
    result = await save({
      action: "external",
      value: {
        instrumentKey: instrument.key,
        publishedOn: "2026-11-13",
        direction: "buy",
        audience: "Existing subscribers",
        rationale: "Cash flow and balance sheet review",
      },
    });
    assert.equal(result.warnings.length, 1);
    result = await save({
      action: "close",
      id: result.view.recommendations[0].id,
      reason: "Recommendation target reached",
    });
    assert.equal(result.view.recommendations[0].closedOn, "2026-11-14");
    await assert.rejects(
      save({
        action: "close",
        id: result.view.recommendations[0].id,
        reason: "Already closed recommendation",
      }),
      /record_not_found/,
    );
    await save({
      action: "declare",
      confirmed: true,
      coveredFrom: "2026-10-15",
    });
    result = await save({ action: "holding", value: holding });
    assert.equal(result.view.declarationCurrent, false);
    result = await save({
      action: "plan",
      planId,
      offerings: ["equity", "options"],
    });
    assert.deepEqual(result.view.plans[0].offerings.sort(), [
      "equity",
      "options",
    ]);
    result = await save({ action: "plan", planId, offerings: [] });
    assert.deepEqual(result.view.plans[0].offerings, []);
    await assert.rejects(
      save({ action: "plan", planId: randomUUID(), offerings: [] }),
      /plan_not_found/,
    );
    await assert.rejects(
      save({
        action: "holding",
        value: { ...holding, instrumentKey: "missing" },
      }),
      /instrument_not_found/,
    );
    await assert.rejects(
      save({
        action: "trade",
        value: { ...holding, date: "2027-01-01", side: "buy", note: "" },
      }),
      /invalid_date/,
    );
    await assert.rejects(
      save({
        action: "external",
        value: {
          instrumentKey: instrument.key,
          publishedOn: "2027-01-01",
          direction: "buy",
          audience: "Subscribers",
          rationale: "Cash flow and balance sheet review",
        },
      }),
      /invalid_date/,
    );
    await assert.rejects(
      save({ action: "declare", confirmed: true, coveredFrom: "2000-01-01" }),
      /declaration_gap/,
    );
    await assert.rejects(service.mutate(f.admin, {}), /invalid_fields/);
    // A saved immutable snapshot supports later corrections even after a reference file loses the contract.
    const originalGet = catalogue.get.bind(catalogue);
    catalogue.get = () => undefined;
    result = await save({ action: "holding", value: holding });
    assert.equal(result.view.holdings.at(-1)?.instrument.key, instrument.key);
    catalogue.get = originalGet;
    const stale = new MarketService(
      f.db,
      catalogue,
      { ONBOARDING_DATA_KEY: "a".repeat(64) },
      () => new Date("2026-12-01"),
    );
    assert.ok(
      (await stale.check(f.admin, [instrument.key])).reasons.includes(
        "catalogue_stale",
      ),
    );
    await f.query(
      "UPDATE tenant_memberships SET capabilities_json=? WHERE id=?",
      [JSON.stringify({ allow: ["research"], deny: [] }), f.adminMemberId],
    );
    await assert.rejects(service.read(f.admin), /forbidden/);
    await f.query(
      "UPDATE tenant_memberships SET capabilities_json=? WHERE id=?",
      [JSON.stringify({ allow: [], deny: ["research"] }), f.adminMemberId],
    );
    await assert.rejects(service.read(f.admin), /forbidden/);
  } finally {
    f.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("expired instruments, unrelated trades and hold recommendations retain separate restrictions", () => {
  const state = emptyMarket();
  state.declaration = {
    at: now.toISOString(),
    actorId: "owner",
    coveredFrom: "2026-10-15",
  };
  assert.ok(
    publicationCheck(
      state,
      [{ ...instrument, expiry: "2026-11-13" }],
      now,
    ).reasons.includes("expired_instrument"),
  );
  state.recommendations.push({
    id: "hold",
    instrument,
    instrumentKey: instrument.key,
    publishedOn: "2026-10-01",
    direction: "hold",
    audience: "Subscribers",
    rationale: "Valuation review",
    recordedAt: now.toISOString(),
  });
  assert.deepEqual(tradeWarnings(state, instrument, "2026-11-14", "buy"), [
    "hold",
  ]);
  assert.deepEqual(
    tradeWarnings(
      state,
      { ...instrument, key: "OTHER", underlying: "OTHER" },
      "2026-11-14",
      "sell",
    ),
    [],
  );
  indiaDate();
});
