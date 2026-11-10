/** Printable-area margins in millimetres; generated disclosures also sit inside this area. */
export type LetterheadMargins = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};
export type LetterheadSettings = {
  version: number;
  name: string;
  pdf: string | null;
  sha256: string | null;
  margins: LetterheadMargins;
};
