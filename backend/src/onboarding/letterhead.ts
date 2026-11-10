import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import type { LetterheadSettings } from "@ra/contracts";
import { hash, requireValue } from "./domain";

export const defaultLetterheadMargins = {
  top: 56,
  bottom: 20,
  left: 21,
  right: 21,
};
export const letterheadInputSchema = z
  .object({
    version: z.number().int().min(0),
    name: z.string().trim().max(120),
    pdf: z.string().max(2800000).nullable(),
    margins: z
      .object({
        top: z.number().int().min(15).max(100),
        bottom: z.number().int().min(15).max(75),
        left: z.number().int().min(10).max(40),
        right: z.number().int().min(10).max(40),
      })
      .strict(),
  })
  .strict();

/** Validate a single portrait A4 page and retain only its printable page content, excluding scripts, forms and attachments. */
export async function normalizeLetterhead(
  input: unknown,
): Promise<Omit<LetterheadSettings, "version">> {
  const parsed = letterheadInputSchema.safeParse(input);
  requireValue(parsed.success, "invalid_letterhead", 422);
  const { pdf, name, margins } = parsed.data;
  if (pdf === null)
    return {
      name: "",
      pdf: null,
      sha256: null,
      margins: defaultLetterheadMargins,
    };
  requireValue(name.length > 0, "invalid_letterhead", 422);
  const match = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    pdf,
  );
  requireValue(match, "invalid_letterhead", 422);
  const bytes = Buffer.from(match[1], "base64");
  requireValue(
    bytes.length <= 2 * 1024 * 1024 &&
      bytes.toString("base64") === match[1] &&
      bytes.subarray(0, 5).toString() === "%PDF-",
    "invalid_letterhead",
    422,
  );
  try {
    const source = await PDFDocument.load(bytes);
    requireValue(source.getPageCount() === 1, "invalid_letterhead", 422);
    const page = source.getPage(0),
      { width, height } = page.getSize();
    requireValue(
      Math.abs(width - 595.276) < 2 &&
        Math.abs(height - 841.89) < 2 &&
        page.getRotation().angle === 0,
      "invalid_letterhead",
      422,
    );
    const clean = await PDFDocument.create();
    const [background] = await clean.embedPages([page]);
    clean.addPage([595.276, 841.89]).drawPage(background);
    const result = Buffer.from(await clean.save());
    requireValue(result.length <= 2 * 1024 * 1024, "invalid_letterhead", 422);
    return {
      name,
      pdf: `data:application/pdf;base64,${result.toString("base64")}`,
      sha256: hash(result),
      margins,
    };
  } catch {
    requireValue(false, "invalid_letterhead", 422);
  }
}
