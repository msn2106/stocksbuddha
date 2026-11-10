import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import {
  PDFDocument,
  PDFArray,
  PDFRawStream,
  PDFName,
  PDFDict,
  decodePDFRawStream,
} from "pdf-lib";
import { normalizeSignature, signatureInk } from "../src/onboarding/signature";
import {
  appendConsent,
  freezeAgreement,
  letterhead,
  signatureBox,
  signatureStamp,
} from "../src/agreement-pdf";
import { onboardingFixture } from "./onboarding-fixture";
import { randomUUID } from "node:crypto";
import { hash, seal, unseal } from "../src/onboarding/domain";

/** Encode actual PNG scanline filters with both RGB and alpha pixels for signature validation. */
function image(filter = 0, alpha = true, blank = false, transparent = false) {
  const width = 8,
    height = 3,
    channels = alpha ? 4 : 3,
    rows: Buffer[] = [];
  let previous = Buffer.alloc(width * channels);
  for (let y = 0; y < height; y++) {
    const row = Buffer.from(
      Array.from({ length: width * channels }, (_, x) =>
        x % channels === 3
          ? transparent
            ? 0
            : 255
          : blank
            ? 255
            : (x * 27 + y * 33) % 200,
      ),
    );
    const encoded = Buffer.alloc(row.length + 1);
    encoded[0] = filter;
    for (let x = 0; x < row.length; x++) {
      const a = x >= channels ? row[x - channels] : 0,
        b = previous[x],
        c = x >= channels ? previous[x - channels] : 0;
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? Math.floor((a + b) / 2)
                : pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c;
      encoded[x + 1] = (row[x] - predictor) & 255;
    }
    rows.push(encoded);
    previous = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  const chunks = [
    ["IHDR", header],
    ["IDAT", deflateSync(Buffer.concat(rows))],
    ["IEND", Buffer.alloc(0)],
  ] as const;
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks.map(([type, data]) => {
      const size = Buffer.alloc(4),
        sum = Buffer.alloc(4),
        content = Buffer.concat([Buffer.from(type), data]);
      size.writeUInt32BE(data.length);
      sum.writeUInt32BE(crc32(content));
      return Buffer.concat([size, content, sum]);
    }),
  ]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

test("signature validation accepts real ink for every PNG filter and rejects blank, corrupt, remote and oversized selections", () => {
  assert.deepEqual(normalizeSignature(undefined), {
    mode: "typed",
    font: "formal",
  });
  for (const font of ["allura", "caveat", "formal"])
    assert.deepEqual(normalizeSignature({ mode: "typed", font }), {
      mode: "typed",
      font,
    });
  for (const filter of [0, 1, 2, 3, 4])
    for (const alpha of [true, false])
      for (const mode of ["draw", "upload"])
        assert.equal(
          normalizeSignature({ mode, image: image(filter, alpha) }).mode,
          mode,
        );
  for (const value of [
    null,
    {},
    { mode: "typed", font: "remote" },
    { mode: "draw", image: image(0, true, true) },
    { mode: "upload", image: "https://external.test/sign.png" },
    { mode: "draw", image: "x".repeat(140000) },
    { mode: "upload", image: "data:image/png;base64,AAAA" },
  ])
    assert.throws(() => normalizeSignature(value), /invalid_signature/);
  assert.throws(
    () =>
      normalizeSignature({
        mode: "upload",
        image: image(0, true, false, true),
      }),
    /invalid_signature/,
  );
  assert.equal(
    signatureInk(Buffer.from(image(0, false, true).split(",")[1], "base64")),
    false,
  );
});

test("every frozen agreement and appended consent page receives a signature while original content streams survive", async () => {
  const identity = await letterhead(
    {
      name: "Example RA",
      registration: "INH123",
      address: "Mumbai",
      contact: "ra@example.test",
    },
    "stocksbuddha",
  );
  const frozen = await freezeAgreement(
    "AGREEMENT AND MITC\n" +
      "Terms of research service, no assurance of returns.\n".repeat(100),
    identity,
    false,
  );
  const original = await PDFDocument.load(Buffer.from(frozen.pdf, "base64"));
  assert.ok(original.getPageCount() > 1);
  assert.equal(signatureBox(identity).y, 686);
  assert.ok(
    signatureBox({
      ...identity,
      margins: { top: 56, bottom: 30, left: 20, right: 30 },
    }).x < signatureBox(identity).x,
  );
  for (const mark of [
    { mode: "typed", font: "allura" },
    { mode: "typed", font: "caveat" },
    { mode: "typed", font: "formal" },
    { mode: "upload", image: image() },
    { mode: "draw", image: image() },
  ] as const) {
    const signed = await PDFDocument.load(
      await appendConsent(
        frozen,
        identity,
        "CONSENT RECORD\nEmail OTP verified",
        { name: "Example Investor", mark },
      ),
    );
    assert.ok(signed.getPageCount() > original.getPageCount());
    for (const page of signed.getPages()) {
      const streams = page.node.Contents() as PDFArray;
      const text = streams
        .asArray()
        .map((ref) =>
          Buffer.from(
            decodePDFRawStream(
              signed.context.lookup(ref) as PDFRawStream,
            ).decode(),
          ).toString(),
        )
        .join("");
      assert.match(text, /EmbeddedPdfPage/);
      const objects = page.node
        .Resources()!
        .lookup(PDFName.of("XObject"), PDFDict);
      const stamps = objects.values().filter((ref) => {
        const object = signed.context.lookup(ref) as PDFRawStream;
        return (
          object.dict
            .lookupMaybe(PDFName.of("BBox"), PDFArray)
            ?.asArray()
            .map((value) => value.toString())
            .join(",") === "0,0,180,54"
        );
      });
      assert.equal(
        stamps.length,
        1,
        "every page must contain the separate bounded signature stamp",
      );
    }
    const before = (original.getPage(0).node.Contents() as PDFArray)
      .asArray()
      .map((ref) =>
        Buffer.from(
          decodePDFRawStream(
            original.context.lookup(ref) as PDFRawStream,
          ).decode(),
        ).toString(),
      );
    const after = (signed.getPage(0).node.Contents() as PDFArray)
      .asArray()
      .map((ref) =>
        Buffer.from(
          decodePDFRawStream(
            signed.context.lookup(ref) as PDFRawStream,
          ).decode(),
        ).toString(),
      );
    for (const content of before) assert.ok(after.includes(content));
  }
  assert.ok(
    (await signatureStamp("हिंदी नाम", { mode: "typed", font: "allura" }))
      .length > 1000,
  );
  assert.ok(
    (
      await signatureStamp("A very long investor name ".repeat(5), {
        mode: "typed",
        font: "formal",
      })
    ).length > 1000,
  );
});

test("email codes remain required for artwork; encrypted evidence freezes its hash and rejects tampering", async () => {
  for (const mode of ["upload", "draw", "typed"] as const) {
    const f = onboardingFixture();
    try {
      const { planId } = await f.setup();
      const quote = await f.service.quote(f.investor, {
        planId,
        key: randomUUID(),
      });
      const order = (await f.service.read(f.investor)).orders[0];
      assert.ok(order.signatureBox);
      const mark =
        mode === "typed" ? { mode, font: "caveat" } : { mode, image: image() };
      const input = {
        orderId: quote.id,
        name: f.profile.fullName,
        consent: true,
        hash: order.hash,
        mark,
      };
      await assert.rejects(
        f.service.sign(f.investor, input),
        /invalid_or_expired_code/,
      );
      await f.service.sendCode(f.investor, quote.id);
      const code = [...f.messages]
        .reverse()
        .find((value) => value.kind === "signing")!.code;
      await assert.rejects(
        f.service.sign(f.investor, { ...input, code, mark: null }),
        /invalid_signature/,
      );
      await f.service.sign(f.investor, { ...input, code });
      const [row] = await f.query(
        "SELECT signature_cipher FROM subscription_orders WHERE id=?",
        [quote.id],
      );
      const signature = unseal<Record<string, unknown>>(
        f.env.ONBOARDING_DATA_KEY,
        String(row.signature_cipher),
      );
      assert.deepEqual(signature.mark, mark);
      assert.equal(signature.markSha256, hash(JSON.stringify(mark)));
      assert.equal(
        signature.stampSha256,
        hash(Buffer.from(String(signature.stamp), "base64")),
      );
      await f.query(
        "UPDATE subscription_orders SET agreement_id=NULL,signature_cipher=? WHERE id=?",
        [
          seal(f.env.ONBOARDING_DATA_KEY, {
            ...signature,
            markSha256: "tampered",
          }),
          quote.id,
        ],
      );
      await assert.rejects(
        f.service.archive(quote.id),
        /agreement_integrity_failed/,
      );
      await f.query(
        "UPDATE subscription_orders SET signature_cipher=? WHERE id=?",
        [
          seal(f.env.ONBOARDING_DATA_KEY, {
            ...signature,
            stampSha256: "tampered",
          }),
          quote.id,
        ],
      );
      await assert.rejects(
        f.service.archive(quote.id),
        /agreement_integrity_failed/,
      );
    } finally {
      f.close();
    }
  }
});

test("older frozen layouts retain email consent and require a fresh checkout for visual artwork", async () => {
  const f = onboardingFixture();
  try {
    const { planId } = await f.setup();
    const quote = await f.service.quote(f.investor, {
      planId,
      key: randomUUID(),
    });
    const [row] = await f.query(
      "SELECT snapshot_cipher FROM subscription_orders WHERE id=?",
      [quote.id],
    );
    const snapshot = unseal<{
      text: string;
      document: import("../src/agreement-pdf").FrozenAgreement;
    }>(f.env.ONBOARDING_DATA_KEY, String(row.snapshot_cipher));
    snapshot.document.layoutVersion = "stocksbuddha-v1";
    const { agreementHash } = await import("../src/agreement-pdf");
    const digest = agreementHash(snapshot.text, snapshot.document);
    await f.query(
      "UPDATE subscription_orders SET snapshot_cipher=?,agreement_hash=? WHERE id=?",
      [seal(f.env.ONBOARDING_DATA_KEY, snapshot), digest, quote.id],
    );
    assert.equal(
      (await f.service.read(f.investor)).orders[0].signatureBox,
      undefined,
    );
    await f.service.sendCode(f.investor, quote.id);
    const code = [...f.messages]
      .reverse()
      .find((value) => value.kind === "signing")!.code;
    const input = {
      orderId: quote.id,
      name: f.profile.fullName,
      code,
      hash: digest,
      consent: true,
    };
    await assert.rejects(
      f.service.sign(f.investor, {
        ...input,
        mark: { mode: "typed", font: "allura" },
      }),
      /signature_checkout_required/,
    );
    await f.service.sign(f.investor, input);
    assert.equal((await f.service.read(f.investor)).orders[0].status, "signed");
  } finally {
    f.close();
  }
});
