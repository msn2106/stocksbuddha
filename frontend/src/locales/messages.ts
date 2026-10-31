import english from "./en.json";
import hindi from "./hi.json";
import type { Locale, WebsiteContent, WebsiteContentKey } from "@ra/contracts";
import { supportedLocales } from "@ra/contracts/locales";

export type UiMessageKey = keyof typeof english;
export type MessageKey = UiMessageKey | WebsiteContentKey;
export type Catalogue = Record<UiMessageKey, string>;
export const catalogues = { en: english, hi: hindi } satisfies Record<
  Locale,
  Catalogue
>;
export const localeOptions = supportedLocales.map((code) => ({
  code,
  labelKey: (
    { en: "languages.english", hi: "languages.hindi" } satisfies Record<
      Locale,
      UiMessageKey
    >
  )[code],
}));

/**
 * Create a translator bound to one render's locale and website content.
 * Shared UI keys take precedence over tenant content. Interpolation replaces named
 * placeholders literally in one pass; values are not recursively translated or
 * HTML-escaped, so render the returned string as text rather than raw HTML.
 * @param locale - Shared UI catalogue to use, with English as the runtime fallback.
 * @param content - Selected tenant-language content; required for website content keys.
 * @returns A function accepting a semantic message key and optional named string values.
 * The returned function throws for unknown/missing keys or missing placeholder values.
 */
export function translator(locale: Locale, content?: WebsiteContent) {
  const catalogue: Catalogue = catalogues[locale] ?? english;
  return (key: MessageKey, values: Record<string, string> = {}): string => {
    // Shared controls are application-owned and cannot be overridden by tenants.
    const message = Object.hasOwn(english, key)
      ? catalogue[key as UiMessageKey]
      : content && Object.hasOwn(content, key)
        ? content[key as WebsiteContentKey]
        : undefined;
    if (message === undefined)
      throw new Error(
        `Unknown translation key or missing website content: ${key}`,
      );
    return message.replace(/\{(\w+)\}/g, (_match, name: string) => {
      if (!Object.hasOwn(values, name))
        throw new Error(`Missing placeholder "${name}"`);
      return values[name];
    });
  };
}
export type Translate = ReturnType<typeof translator>;
