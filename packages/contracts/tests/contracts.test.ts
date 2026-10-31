import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tenantSchema,
  slugSchema,
  reservedSlugs,
  resolveLocale,
  serializePage,
  websiteRevisionSchema,
  type WebsiteRevision,
} from "../src/index";
import { makePage, makeTenant, makeWebsite } from "./fixtures";

test("tenant identity and public slug validation reject malformed/reserved/extra values", () => {
  assert.equal(tenantSchema.safeParse(makeTenant()).success, true);
  for (const slug of [...reservedSlugs, "A", "a", "alpha/beta", "a".repeat(49)])
    assert.equal(slugSchema.safeParse(slug).success, false, slug);
  assert.equal(slugSchema.safeParse("alpha-2").success, true);
  assert.equal(
    tenantSchema.safeParse({ ...makeTenant(), private: "secret" }).success,
    false,
  );
  assert.equal(
    tenantSchema.safeParse({ ...makeTenant(), id: "bad-id" }).success,
    false,
  );
});

test("locale resolution accepts only exact registered scalar values", () => {
  for (const value of [undefined, null, "HI", ["hi"], {}, "gu"])
    assert.equal(resolveLocale(value), "en");
  assert.equal(resolveLocale("hi"), "hi");
  assert.equal(resolveLocale("en"), "en");
});

test("publication schema rejects unsafe layout, incomplete languages, publication dates and mismatched placeholders", () => {
  const changes: ((site: WebsiteRevision) => void)[] = [
    (s) => {
      s.branding.accent = "red; display:none";
    },
    (s) => {
      s.layout.template = "script" as never;
    },
    (s) => {
      s.layout.sections = s.layout.sections.filter((v) => v !== "investor");
    },
    (s) => {
      s.layout.sections.push("hero");
    },
    (s) => {
      s.layout.sections.reverse();
    },
    (s) => {
      s.languages.enabled = ["en", "en"];
    },
    (s) => {
      s.languages.enabled = ["hi"];
      delete s.content.en;
    },
    (s) => {
      delete s.content.hi;
    },
    (s) => {
      delete (
        s.content.hi as Partial<NonNullable<WebsiteRevision["content"]["hi"]>>
      )["site.hero"];
    },
    (s) => {
      s.content.en!["site.hero"] = "Hello {name}";
      s.content.hi!["site.hero"] = "Missing placeholder";
    },
    (s) => {
      Object.assign(s.content.en!, { "nav.subscribe": "Injected control" });
    },
    (s) => {
      s.publishedAt = null;
    },
  ];
  for (const change of changes) {
    const site = makeWebsite();
    change(site);
    assert.equal(
      websiteRevisionSchema.safeParse(site).success,
      false,
      change.toString(),
    );
  }
  const draft = makeWebsite();
  draft.status = "draft";
  draft.publishedAt = null;
  assert.equal(websiteRevisionSchema.safeParse(draft).success, true);
  const single = makeWebsite();
  single.languages.enabled = ["en"];
  delete single.content.hi;
  assert.equal(websiteRevisionSchema.safeParse(single).success, true);
  const reordered = makeWebsite();
  reordered.content.en!["site.hero"] = "{first} {second} {first}";
  reordered.content.hi!["site.hero"] = "{second} {first}";
  assert.equal(websiteRevisionSchema.safeParse(reordered).success, true);
});

test("bootstrap serialization preserves data while escaping script termination and Unicode separators", () => {
  const page = makePage();
  page.website!.content["site.hero"] =
    "</script><script>alert(1)</script>\u2028\u2029";
  const result = serializePage(page);
  assert.equal(result.includes("<"), false);
  assert.equal(result.includes("\u2028"), false);
  assert.equal(result.includes("\u2029"), false);
  assert.deepEqual(JSON.parse(result), page);
});
