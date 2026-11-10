import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees, PDFName } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  normalizeLetterhead,
  defaultLetterheadMargins,
} from "../src/onboarding/letterhead";
import {
  letterhead,
  agreementPdf,
  freezeAgreement,
  appendConsent,
} from "../src/agreement-pdf";
import { onboardingFixture } from "./onboarding-fixture";
import { unseal } from "../src/onboarding/domain";

/** Construct real PDFs with optional unsafe document-level scripts or unsupported page shapes. */
async function pdf({
  pages = 1,
  width = 595.276,
  height = 841.89,
  rotation = 0,
  script = false,
} = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([width, height]);
    page.drawText("ALPHA RA LETTERHEAD", { x: 50, y: 790, size: 14 });
    page.setRotation(degrees(rotation));
  }
  if (script) doc.addJavaScript("unsafe", "app.alert('untrusted')");
  return `data:application/pdf;base64,${Buffer.from(await doc.save()).toString("base64")}`;
}
const input = {
  version: 0,
  name: "alpha.pdf",
  margins: defaultLetterheadMargins,
};
const details = {
  name: "Alpha Legal RA",
  registration: "INH-TEST",
  address: "Example address",
  contact: "ra@example.test",
};

test("letterhead PDFs are single A4 pages with bounded validated settings and no document-level JavaScript", async () => {
  const value = await normalizeLetterhead({
    ...input,
    pdf: await pdf({ script: true }),
  });
  assert.ok(value.pdf && value.sha256);
  const clean = await PDFDocument.load(
    Buffer.from(value.pdf.split(",")[1], "base64"),
  );
  assert.equal(clean.getPageCount(), 1);
  assert.equal(clean.catalog.get(PDFName.of("Names")), undefined);
  assert.equal(clean.getPage(0).node.Annots()?.size() ?? 0, 0);
  assert.equal((await normalizeLetterhead({ ...input, pdf: null })).pdf, null);
  for (const bad of [
    null,
    {},
    { ...input, pdf: "https://foreign.test/template.pdf" },
    { ...input, pdf: "data:application/pdf;base64,A==" },
    { ...input, pdf: "data:application/pdf;base64,aGVsbG8=" },
    {
      ...input,
      pdf: `data:application/pdf;base64,${Buffer.alloc(2097153).toString("base64")}`,
    },
    { ...input, pdf: await pdf({ pages: 2 }) },
    { ...input, pdf: await pdf({ pages: 0 }) },
    { ...input, pdf: await pdf({ width: 800 }) },
    { ...input, pdf: await pdf({ height: 600 }) },
    { ...input, pdf: await pdf({ rotation: 90 }) },
    { ...input, name: "", pdf: await pdf() },
    { ...input, pdf: await pdf(), margins: { ...input.margins, top: 101 } },
    { ...input, pdf: await pdf(), version: -1 },
    { ...input, pdf: await pdf(), unexpected: true },
  ])
    await assert.rejects(normalizeLetterhead(bad), /invalid_letterhead/);
  const corrupt = `data:application/pdf;base64,${Buffer.from("%PDF-1.7 broken").toString("base64")}`;
  await assert.rejects(
    normalizeLetterhead({ ...input, pdf: corrupt }),
    /invalid_letterhead/,
  );
});

test("uploaded stationery is frozen into each agreement with custom margins and reused on appended consent pages", async () => {
  const settings = {
    ...(await normalizeLetterhead({ ...input, pdf: await pdf() })),
    version: 1,
  };
  const identity = await letterhead(details, "alpha", {}, settings);
  assert.match(identity.version, /uploaded-1-/);
  assert.equal(identity.background, settings.pdf);
  const frozen = await freezeAgreement(
    "RESEARCH TERMS\n" + "Client research terms and disclosures.\n".repeat(200),
    identity,
    false,
  );
  const before = await PDFDocument.load(Buffer.from(frozen.pdf, "base64"));
  assert.ok(before.getPageCount() > 2);
  assert.equal(
    (
      await PDFDocument.load(
        await appendConsent(frozen, identity, "CONSENT RECORD"),
      )
    ).getPageCount(),
    before.getPageCount() + 1,
  );
  const fees = await agreementPdf(
    "Fees: INR 100.00\nTax: INR 0.00\n".repeat(60),
    identity,
    "Fees",
  );
  assert.ok((await PDFDocument.load(fees)).getPageCount() > 3);
  await assert.rejects(
    letterhead(details, "alpha", {}, { ...settings, sha256: "broken" }),
    /letterhead_integrity/,
  );
});

test("RA Admin saves, versions, previews and resets only their own letterhead; later updates cannot change frozen checkouts", async () => {
  const f = onboardingFixture();
  try {
    assert.equal((await f.service.letterheadSettings(f.admin)).version, 0);
    await assert.rejects(f.service.letterheadSettings(f.investor), /forbidden/);
    await assert.rejects(
      f.service.letterheadSettings({ ...f.admin, tenantId: f.otherTenantId }),
      /forbidden/,
    );
    await assert.rejects(
      f.service.letterheadSettings(f.admin, {}),
      /invalid_letterhead/,
    );
    const source = await pdf();
    const unsaved = await f.service.sampleAgreement(f.admin, {
      ...input,
      pdf: source,
    });
    assert.ok(unsaved.length > 1000);
    assert.equal((await f.service.letterheadSettings(f.admin)).version, 0);
    const saved = await f.service.letterheadSettings(f.admin, {
      ...input,
      pdf: source,
    });
    assert.equal(saved.version, 1);
    await assert.rejects(
      f.service.letterheadSettings(f.admin, { ...input, pdf: source }),
      /version_conflict/,
    );
    const { planId } = await f.setup();
    const order = await f.service.quote(f.investor, {
      planId,
      key: randomUUID(),
    });
    const before = await f.service.previewAgreement(f.investor, order.id);
    const [row] = await f.query(
      "SELECT snapshot_cipher FROM subscription_orders WHERE id=?",
      [order.id],
    );
    const snapshot = unseal<{
      letterhead: { background: string; version: string };
    }>(f.env.ONBOARDING_DATA_KEY, String(row.snapshot_cipher));
    assert.equal(snapshot.letterhead.background, saved.pdf);
    const reset = await f.service.letterheadSettings(f.admin, {
      ...input,
      version: 1,
      pdf: null,
    });
    assert.equal(reset.version, 2);
    assert.equal(reset.pdf, null);
    assert.deepEqual(
      await f.service.previewAgreement(f.investor, order.id),
      before,
    );
    assert.ok((await f.service.sampleAgreement(f.admin)).length > 1000);
  } finally {
    f.close();
  }
});

test("Stocks Buddha uses the user's supplied default and returns to it after an uploaded replacement is removed", async () => {
  const f = onboardingFixture();
  try {
    await f.query("UPDATE tenants SET slug='stocksbuddha' WHERE id=?", [
      f.tenantId,
    ]);
    const original = await readFile(
      new URL("../../docs/STOCKS BUDDHA PDF.pdf", import.meta.url),
    );
    assert.deepEqual(
      original,
      await readFile(
        new URL("../assets/stocksbuddha-letterhead-v1.pdf", import.meta.url),
      ),
    );
    const empty = await f.service.letterheadSettings(f.admin);
    assert.equal(
      (await letterhead(details, "stocksbuddha", {}, empty)).version,
      "stocksbuddha-v1",
    );
    const saved = await f.service.letterheadSettings(f.admin, {
      ...input,
      pdf: await pdf(),
    });
    assert.match(
      (await letterhead(details, "stocksbuddha", {}, saved)).version,
      /uploaded/,
    );
    const reset = await f.service.letterheadSettings(f.admin, {
      ...input,
      version: 1,
      pdf: null,
    });
    assert.equal(
      (await letterhead(details, "stocksbuddha", {}, reset)).version,
      "stocksbuddha-v1",
    );
  } finally {
    f.close();
  }
});
