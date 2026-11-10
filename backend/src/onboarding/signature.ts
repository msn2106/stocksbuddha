import { inflateSync } from "node:zlib";
import { z } from "zod";
import type { SignatureMark } from "@ra/contracts";
import { validateLogo } from "../websites/logo";
import { requireValue } from "./domain";

/** Decode validated PNG scanlines and reject transparent, white or nearly empty signature artwork. */
export function signatureInk(bytes: Buffer): boolean {
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20),
    channels = bytes[25] === 6 ? 4 : 3;
  const parts: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT")
      parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const stride = width * channels,
    raw = inflateSync(Buffer.concat(parts), {
      maxOutputLength: (stride + 1) * height,
    });
  let previous = Buffer.alloc(stride),
    ink = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)],
      row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
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
      row[x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      if (
        (channels === 3 || row[x + 3] > 32) &&
        Math.min(row[x], row[x + 1], row[x + 2]) < 220
      )
        ink++;
    }
    previous = row;
  }
  return ink >= 8;
}

/** Validate a bounded signature selection; omitted marks preserve typed-name consent for older clients. */
export function normalizeSignature(input: unknown): SignatureMark {
  if (input === undefined) return { mode: "typed", font: "formal" };
  const parsed = z
    .discriminatedUnion("mode", [
      z
        .object({
          mode: z.literal("typed"),
          font: z.enum(["allura", "caveat", "formal"]),
        })
        .strict(),
      z
        .object({
          mode: z.enum(["upload", "draw"]),
          image: z.string().max(131094),
        })
        .strict(),
    ])
    .safeParse(input);
  requireValue(parsed.success, "invalid_signature", 422);
  const mark = parsed.data;
  if (mark.mode !== "typed") {
    try {
      requireValue(
        signatureInk(validateLogo(mark.image)),
        "invalid_signature",
        422,
      );
    } catch {
      requireValue(false, "invalid_signature", 422);
    }
  }
  return mark;
}
