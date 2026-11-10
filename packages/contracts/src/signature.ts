export type SignatureMark =
  | { mode: "typed"; font: "allura" | "caveat" | "formal" }
  | { mode: "upload" | "draw"; image: string };
export type SignatureBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
