import { Fragment, type ReactNode } from "react";
import type { WebsiteSection } from "@ra/contracts";

/**
 * Select prebuilt section nodes in configuration order so visual and reading order agree.
 * @param props - Approved section-node map and schema-validated ordered section identifiers.
 * @returns Keyed fragments for the selected sections, omitting any sections absent from the order.
 * This renderer trusts upstream validation; it does not interpret raw HTML or executable configuration.
 */
export function SectionRenderer({
  sections,
  order,
}: {
  sections: Record<WebsiteSection, ReactNode>;
  order: readonly WebsiteSection[];
}) {
  return order.map((id) => <Fragment key={id}>{sections[id]}</Fragment>);
}
