import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { ResearchDraft } from "@ra/contracts";
import { onboardingFixture } from "./onboarding-fixture";
import { ResearchService } from "../src/research/service";
import { MarketService } from "../src/market/service";
import { InstrumentCatalogue, importCatalogue } from "../src/market/catalogue";
/** Create isolated persistence, instruments, declarations and a single paid subscriber without external services. */
export async function researchFixture() {
  const f = onboardingFixture(),
    dir = await mkdtemp(path.join(tmpdir(), "research-"));
  let clock = new Date("2026-11-17T06:00:00Z");
  const raw = {
    segment: "NSE_EQ",
    exchange: "NSE",
    instrument_key: "NSE_EQ|INE1",
    name: "Example Industries",
    trading_symbol: "EXAMPLE",
    instrument_type: "EQ",
    lot_size: 1,
    tick_size: 5,
  };
  await importCatalogue(
    dir,
    [
      {
        bytes: gzipSync(
          JSON.stringify([
            raw,
            { ...raw, instrument_key: "NSE_EQ|INE2", trading_symbol: "SECOND" },
            ...["CE", "PE", "FUT"].map((type, n) => ({
              ...raw,
              segment: "NSE_FO",
              instrument_key: `NSE_FO|${n}`,
              instrument_type: type,
              underlying_key: raw.instrument_key,
              expiry: Date.parse("2026-12-31"),
              strike_price: 100,
              lot_size: 50,
            })),
          ]),
        ),
        modified: clock.toUTCString(),
      },
    ],
    clock,
  );
  const { planId } = await f.setup(),
    orderId = randomUUID();
  await f.query(
    "INSERT INTO subscription_orders(id,tenant_id,membership_id,plan_id,status,starts_at,ends_at,agreement_id,dev) VALUES (?,?,?,?,'paid',?,?,?,0)",
    [
      orderId,
      f.tenantId,
      f.memberId,
      planId,
      "2026-11-01",
      "2026-12-01",
      randomUUID(),
    ],
  );
  for (const offering of ["equity", "futures", "options", "hedges"])
    await f.query(
      "INSERT INTO research_order_offerings(tenant_id,order_id,offering) VALUES (?,?,?)",
      [f.tenantId, orderId, offering],
    );
  const catalogue = new InstrumentCatalogue(dir),
    service = new ResearchService(f.db, catalogue, f.env, f.drive, () => clock),
    market = new MarketService(f.db, catalogue, f.env, () => clock);
  await market.mutate(f.admin, {
    action: "declare",
    version: 0,
    coveredFrom: "2026-10-18",
    confirmed: true,
  });
  const draft: ResearchDraft = {
    title: "Example swing research",
    offering: "equity",
    validUntil: "2026-11-30T12:00:00Z",
    rationale: "Cash flow analysis and valuation support this research view.",
    disclosures:
      "No financial interest or compensation; no material conflicts declared.",
    aiDisclosure: "No AI tools used.",
    attachmentIds: [],
    audience: { mode: "all", ids: [] },
    legs: [
      {
        instrumentKey: raw.instrument_key,
        side: "buy",
        quantity: 10,
        horizon: "swing",
        entryMin: 100,
        entryMax: 105,
        stopLoss: 95,
        targets: [120, 130],
        rationale: "Cash flow outlook supports the proposed entry.",
        note: "",
      },
    ],
  };
  return {
    ...f,
    service,
    market,
    catalogue,
    draft,
    planId,
    orderId,
    setClock: (d: Date) => {
      clock = d;
    },
    cleanup: async () => {
      f.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
