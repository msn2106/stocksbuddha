import { test } from "node:test";
import assert from "node:assert/strict";
import { findPublicTenant, resolvePage, tenants } from "../src/tenants/tenants";
import { serializePage, tenantSchema } from "@ra/contracts";

test("public resolution never falls back to another tenant", () => {
  for (const slug of [
    "unknown",
    "admin",
    "api",
    "auth",
    "ALPHA",
    "alpha%2fbeta",
    "../beta",
  ]) {
    assert.equal(findPublicTenant(slug), null);
    assert.equal(resolvePage(`/ra/${slug}`).page, "not-found");
  }
  for (const path of [
    "/ra",
    "/ra/alpha/login",
    "/ra/alpha/extra",
    "/anything",
    "/ra//alpha",
  ])
    assert.equal(resolvePage(path).tenant, null);
});

test("two tenants resolve independently without shared mutable context", () => {
  const alpha = resolvePage("/ra/alpha");
  const beta = resolvePage("/ra/beta");
  assert.notEqual(alpha.tenant?.id, beta.tenant?.id);
  assert.equal(alpha.tenant?.profile.name, "Alpha Research");
  assert.equal(beta.tenant?.profile.name, "Beta Research");
  assert.notEqual(
    alpha.tenant?.published.accent,
    beta.tenant?.published.accent,
  );
  assert.equal(resolvePage("/ra/alpha/").tenant?.id, alpha.tenant?.id);
});

test("published seed data validates and IDs/slugs are unique", () => {
  assert.equal(
    new Set(tenants.map((tenant) => tenant.id)).size,
    tenants.length,
  );
  assert.equal(
    new Set(tenants.map((tenant) => tenant.slug)).size,
    tenants.length,
  );
  for (const tenant of tenants)
    assert.equal(tenantSchema.safeParse(tenant).success, true);
  assert.equal(
    tenantSchema.safeParse({
      ...tenants[0],
      published: { ...tenants[0].published, accent: "red; display:none" },
    }).success,
    false,
  );
});

test("embedded bootstrap JSON cannot close the script element", () => {
  const tenant = structuredClone(tenants[0]);
  tenant.profile.name = "</script><script>alert(1)</script>";
  const data = { tenant, page: "landing" as const };
  const serialized = serializePage(data);
  assert.equal(serialized.includes("<"), false);
  assert.deepEqual(JSON.parse(serialized), data);
});
