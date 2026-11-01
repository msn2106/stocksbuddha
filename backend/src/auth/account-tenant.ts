import type { PageData } from "@ra/contracts";

/** Keep anonymous account screens on published branding; private workspace and invitation views retain authorized context. */
export function accountTenant(account: PageData, published: PageData) {
  const tenant = account.tenant;
  if (!tenant) return null;
  if (["workspace", "join", "invitation"].includes(account.account?.mode ?? ""))
    return tenant;
  if (
    published.tenant?.id === tenant.id &&
    published.tenant.slug === tenant.slug
  )
    return published.tenant;
  // An active organisation may not have published a site yet. Its public slug is
  // sufficient for account access; working legal/registration data stays private.
  return {
    ...tenant,
    profile: {
      name: tenant.slug,
      legalName: tenant.slug,
      registration: null,
      monogram: tenant.slug.slice(0, 2),
    },
  };
}
