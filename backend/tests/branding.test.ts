import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import {
  PDFDocument,
  PDFRawStream,
  PDFArray,
  decodePDFRawStream,
} from "pdf-lib";
import { readFile } from "node:fs/promises";
import { validateLogo } from "../src/websites/logo";
import { validateSnapshot, digest } from "../../database/snapshots";
import {
  makeTenant,
  makeWebsite,
} from "../../packages/contracts/tests/fixtures";
import {
  letterhead,
  agreementPdf,
  freezeAgreement,
  agreementHash,
  appendConsent,
  publishedLogos,
} from "../src/agreement-pdf";
import { hash, seal, unseal } from "../src/onboarding/domain";
import { onboardingFixture } from "./onboarding-fixture";

/** Construct checksummed PNG fixtures so rejection tests exercise decoding rather than just filename checks. */
function chunk(kind: string, data = Buffer.alloc(0)) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(kind), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([size, payload, checksum]);
}
/** Build a minimal browser-normalized RGBA logo with optional deliberate structural damage. */
function png({
  width = 1,
  height = 1,
  depth = 8,
  type = 6,
  interlace = 0,
  raw = Buffer.from([0, 0, 0, 0, 255]),
  chunks,
  headerLength = 13,
}: {
  width?: number;
  height?: number;
  depth?: number;
  type?: number;
  interlace?: number;
  raw?: Buffer;
  chunks?: Buffer[];
  headerLength?: number;
} = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = type;
  header[12] = interlace;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...(chunks ?? [
      chunk("IHDR", header.subarray(0, headerLength)),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND"),
    ]),
  ]);
}
/** Encode fixture pixels using the same data-URI contract as published website revisions. */
function source(bytes = png()) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

test("logo validation bounds raster decoding and rejects corrupt, animated, remote and executable content", () => {
  assert.deepEqual(validateLogo(source()), png());
  assert.ok(
    validateLogo(source(png({ type: 2, raw: Buffer.from([0, 0, 0, 0]) }))),
  );
  for (const value of [
    "https://example.test/logo.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    source(Buffer.alloc(98305)),
    source(Buffer.alloc(20)),
    source(png().subarray(0, 20)),
    source(png({ width: 513 })),
    source(png({ width: 0 })),
    source(png({ height: 0 })),
    source(png({ height: 513 })),
    source(png({ depth: 16 })),
    source(png({ type: 3 })),
    source(png({ interlace: 1 })),
    source(png({ headerLength: 12 })),
    source(png({ raw: Buffer.from([5, 0, 0, 0, 0]) })),
    source(png({ raw: Buffer.from([0]) })),
    source(png({ raw: Buffer.alloc(10) })),
    source(png({ chunks: [chunk("IDAT")] })),
    source(
      png({
        chunks: [
          chunk("IHDR", png().subarray(16, 29)),
          chunk("IHDR", png().subarray(16, 29)),
        ],
      }),
    ),
    source(
      png({ chunks: [chunk("IHDR", png().subarray(16, 29)), chunk("acTL")] }),
    ),
    source(
      png({ chunks: [chunk("IHDR", png().subarray(16, 29)), chunk("IEND")] }),
    ),
    source(Buffer.concat([png(), Buffer.from([0])])),
  ])
    assert.throws(() => validateLogo(value));
  const corrupt = png();
  corrupt[20] ^= 1;
  assert.throws(() => validateLogo(source(corrupt)));
  const beyond = png();
  beyond.writeUInt32BE(99999, 8);
  assert.throws(() => validateLogo(source(beyond)));
  assert.throws(() => validateLogo(source().replace(/=$/, "A=")));
  const snapshot = {
    schemaVersion: 1,
    publicProfile: makeTenant().profile,
    branding: {
      ...makeWebsite().branding,
      logoLight: source(),
      logoDark: source(),
    },
    layout: makeWebsite().layout,
    languages: makeWebsite().languages,
    content: makeWebsite().content,
  };
  assert.equal(validateSnapshot(snapshot, true).branding.logoLight, source());
  assert.throws(
    () =>
      validateSnapshot({
        ...snapshot,
        branding: { ...snapshot.branding, logoLight: source(corrupt) },
      }),
    /Invalid logo/,
  );
});

const details = {
  name: "Example Legal RA",
  registration: "INH-SAMPLE",
  address: "Example registered address",
  contact: "ra@example.test | +919876543210",
};

test("PDF stationery embeds the original template, repeats identity and keeps frozen agreement pages when consent is appended", async () => {
  const stock = await letterhead(details, "stocksbuddha");
  assert.ok(stock.logo);
  const generic = await letterhead(details, "alpha");
  assert.equal(generic.logo, null);
  assert.equal(
    (await letterhead(details, "alpha", { logoDark: source() })).logo,
    source(),
  );
  assert.equal(
    (
      await letterhead(details, "stocksbuddha", {
        logoLight: null,
        logoDark: null,
      })
    ).logo,
    null,
  );
  assert.equal(
    (await letterhead(details, "alpha", { logoLight: source() })).logo,
    source(),
  );
  await assert.rejects(
    letterhead(details, "alpha", { logoLight: source(Buffer.alloc(20)) }),
  );
  const text =
    "RESEARCH SERVICES AGREEMENT AND MITC\n" +
    "Readable research terms and risks. हिंदी में अनुसंधान की शर्तें।\n".repeat(
      180,
    );
  const frozen = await freezeAgreement(text, stock, true);
  const original = await PDFDocument.load(Buffer.from(frozen.pdf, "base64"));
  assert.ok(original.getPageCount() > 2);
  assert.equal(frozen.sha256, hash(Buffer.from(frozen.pdf, "base64")));
  assert.notEqual(agreementHash(text, frozen), hash(text));
  assert.equal(agreementHash("legacy"), hash("legacy"));
  assert.throws(() => agreementHash("edited", frozen), /integrity/);
  assert.throws(
    () =>
      agreementHash(text, {
        ...frozen,
        pdf: Buffer.from("tampered").toString("base64"),
      }),
    /integrity/,
  );
  const signed = await PDFDocument.load(
    await appendConsent(
      frozen,
      stock,
      "CONSENT RECORD\nExample Investor\nMethod: typed_email_otp",
    ),
  );
  assert.ok(signed.getPageCount() > original.getPageCount());
  const first = original.getPage(0).node.Contents() as PDFArray;
  const retained = signed.getPage(0).node.Contents() as PDFArray;
  assert.deepEqual(
    retained
      .asArray()
      .map((ref) =>
        Buffer.from(
          decodePDFRawStream(
            signed.context.lookup(ref) as PDFRawStream,
          ).decode(),
        ),
      ),
    first
      .asArray()
      .map((ref) =>
        Buffer.from(
          decodePDFRawStream(
            original.context.lookup(ref) as PDFRawStream,
          ).decode(),
        ),
      ),
  );
  const normal = await freezeAgreement(
    "English and हिंदी agreement",
    generic,
    false,
  );
  assert.equal(
    (await PDFDocument.load(Buffer.from(normal.pdf, "base64"))).getPageCount(),
    1,
  );
  assert.equal(
    (
      await PDFDocument.load(
        await agreementPdf("Terms", { ...generic, logo: source() }, "Sample"),
      )
    ).getPageCount(),
    1,
  );
});

test("checkout freezes published logos and PDF bytes; authorization, tampering, later edits and legacy previews are handled", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup();
    const site = makeWebsite();
    const snapshot = {
      schemaVersion: 1,
      publicProfile: makeTenant().profile,
      branding: { ...site.branding, logoLight: source() },
      layout: site.layout,
      languages: site.languages,
      content: site.content,
    };
    await f.query("UPDATE tenants SET published_revision=1 WHERE id=?", [
      f.tenantId,
    ]);
    await f.query(
      "INSERT INTO website_revisions VALUES (?,1,'published',?,?)",
      [f.tenantId, JSON.stringify(snapshot), digest(snapshot)],
    );
    assert.equal((await publishedLogos(f.db, f.tenantId)).logoLight, source());
    const quoted = await f.service.quote(f.investor, {
      planId,
      key: randomUUID(),
    });
    const preview = await f.service.previewAgreement(f.investor, quoted.id);
    assert.equal(
      (await f.service.read(f.investor)).orders[0].pdfHash,
      hash(preview),
    );
    await assert.rejects(
      f.service.previewAgreement(f.other, quoted.id),
      /order_not_found/,
    );
    await assert.rejects(
      f.service.previewAgreement(f.admin, quoted.id),
      /forbidden/,
    );
    assert.ok(
      (await f.service.sampleAgreement(f.admin))
        .subarray(0, 4)
        .equals(Buffer.from("%PDF")),
    );
    await assert.rejects(f.service.sampleAgreement(f.investor), /forbidden/);
    await f.query("UPDATE website_revisions SET snapshot_sha256='broken'");
    await assert.rejects(
      publishedLogos(f.db, f.tenantId),
      /branding_integrity/,
    );
    assert.deepEqual(
      await f.service.previewAgreement(f.investor, quoted.id),
      preview,
    );
    await f.service.sendCode(f.investor, quoted.id);
    const view = (await f.service.read(f.investor)).orders[0];
    await f.service.sign(f.investor, {
      orderId: quoted.id,
      name: f.profile.fullName,
      code: f.messages.at(-1)!.code,
      hash: view.hash,
      consent: true,
    });
    const evidence = await f.service.archive(quoted.id);
    assert.ok(evidence);
    const [row] = await f.query(
      "SELECT snapshot_cipher FROM subscription_orders WHERE id=?",
      [quoted.id],
    );
    const frozen = unseal<{
      text: string;
      document?: unknown;
      letterhead?: unknown;
    }>(f.env.ONBOARDING_DATA_KEY, String(row.snapshot_cipher));
    await f.query(
      "UPDATE subscription_orders SET snapshot_cipher=? WHERE id=?",
      [
        seal(f.env.ONBOARDING_DATA_KEY, { ...frozen, text: "tampered" }),
        quoted.id,
      ],
    );
    await assert.rejects(
      f.service.previewAgreement(f.investor, quoted.id),
      /integrity/,
    );
    delete frozen.document;
    delete frozen.letterhead;
    await f.query(
      "UPDATE subscription_orders SET snapshot_cipher=?,agreement_hash=? WHERE id=?",
      [seal(f.env.ONBOARDING_DATA_KEY, frozen), hash(frozen.text), quoted.id],
    );
    assert.ok(
      (await f.service.previewAgreement(f.investor, quoted.id))
        .subarray(0, 4)
        .equals(Buffer.from("%PDF")),
    );
  } finally {
    f.close();
  }
});

test("sample agreement supports an unconfigured RA without changing settings or granting subscriber access", async () => {
  const f = onboardingFixture();
  try {
    await f.query("UPDATE tenants SET registration_number=NULL WHERE id=?", [
      f.tenantId,
    ]);
    assert.ok((await f.service.sampleAgreement(f.admin)).length > 1000);
    assert.equal((await f.service.read(f.admin)).settings, null);
    const bytes = await readFile(
      new URL(
        "../assets/stocksbuddha-letterhead-v1.pdf",
        import.meta.url,
      ).pathname.replace("/tests/assets/", "/assets/"),
    );
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  } finally {
    f.close();
  }
});

test("fee tables paginate as bounded rows while arbitrary fee clauses remain complete flowing text", async () => {
  const identity = await letterhead(details, "alpha");
  const table =
    "Fees: INR 1000.00\nDiscount: INR 100.00\nTax: INR 162.00\nTotal payable: INR 1062.00\n";
  const pages = await PDFDocument.load(
    await agreementPdf(table.repeat(30), identity, "Pricing"),
  );
  assert.ok(pages.getPageCount() >= 5);
  const prose = await PDFDocument.load(
    await agreementPdf(
      "Fees: " + "Complete RA fee and refund disclosure. ".repeat(500),
      identity,
      "Terms",
    ),
  );
  assert.ok(prose.getPageCount() > 2);
});
