import english from "./en.json";
import hindi from "./hi.json";
import type { Locale, Tenant } from "@ra/contracts";
import { supportedLocales } from "@ra/contracts/locales";

export type MessageKey = keyof typeof english;
export type Catalogue = Record<MessageKey, string>;
export const catalogues = { en: english, hi: hindi } satisfies Record<
  Locale,
  Catalogue
>;

export const localeOptions = supportedLocales.map((code) => ({
  code,
  labelKey: (
    { en: "languages.english", hi: "languages.hindi" } satisfies Record<
      Locale,
      MessageKey
    >
  )[code],
}));

export function translator(locale: Locale) {
  const catalogue: Catalogue = catalogues[locale] ?? english;
  return (key: MessageKey, values: Record<string, string> = {}): string => {
    if (!Object.hasOwn(english, key))
      throw new Error(`Unknown translation key: ${key}`);
    const message = catalogue[key] ?? english[key];
    return message.replace(/\{(\w+)\}/g, (_match, name: string) => {
      if (!Object.hasOwn(values, name))
        throw new Error(`Missing placeholder "${name}" for ${key}`);
      return values[name];
    });
  };
}
export type Translate = ReturnType<typeof translator>;

// These are built-in demo content, not a translation service for arbitrary
// tenant-authored strings. Future editable content needs per-locale revisions.
const seedContent = {
  "stocks-buddha": {
    hero: "tenants.stocksBuddha.hero",
    description: "tenants.stocksBuddha.description",
  },
  alpha: {
    hero: "tenants.alpha.hero",
    description: "tenants.alpha.description",
  },
  beta: { hero: "tenants.beta.hero", description: "tenants.beta.description" },
} satisfies Record<string, { hero: MessageKey; description: MessageKey }>;

export function tenantContent(tenant: Tenant, t: Translate) {
  const keys = seedContent[tenant.slug as keyof typeof seedContent];
  // Built-in site copy is owned by the catalogues. Arbitrary tenant content is
  // data, never an identifier to pass into the UI translator.
  return {
    hero: keys ? t(keys.hero) : tenant.published.hero,
    introduction: keys
      ? t("tenants.shared.introduction")
      : tenant.published.introduction,
    description: keys ? t(keys.description) : tenant.profile.description,
  };
}
