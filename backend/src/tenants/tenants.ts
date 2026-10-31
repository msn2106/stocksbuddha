import {
  tenantSchema,
  slugSchema,
  type Tenant,
  type PageData,
} from "@ra/contracts";

const stocksBuddha = tenantSchema.parse({
  id: "a1b87125-42b7-4d6d-8715-78721c436a82",
  slug: "stocks-buddha",
  status: "active",
  synthetic: false,
  profile: {
    name: "Stocks Buddha",
    legalName: "Mayank Singh",
    registration: "INH0000210695",
    monogram: "sb",
    description:
      "Independent equity and derivatives research. A considered approach to the Indian markets.",
  },
  published: {
    revision: 1,
    publishedAt: "2026-10-31T00:00:00.000Z",
    hero: "Clarity in a market full of noise.",
    introduction:
      "Independent research. Thoughtful analysis. A calmer framework for your investing decisions, built around understanding the business and respecting the risk.",
    accent: "#244b3b",
    surface: "#e8eee5",
  },
});

// Immutable synthetic fixtures prove path resolution without inventing RA credentials.
export const tenants: readonly Tenant[] = Object.freeze([
  stocksBuddha,
  tenantSchema.parse({
    ...stocksBuddha,
    id: "aba574d1-3eea-4547-8295-3bf8d22c6281",
    slug: "alpha",
    synthetic: true,
    profile: {
      name: "Alpha Research",
      legalName: "Alpha Demo Organization",
      registration: null,
      monogram: "ar",
      description:
        "A synthetic tenant for testing independent equity research branding.",
    },
    published: {
      ...stocksBuddha.published,
      hero: "A patient perspective on Indian equities.",
    },
  }),
  tenantSchema.parse({
    ...stocksBuddha,
    id: "dab574d1-3eea-4547-8295-3bf8d22c6282",
    slug: "beta",
    synthetic: true,
    profile: {
      name: "Beta Research",
      legalName: "Beta Demo Organization",
      registration: null,
      monogram: "br",
      description:
        "A synthetic tenant for testing market and derivatives research branding.",
    },
    published: {
      ...stocksBuddha.published,
      hero: "Understand the market. Respect the risk.",
      accent: "#334c73",
      surface: "#e7edf5",
    },
  }),
]);

export function findPublicTenant(slug: string): Tenant | null {
  if (!slugSchema.safeParse(slug).success) return null;
  return (
    tenants.find(
      (tenant) => tenant.slug === slug && tenant.status === "active",
    ) ?? null
  );
}

export function resolvePage(pathname: string): PageData {
  const match = /^\/ra\/([^/]+)\/?$/.exec(pathname);
  const tenant = match ? findPublicTenant(match[1]) : null;
  return { tenant, page: tenant ? "landing" : "not-found" };
}
