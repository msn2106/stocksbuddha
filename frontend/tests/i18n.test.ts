import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catalogues,
  translator,
  localeOptions,
  tenantContent,
} from "../src/locales/messages";
import { supportedLocales, resolveLocale } from "@ra/contracts/locales";
import type { Tenant } from "@ra/contracts";

const placeholders = (text: string) =>
  [
    ...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1])),
  ].sort();

test("every enabled language has the same stable keys and nonempty messages", () => {
  const keys = Object.keys(catalogues.en).sort();
  assert.deepEqual(
    Object.keys(catalogues).sort(),
    [...supportedLocales].sort(),
  );
  for (const locale of supportedLocales) {
    assert.deepEqual(Object.keys(catalogues[locale]).sort(), keys);
    for (const [key, value] of Object.entries(catalogues[locale])) {
      assert.match(key, /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/);
      assert.equal(typeof value, "string");
      assert.ok(value.trim(), `${locale}: empty message ${key}`);
    }
  }
});

test("interpolation placeholders match English in every language", () => {
  for (const locale of supportedLocales)
    for (const key of Object.keys(
      catalogues.en,
    ) as (keyof typeof catalogues.en)[]) {
      assert.deepEqual(
        placeholders(catalogues[locale][key]),
        placeholders(catalogues.en[key]),
        `${locale}: placeholder mismatch for ${key}`,
      );
    }
});

test("the same key translates independently of English copy", () => {
  const original = catalogues.en["nav.subscribe"];
  try {
    catalogues.en["nav.subscribe"] = "Join the research";
    assert.equal(translator("en")("nav.subscribe"), "Join the research");
    assert.equal(translator("hi")("nav.subscribe"), "सदस्यता लें");
  } finally {
    catalogues.en["nav.subscribe"] = original;
  }
});

test("interpolation supports translated word order and leaves values as literal text", () => {
  const name = "Example {name} $& <company>";
  const message = translator("hi")("about.analystIntroduction", { name });
  assert.ok(message.startsWith(`${name} के नेतृत्व में`));
  assert.equal(message.includes(name), true);
  assert.throws(
    () => translator("en")("about.belief"),
    /Missing placeholder "name"/,
  );
});

test("unknown and sentence-based keys are rejected instead of rendered", () => {
  assert.throws(() => {
    // @ts-expect-error This old sentence-key API must remain a type error.
    translator("en")("Subscribe");
  }, /Unknown translation key/);
  assert.throws(() => {
    // @ts-expect-error Unknown identifiers must remain a type error.
    translator("hi")("nav.unknown");
  }, /Unknown translation key/);
});

test("only English and Hindi are enabled and every option has a native label", () => {
  assert.deepEqual(supportedLocales, ["en", "hi"]);
  assert.deepEqual(
    localeOptions.map(({ code }) => code),
    [...supportedLocales],
  );
  for (const { labelKey } of localeOptions)
    assert.ok(translator("en")(labelKey));
  for (const unknown of ["kn", "gu", "mr", "invalid", ["hi"], undefined])
    assert.equal(resolveLocale(unknown), "en");
  assert.equal(resolveLocale("hi"), "hi");
});

test("tenant-authored text is data, not an implicit UI translation key", () => {
  const tenant: Tenant = {
    id: "a1b87125-42b7-4d6d-8715-78721c436a82",
    slug: "custom-ra",
    status: "active",
    synthetic: true,
    profile: {
      name: "Example",
      legalName: "Example",
      registration: null,
      monogram: "ex",
      description: "Custom organization description",
    },
    published: {
      revision: 1,
      publishedAt: "2026-10-31T00:00:00.000Z",
      hero: "nav.subscribe",
      introduction: "Tenant-authored introduction",
      accent: "#244b3b",
      surface: "#e8eee5",
    },
  };
  assert.deepEqual(tenantContent(tenant, translator("hi")), {
    hero: "nav.subscribe",
    introduction: "Tenant-authored introduction",
    description: "Custom organization description",
  });
  const original = catalogues.en["tenants.stocksBuddha.hero"];
  try {
    catalogues.en["tenants.stocksBuddha.hero"] = "Updated seed heading";
    assert.equal(
      tenantContent({ ...tenant, slug: "stocks-buddha" }, translator("en"))
        .hero,
      "Updated seed heading",
    );
    assert.equal(
      tenantContent({ ...tenant, slug: "stocks-buddha" }, translator("hi"))
        .hero,
      "बाज़ार के शोर में स्पष्ट सोच।",
    );
  } finally {
    catalogues.en["tenants.stocksBuddha.hero"] = original;
  }
});
