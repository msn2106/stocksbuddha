import { test } from "node:test";
import assert from "node:assert/strict";
import { SeedTenantRepository, tenants } from "../src/tenants/tenants";
import { SeedWebsiteRepository } from "../src/websites/repository";
import { websites } from "../src/websites/seeds";
import {
  createPublicSiteResolver,
  languageCookieName,
} from "../src/tenancy/resolve-public-site";
import { serializePage } from "@ra/contracts";
const resolvePage = createPublicSiteResolver(
  new SeedTenantRepository(),
  new SeedWebsiteRepository(),
);

test("unknown/reserved paths cannot default to or enumerate a tenant", async () => {
  for (const route of [
    "/ra/unknown",
    "/ra/admin",
    "/ra/ALPHA",
    "/ra/alpha%2fbeta",
    "/ra/../beta",
    "/ra",
    "/ra/alpha/login",
    "/ra/alpha/extra",
    "/anything",
    "/ra//alpha",
    "/ra/stocks-buddha",
  ])
    assert.deepEqual(await resolvePage(route), {
      tenant: null,
      website: null,
      page: "not-found",
      locale: "en",
    });
  assert.equal(
    (await resolvePage("/ra/stocksbuddha")).tenant?.id,
    tenants[0].id,
  );
});
test("independent public projections contain one tenant, revision and language", async () => {
  const alpha = await resolvePage("/ra/alpha", "hi"),
    beta = await resolvePage("/ra/beta", "en");
  assert.notEqual(alpha.tenant?.id, beta.tenant?.id);
  assert.equal(alpha.website?.tenantId, alpha.tenant?.id);
  assert.equal(beta.website?.tenantId, beta.tenant?.id);
  assert.equal(
    alpha.website?.content["site.hero"],
    websites[1].content.hi?.["site.hero"],
  );
  assert.equal(beta.website?.layout.template, "editorial");
  const output = serializePage(alpha);
  assert.equal(output.includes("Beta Research"), false);
  assert.equal(
    output.includes("A patient perspective on Indian equities."),
    false,
  );
  assert.equal((await resolvePage("/ra/alpha/")).tenant?.id, alpha.tenant?.id);
});
test("repository reads are defensive and duplicate identities/revisions are rejected", async () => {
  const repo = new SeedTenantRepository();
  (await repo.findBySlug("alpha"))!.profile.name = "Changed";
  assert.equal(
    (await repo.findBySlug("alpha"))?.profile.name,
    "Alpha Research",
  );
  const sites = new SeedWebsiteRepository();
  (await sites.findPublished(tenants[1].id))!.content.en!["site.hero"] =
    "Changed";
  assert.equal(
    (await sites.findPublished(tenants[1].id))?.content.en?.["site.hero"],
    websites[1].content.en?.["site.hero"],
  );
  assert.throws(
    () => new SeedTenantRepository([tenants[0], tenants[0]]),
    /Duplicate/,
  );
  assert.throws(
    () => new SeedWebsiteRepository([websites[0], websites[0]]),
    /Duplicate/,
  );
});
test("tenant status, missing publications and wrong-tenant adapter results fail closed", async () => {
  for (const status of ["draft", "suspended", "closed"] as const) {
    const resolve = createPublicSiteResolver(
      new SeedTenantRepository([{ ...tenants[1], status }]),
      new SeedWebsiteRepository(),
    );
    assert.equal((await resolve("/ra/alpha")).website, null);
  }
  for (const revision of [
    null,
    websites[2],
    { ...websites[1], status: "draft" as const },
  ]) {
    const resolve = createPublicSiteResolver(new SeedTenantRepository(), {
      findPublished: async () => revision,
    });
    assert.equal((await resolve("/ra/alpha")).tenant, null);
  }
});
test("draft revisions remain private and highest published revision is selected", async () => {
  const published = { ...structuredClone(websites[1]), revision: 2 };
  published.content.en!["site.hero"] = "Approved Alpha headline";
  const draft = {
    ...structuredClone(published),
    revision: 3,
    status: "draft" as const,
    publishedAt: null,
  };
  draft.content.en!["site.hero"] = "Confidential draft";
  const resolve = createPublicSiteResolver(
    new SeedTenantRepository(),
    new SeedWebsiteRepository([websites[1], published, draft]),
  );
  assert.equal((await resolve("/ra/alpha")).website?.revision, 2);
  assert.equal(
    serializePage(await resolve("/ra/alpha")).includes("Confidential draft"),
    false,
  );
});
test("language defaults and preferences are scoped to tenant, without mixed-language fallback", async () => {
  const alpha = structuredClone(websites[1]);
  alpha.languages = { default: "hi", enabled: ["hi"] };
  delete alpha.content.en;
  const resolve = createPublicSiteResolver(
    new SeedTenantRepository(),
    new SeedWebsiteRepository([alpha, websites[2]]),
  );
  for (const requested of [undefined, "en", "invalid", ["hi"]])
    assert.equal((await resolve("/ra/alpha", requested)).locale, "hi");
  const cookie = `${languageCookieName(tenants[1].id)}=hi`;
  assert.equal(
    (await resolvePage("/ra/alpha", undefined, cookie)).locale,
    "hi",
  );
  assert.equal((await resolvePage("/ra/beta", undefined, cookie)).locale, "en");
  assert.equal((await resolvePage("/ra/alpha", "en", cookie)).locale, "en");
  assert.equal(
    (await resolvePage("/ra/alpha", undefined, "ra-language=hi")).locale,
    "en",
  );
});
