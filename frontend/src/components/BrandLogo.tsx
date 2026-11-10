import type { BrandLogos } from "@ra/contracts";
const light = "/assets/brand/stocksbuddha-light.png";
const dark = "/assets/brand/stocksbuddha-dark.png";

/** Render surface-specific artwork with a single-logo fallback and initials when artwork is removed. */
export function BrandLogo({
  logos = {},
  stocksBuddha = false,
  initials = "sb",
  tone = "auto",
}: {
  logos?: BrandLogos;
  stocksBuddha?: boolean;
  initials?: string;
  tone?: "auto" | "light" | "dark";
}) {
  const custom = logos.logoLight !== undefined || logos.logoDark !== undefined;
  const primary = custom
    ? logos.logoLight || logos.logoDark
    : stocksBuddha
      ? light
      : null;
  const inverse = custom
    ? logos.logoDark || logos.logoLight
    : stocksBuddha
      ? dark
      : null;
  if (!primary)
    return (
      <span className="monogram" aria-hidden="true">
        {initials}
        <span />
      </span>
    );
  return (
    <span
      className={`brand-artwork brand-artwork-${tone} ${!custom && stocksBuddha ? "brand-artwork-original" : ""}`}
      aria-hidden="true"
    >
      <img
        className="brand-artwork-light"
        src={primary}
        alt=""
        width="64"
        height="64"
      />
      <img
        className="brand-artwork-dark"
        src={inverse!}
        alt=""
        width="64"
        height="64"
      />
    </span>
  );
}
