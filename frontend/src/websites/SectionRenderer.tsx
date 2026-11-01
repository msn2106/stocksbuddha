import { Fragment, cloneElement, isValidElement, type ReactNode } from "react";
import type { Locale, PublicWebsite, WebsiteSection } from "@ra/contracts";

/**
 * Select prebuilt section nodes in configuration order so visual and reading order agree.
 * @param props - Approved section-node map and schema-validated ordered section identifiers.
 * @returns Keyed fragments for the selected sections, omitting any sections absent from the order.
 * This renderer trusts upstream validation; it does not interpret raw HTML or executable configuration.
 */
export function SectionRenderer({
  sections,
  order,
  layout,
  locale = "en",
}: {
  sections: Record<WebsiteSection, ReactNode>;
  order: readonly WebsiteSection[];
  layout?: PublicWebsite["layout"];
  locale?: Locale;
}) {
  return order.map((id) => {
    const node = sections[id];
    const image = layout?.images?.[id];
    if (
      !isValidElement<{
        className?: string;
        children?: ReactNode;
        id?: string;
      }>(node)
    )
      return <Fragment key={id}>{node}</Fragment>;
    return (
      <Fragment key={id}>
        {cloneElement(node, {
          ...{ id },
          className: `${node.props.className ?? ""} section-layout-${layout?.sectionStyles?.[id] ?? "default"}`,
          children: (
            <>
              {image && id !== "hero" && id !== "about" && (
                <img
                  className="section-custom-image"
                  src={image.src}
                  alt={image.alt[locale]}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              )}
              {node.props.children}
            </>
          ),
        })}
      </Fragment>
    );
  });
}
