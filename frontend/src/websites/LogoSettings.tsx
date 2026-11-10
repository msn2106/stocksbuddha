import { useState } from "react";
import type { BrandLogos } from "@ra/contracts";
import { BrandLogo } from "../components/BrandLogo";

/** Decode bounded browser-supported rasters and re-encode pixels as a metadata-free, at-most-512px PNG. */
export async function normalizeLogo(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    !file.size ||
    file.size > 2 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG or WebP image up to 2 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width > 4096 ||
      bitmap.height > 4096
    )
      throw new Error("Logo dimensions must not exceed 4096 × 4096 pixels.");
    const ratio = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Image processing is unavailable in this browser.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const source = canvas.toDataURL("image/png");
    if (source.length > 131094)
      throw new Error(
        "This logo is too detailed. Choose a simpler image under 96 KB after resizing.",
      );
    return source;
  } finally {
    bitmap.close();
  }
}

/** Keep uploaded logos in the local website draft until the administrator saves and publishes. */
export function LogoSettings({
  logos,
  stocksBuddha,
  onChange,
  onBusy,
}: {
  logos: BrandLogos;
  stocksBuddha: boolean;
  onChange: (logos: BrandLogos) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  /** Normalize an uploaded image before changing the draft; failures preserve the previous logo. */
  async function upload(file: File, key: keyof BrandLogos) {
    setPending(true);
    onBusy(true);
    setError("");
    try {
      onChange({ ...logos, [key]: await normalizeLogo(file) });
    } catch {
      setError(
        "The logo could not be processed. Use a PNG, JPEG or WebP up to 2 MB and 4096 × 4096 pixels; the resized PNG must be under 96 KB.",
      );
    } finally {
      setPending(false);
      onBusy(false);
    }
  }
  return (
    <section className="logo-settings" aria-label="Organisation logo">
      <h3>Organisation logo</h3>
      <p>
        Upload a logo for light backgrounds and an optional version for dark
        backgrounds. Save the draft, preview, then publish to apply it across
        your RA site and accounts.
      </p>
      <p>
        PNG, JPEG or WebP up to 2 MB. For a readable header, use tightly cropped
        artwork with a transparent background.
      </p>
      <div className="logo-previews">
        {(["light", "dark"] as const).map((tone) => (
          <div key={tone} className={`logo-preview logo-preview-${tone}`}>
            <span>
              {tone === "light" ? "Light background" : "Dark background"}
            </span>
            <BrandLogo logos={logos} stocksBuddha={stocksBuddha} tone={tone} />
          </div>
        ))}
      </div>
      {(["logoLight", "logoDark"] as const).map((key) => (
        <div key={key}>
          <label>
            {key === "logoLight"
              ? "Logo for light backgrounds"
              : "Logo for dark backgrounds (optional)"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={pending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file, key);
              }}
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        disabled={pending}
        onClick={() => onChange({ logoLight: null, logoDark: null })}
      >
        Remove logos and use initials
      </button>
      {stocksBuddha && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            onChange({ logoLight: undefined, logoDark: undefined })
          }
        >
          Restore Stocks Buddha logos
        </button>
      )}
      {pending && <p role="status">Processing logo…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
