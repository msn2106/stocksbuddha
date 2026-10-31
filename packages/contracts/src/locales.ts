// Keep this module independent of runtime schema validation so browser locale
// selection does not pull the database/API schema machinery into the UI bundle.
export const supportedLocales = ["en", "hi"] as const;
export type Locale = (typeof supportedLocales)[number];
export function resolveLocale(value: unknown): Locale {
  return supportedLocales.find((locale) => locale === value) ?? "en";
}
