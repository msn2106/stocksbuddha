import { crc32, inflateSync } from "node:zlib";
import { logoSchema } from "@ra/contracts";

/** Validate bounded, non-interlaced RGB/RGBA PNGs, including checksums and decoded scanline sizes. */
export function validateLogo(value: string): Buffer {
  logoSchema.parse(value);
  const encoded = value.slice(22),
    bytes = Buffer.from(encoded, "base64");
  if (
    bytes.toString("base64") !== encoded ||
    bytes.length > 98304 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Invalid logo image");
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false;
  const parts: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length;
    if (
      end > bytes.length ||
      crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      throw new Error("Invalid logo image");
    const kind = bytes.toString("ascii", offset + 4, offset + 8),
      data = bytes.subarray(offset + 8, end - 4);
    if (offset === 8 && kind !== "IHDR") throw new Error("Invalid logo image");
    if (kind === "IHDR") {
      if (offset !== 8 || length !== 13) throw new Error("Invalid logo image");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (
        !width ||
        !height ||
        width > 512 ||
        height > 512 ||
        data[8] !== 8 ||
        !channels ||
        data[10] ||
        data[11] ||
        data[12]
      )
        throw new Error("Invalid logo image");
    } else if (kind === "IDAT") parts.push(data);
    else if (kind === "IEND" && length === 0 && end === bytes.length) {
      ended = true;
      break;
    } else throw new Error("Invalid logo image");
    offset = end;
  }
  if (!ended || !parts.length) throw new Error("Invalid logo image");
  const stride = width * channels + 1;
  const decoded = inflateSync(Buffer.concat(parts), {
    maxOutputLength: stride * height,
  });
  if (decoded.length !== stride * height) throw new Error("Invalid logo image");
  for (let row = 0; row < height; row++)
    if (decoded[row * stride] > 4) throw new Error("Invalid logo image");
  return bytes;
}
