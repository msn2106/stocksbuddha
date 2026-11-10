import { readFile } from "node:fs/promises";
import PDFKit from "pdfkit";
import { PDFDocument } from "pdf-lib";
import { hash, requireValue } from "./onboarding/domain";
import { agreement } from "./onboarding/domain";
import { sampleResearchAgreement } from "@ra/contracts";
import { validateLogo } from "./websites/logo";
import type { EntityManager } from "typeorm";
import type { SignatureMark, SignatureBox } from "@ra/contracts";
import { normalizeSignature } from "./onboarding/signature";
import type { BrandLogos } from "@ra/contracts";
import type { LetterheadSettings, LetterheadMargins } from "@ra/contracts";
import { digest, validateSnapshot } from "../../database/snapshots";

export type Letterhead = {
  version: string;
  background?: string;
  margins?: LetterheadMargins;
  name: string;
  registration: string;
  address: string;
  contact: string;
  logo: string | null;
};
export type FrozenAgreement = {
  pdf: string;
  sha256: string;
  textSha256: string;
  layoutVersion: string;
};

/** Read only the published tenant revision and reject damaged branding before generating evidence. */
export async function publishedLogos(
  manager: Pick<EntityManager, "query">,
  tenantId: string,
): Promise<BrandLogos> {
  const [row] = await manager.query(
    "SELECT w.snapshot_json,w.snapshot_sha256 FROM tenants t JOIN website_revisions w ON w.tenant_id=t.id AND w.revision=t.published_revision WHERE t.id=? AND w.status='published'",
    [tenantId],
  );
  if (!row) return {};
  const snapshot =
    typeof row.snapshot_json === "string"
      ? JSON.parse(row.snapshot_json)
      : row.snapshot_json;
  requireValue(
    digest(snapshot) === row.snapshot_sha256,
    "branding_integrity_failed",
    409,
  );
  return validateSnapshot(snapshot, true).branding;
}

/** Freeze published artwork alongside the canonical legal identity; draft website edits never affect a checkout. */
export async function letterhead(
  input: Pick<Letterhead, "name" | "registration" | "address" | "contact">,
  slug: string,
  logos: { logoLight?: string | null; logoDark?: string | null } = {},
  stationery?: LetterheadSettings,
): Promise<Letterhead> {
  const custom = logos.logoLight !== undefined || logos.logoDark !== undefined;
  const logo = custom
    ? logos.logoLight || logos.logoDark || null
    : slug === "stocksbuddha"
      ? `data:image/png;base64,${(await readFile(new URL("../assets/stocksbuddha-light.png", import.meta.url))).toString("base64")}`
      : null;
  if (custom && logo) validateLogo(logo);
  if (stationery?.pdf) {
    requireValue(
      hash(Buffer.from(stationery.pdf.split(",")[1], "base64")) ===
        stationery.sha256,
      "letterhead_integrity_failed",
      409,
    );
    return {
      ...input,
      logo,
      version: `uploaded-${stationery.version}-${stationery.sha256!.slice(0, 12)}`,
      background: stationery.pdf,
      margins: stationery.margins,
    };
  }
  return {
    ...input,
    logo,
    version: slug === "stocksbuddha" ? "stocksbuddha-v1" : "standard-v1",
  };
}

/** Format canonical fee rows as a two-column table and distinguish section headings without interpreting markup. */
function legalText(doc: PDFKit.PDFDocument, text: string) {
  const left = doc.page.margins.left,
    width = doc.page.width - left - doc.page.margins.right;
  for (const line of text.split("\n")) {
    const fee = /^(Fees|Discount|Tax|Total payable): (INR \d+\.\d{2})$/.exec(
      line,
    );
    if (fee) {
      const space = fee[1] === "Fees" ? 96 : 24;
      if (doc.y + space > doc.page.height - doc.page.margins.bottom)
        doc.addPage();
      const y = doc.y;
      doc
        .fontSize(10)
        .text(`${fee[1]}:`, left, y, { width: width * 0.6, height: 20 });
      doc.text(fee[2], left + width * 0.6, y, {
        width: width * 0.4,
        height: 20,
        align: "right",
      });
      doc
        .moveTo(left, y + 20)
        .lineTo(left + width, y + 20)
        .strokeColor("#cccccc")
        .stroke();
      doc.x = left;
      doc.y = y + 24;
    } else {
      const heading =
        /^[A-Z][A-Z0-9 /:;,.()-]{4,100}$/.test(line) ||
        /^\d+\. .{1,100}$/.test(line);
      if (heading && doc.y + 60 > doc.page.height - doc.page.margins.bottom)
        doc.addPage();
      doc
        .fontSize(heading ? 11 : 10)
        .text(line || " ", left, doc.y, { width, lineGap: 4 });
    }
  }
}

/** Lay out selectable agreement text between repeated identity headers and fixed disclosure footers. */
async function contentPdf(
  text: string,
  identity: Letterhead,
  label: string,
): Promise<Buffer> {
  const font = await readFile(
    new URL("../assets/NotoSansDevanagari.ttf", import.meta.url),
  );
  const mm = 72 / 25.4;
  const margins = identity.margins
    ? {
        top: identity.margins.top * mm,
        bottom: identity.margins.bottom * mm + 160,
        left: identity.margins.left * mm,
        right: identity.margins.right * mm,
      }
    : { top: 158, bottom: 170, left: 60, right: 60 };
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({
      size: "A4",
      margins,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("Legal", font);
    doc.font("Legal").fillColor("#222222");
    legalText(doc, text);
    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index++) {
      doc.switchToPage(index);
      doc.page.margins.bottom = 0;
      const left = margins.left,
        width = doc.page.width - left - margins.right;
      const footerY = identity.background
        ? doc.page.height - margins.bottom + 74
        : 750;
      if (!identity.background) {
        // Clear Canva's platform identity before placing this agreement's frozen RA identity.
        doc.rect(40, 30, 515, 98).fill("white");
        if (identity.logo)
          doc.image(identity.logo, 60, 44, {
            fit: [54, 54],
            align: "center",
            valign: "center",
          });
        const x = identity.logo ? 126 : 60;
        doc
          .fillColor("#222222")
          .font("Legal")
          .fontSize(12)
          .text(identity.name, x, 43, {
            width: 407 - (x - 60),
            height: 30,
            ellipsis: true,
          });
        doc
          .fontSize(9)
          .text(`SEBI Registration: ${identity.registration}`, x, 76, {
            width: 407,
            height: 14,
          });
        doc
          .fontSize(8)
          .text(`${identity.address}\n${identity.contact}`, x, 91, {
            width: 407,
            height: 35,
            ellipsis: true,
          });
        doc.moveTo(60, 135).lineTo(535, 135).strokeColor("#333333").stroke();
      } else {
        doc
          .fontSize(8)
          .fillColor("#222222")
          .text(
            `${identity.name} | SEBI: ${identity.registration}`,
            left,
            footerY,
            { width, height: 16, ellipsis: true },
          );
      }
      doc
        .moveTo(left, footerY - 8)
        .lineTo(left + width, footerY - 8)
        .lineWidth(0.6)
        .strokeColor("#777777")
        .stroke();
      doc
        .fontSize(8)
        .fillColor("#555555")
        .text(
          `${label} | ${identity.version} | Page ${index + 1} of ${pages.count}`,
          left,
          identity.background ? footerY + 18 : footerY,
          { width, height: 14 },
        );
      doc
        .fontSize(10)
        .text(
          "Registration granted by SEBI, enlistment with BSE and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors.",
          left,
          identity.background ? footerY + 36 : 770,
          { width, height: 43 },
        );
    }
    doc.end();
  });
}

/** Preserve the supplied vector PDF stationery underneath each page while replacing its platform header. */
export async function agreementPdf(
  text: string,
  identity: Letterhead,
  label: string,
): Promise<Buffer> {
  const content = await contentPdf(text, identity, label);
  if (identity.version === "standard-v1") return content;
  const result = await PDFDocument.create();
  const [background] = await result.embedPdf(
    identity.background
      ? Buffer.from(identity.background.split(",")[1], "base64")
      : await readFile(
          new URL("../assets/stocksbuddha-letterhead-v1.pdf", import.meta.url),
        ),
    [0],
  );
  const overlay = await PDFDocument.load(content);
  const overlays = await result.embedPages(overlay.getPages());
  for (const page of overlays) {
    const sheet = result.addPage([595.276, 841.89]);
    sheet.drawPage(background);
    sheet.drawPage(page);
  }
  return Buffer.from(await result.save());
}

/** Persist the actual unsigned PDF and its digest before asking for consent. */
export async function freezeAgreement(
  text: string,
  identity: Letterhead,
  development: boolean,
): Promise<FrozenAgreement> {
  const bytes = await agreementPdf(
    `${development ? "DEVELOPMENT / SANDBOX EVIDENCE\n\n" : ""}${text}`,
    identity,
    "Research services agreement and MITC",
  );
  return {
    pdf: bytes.toString("base64"),
    sha256: hash(bytes),
    textSha256: hash(text),
    layoutVersion: `${identity.version}:signature-v2`,
  };
}

/** Bind consent to both the legal text and the immutable PDF, retaining legacy text-only agreements. */
export function agreementHash(
  text: string,
  document?: FrozenAgreement,
): string {
  if (!document) return hash(text);
  requireValue(
    hash(Buffer.from(document.pdf, "base64")) === document.sha256 &&
      hash(text) === document.textSha256,
    "agreement_integrity_failed",
    409,
  );
  return hash(
    `${document.textSha256}:${document.sha256}:${document.layoutVersion}`,
  );
}

/** Append consent evidence and stamp reserved signature areas while retaining the frozen agreement content streams. */
export async function appendConsent(
  document: FrozenAgreement,
  identity: Letterhead,
  record: string,
  signature?: { name: string; mark: SignatureMark; stamp?: string },
): Promise<Buffer> {
  const result = await PDFDocument.load(Buffer.from(document.pdf, "base64"));
  const evidence = await PDFDocument.load(
    await agreementPdf(
      `${record}\nUnsigned PDF SHA-256: ${document.sha256}\nThis records verified-name and email-code consent. It is not a certificate-based digital signature.`,
      identity,
      "Consent record",
    ),
  );
  for (const page of await result.copyPages(
    evidence,
    evidence.getPageIndices(),
  ))
    result.addPage(page);
  if (signature && document.layoutVersion.endsWith(":signature-v2")) {
    const stamp = await result.embedPdf(
      signature.stamp
        ? Buffer.from(signature.stamp, "base64")
        : await signatureStamp(signature.name, signature.mark),
    );
    const box = signatureBox(identity);
    for (const page of result.getPages())
      page.drawPage(stamp[0], {
        x: box.x,
        y: page.getHeight() - box.y - box.height,
        width: box.width,
        height: box.height,
      });
  }
  return Buffer.from(await result.save());
}

/** Position the signature above the footer divider within the new layout's reserved area (PDF top-origin points). */
export function signatureBox(identity: Letterhead): SignatureBox {
  const mm = 72 / 25.4;
  const footer = identity.margins
    ? 841.89 - identity.margins.bottom * mm - 86
    : 750;
  return {
    x: 595.276 - (identity.margins ? identity.margins.right * mm : 60) - 180,
    y: footer - 64,
    width: 180,
    height: 54,
  };
}

/** Render a bounded signature stamp with the same bundled fonts used by the browser preview. */
export async function signatureStamp(
  name: string,
  input: SignatureMark,
): Promise<Buffer> {
  const mark = normalizeSignature(input);
  const legal = await readFile(
    new URL("../assets/NotoSansDevanagari.ttf", import.meta.url),
  );
  const font =
    mark.mode === "typed" &&
    mark.font !== "formal" &&
    /^[\u0020-\u024f]+$/.test(name)
      ? await readFile(
          new URL(`../assets/signature-${mark.font}.ttf`, import.meta.url),
        )
      : legal;
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ size: [180, 54], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("Signature", font).registerFont("Legal", legal);
    if (mark.mode === "typed") {
      doc.font("Signature").fontSize(28);
      const size = Math.min(
        28,
        (28 * 176) / Math.max(1, doc.widthOfString(name)),
      );
      doc.fontSize(size).text(name, 2, 2, {
        width: 176,
        height: 39,
        align: "right",
        lineBreak: false,
      });
    } else
      doc.image(mark.image, 2, 0, {
        fit: [176, 38],
        align: "right",
        valign: "center",
      });
    doc.font("Legal").fontSize(7).text("Investor signature", 2, 43, {
      width: 176,
      height: 10,
      align: "right",
    });
    doc.end();
  });
}

/** Render conspicuously unsigned sample stationery using synthetic client, offering and fee values only. */
export async function sampleAgreement(
  identity: Letterhead,
  terms = sampleResearchAgreement,
): Promise<Buffer> {
  const values = {
    raName: identity.name,
    registration: identity.registration,
    contact: identity.contact,
    address: identity.address,
    clientName: "Sample Investor",
    clientEmail: "investor@example.test",
    clientPan: "SAMPLE ONLY",
    clientDob: "1990-01-01",
    clientPhone: "SAMPLE ONLY",
    planName: "Sample research plan",
    offering: "Illustrative research reports",
    days: "30",
    subtotal: "INR 1000.00",
    discount: "INR 0.00",
    tax: "INR 0.00",
    total: "INR 1000.00",
    date: "SAMPLE",
    orderId: "SAMPLE - NOT AN ORDER",
  };
  return agreementPdf(
    `SAMPLE - NOT FOR SIGNING\nIllustrative layout; not an approved agreement or offer.\n\n${agreement(terms, values)}`,
    identity,
    "SAMPLE - NOT FOR SIGNING",
  );
}
