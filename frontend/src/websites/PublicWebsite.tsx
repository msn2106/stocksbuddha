import { useRef, useState, type CSSProperties, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Compass,
  FileText,
  Menu,
  MoveUpRight,
  X,
} from "lucide-react";
import type { PageData, Tenant } from "@ra/contracts";
import { useLanguage } from "../i18n";
import { LandingSections } from "./LandingSections";
import { AccessibilityControls } from "../components/AccessibilityControls";

type Modal =
  | "subscription"
  | "sample"
  | "charter"
  | "complaints"
  | "grievance"
  | "terms"
  | "privacy"
  | "refund"
  | null;

/**
 * Render a tenant's monogram/name as a link that retains the selected language.
 * @param props - Tenant identity and optional footer styling flag.
 * @returns The public tenant-home link with the shared translated tagline.
 */
export function Brand({
  tenant,
  footer = false,
  tagline,
}: {
  tenant: Tenant;
  footer?: boolean;
  tagline?: string;
}) {
  const { t, locale } = useLanguage();
  return (
    <a
      className={`brand ${footer ? "brand-footer" : ""}`}
      href={`/ra/${tenant.slug}?lang=${locale}`}
    >
      <span className="monogram" aria-hidden="true">
        {tenant.profile.monogram}
        <span />
      </span>
      <span>
        {tenant.profile.name}
        <small>{tagline ?? t("brand.tagline")} </small>
      </span>
    </a>
  );
}

/**
 * Render the controlled preview dialog for subscription, sample or policy information.
 * @param props - Selected dialog (null closes it), close callback, tenant and opener reference.
 * On close, focus returns to the recorded opener only if it remains in the document.
 * @returns An accessible dialog with placeholder information; no authentication or purchase occurs.
 */
function InfoDialog({
  modal,
  close,
  tenant,
  returnFocus,
}: {
  modal: Modal;
  close: () => void;
  tenant: Tenant;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const { t } = useLanguage();
  const policyTitles = {
    charter: t("investor.charter"),
    complaints: t("investor.complaints"),
    grievance: t("investor.grievance"),
    terms: t("policies.terms"),
    privacy: t("policies.privacy"),
    refund: t("policies.refund"),
  };
  const title =
    modal === "subscription"
      ? t("dialog.subscription.title")
      : modal === "sample"
        ? t("dialog.sample.title")
        : modal
          ? policyTitles[modal]
          : "";
  return (
    <Dialog.Root
      open={modal !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
        >
          <Dialog.Close
            className="dialog-close"
            aria-label={t("common.closeDialog")}
          >
            <X size={22} />
          </Dialog.Close>
          <span className="dialog-kicker">{tenant.profile.name}</span>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>
            {modal === "subscription"
              ? t("dialog.subscription.description")
              : modal === "sample"
                ? t("dialog.sample.description")
                : t("dialog.policy.description")}
          </Dialog.Description>
          {modal === "sample" ? (
            <div className="sample-outline">
              {[
                t("report.business"),
                t("report.evidence"),
                t("report.valuation"),
                t("report.risks"),
                t("report.disclosures"),
              ].map((text) => (
                <p key={text}>
                  <Check size={17} aria-hidden="true" />
                  {text}
                </p>
              ))}
              <p className="note">{t("report.note")} </p>
            </div>
          ) : modal === "subscription" ? (
            <div className="dialog-note">
              <BookOpen size={24} aria-hidden="true" />
              <p>{t("dialog.subscription.note")} </p>
            </div>
          ) : (
            <div className="dialog-note">
              <FileText size={24} aria-hidden="true" />
              <p>
                {t("analyst.legalName")} {tenant.profile.legalName}
                <br />
                {tenant.profile.registration
                  ? `${t("analyst.registrationSupplied")} ${tenant.profile.registration}`
                  : t("demo.notRegistered")}
                <br />
                {t("analyst.pendingDocuments")}{" "}
              </p>
            </div>
          )}
          <Dialog.Close className="button primary dialog-button">
            {t("common.continueExploring")}{" "}
            <ArrowRight size={17} aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Render a tenant's published site shell or a localized unavailable-page fallback.
 * @param props - Server-resolved public page data with one selected-language website revision.
 * @returns The themed navigation, configured landing sections, footer and preview dialogs.
 * Menu/dialog state and focus restoration are local UI behavior, not authorization checks.
 */
export function PublicWebsite({ data }: { data: PageData }) {
  const { t, locale } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  /**
   * Remember the focused element before opening a client-side preview dialog.
   * @param next - Dialog to display; closing is handled separately through the dialog state.
   */
  const openModal = (next: Exclude<Modal, null>) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setModal(next);
  };
  if (!data.tenant || !data.website)
    return (
      <>
        {data.preview && (
          <div className="draft-preview-banner" role="status">
            Private draft preview · visitors still see your published website
          </div>
        )}
        <a href="#main" className="skip-link">
          {t("a11y.skipToContent")}
        </a>
        <AccessibilityControls />
        <main id="main" tabIndex={-1} className="not-found">
          <Compass size={46} aria-hidden="true" />
          <p>{t("error.unavailable")} </p>
          <h1>
            {t("error.headingStart")} <br />
            {t("error.headingEnd")}{" "}
          </h1>
          <p>{t("error.description")} </p>
          <a
            className="button primary"
            href={`/ra/stocksbuddha?lang=${locale}`}
          >
            {t("error.visitHome")} <ArrowRight size={18} />
          </a>
        </main>
      </>
    );
  const tenant = data.tenant;
  const website = data.website;
  const base = `${data.preview ? `/ra/${tenant.slug}/workspace/website/preview` : `/ra/${tenant.slug}`}?lang=${locale}`;
  const navigation =
    website.layout.navigation ??
    (["research", "approach", "about", "investor"] as const).map((section) => ({
      section,
      label: { en: t(`nav.${section}`), hi: t(`nav.${section}`) },
    }));
  const theme = {
    "--primary": website.branding.accent,
    "--visual-surface": website.branding.surface,
  } as CSSProperties;
  /** Close the mobile menu when following a link; the link itself handles navigation. */
  const navigate = () => setMenuOpen(false);
  return (
    <div
      style={theme}
      className="site-shell"
      data-template={website.layout.template}
      data-font={website.branding.font}
      data-tenant={tenant.id}
      data-revision={website.revision}
    >
      {data.preview && (
        <div className="draft-preview-banner" role="status">
          Private draft preview · visitors still see your published website
        </div>
      )}
      <a href="#main" className="skip-link">
        {t("a11y.skipToContent")}{" "}
      </a>
      <AccessibilityControls />
      <div
        className="registration-bar"
        role="region"
        aria-label={t("analyst.information")}
      >
        <div className="container">
          <span>
            <span className="status-dot" />
            {tenant.synthetic
              ? t("demo.websiteNotice")
              : `${t("analyst.registeredRole")}${tenant.profile.registration ? ` · ${tenant.profile.registration}` : ""}`}
          </span>
          <span className="registration-right">{t("brand.motto")} </span>
        </div>
      </div>
      <header
        className="site-header"
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            setMenuOpen(false);
            menuToggle.current?.focus();
          }
        }}
      >
        <div className="container header-inner">
          <Brand tenant={tenant} />
          <nav className="desktop-nav" aria-label={t("nav.mainLabel")}>
            {navigation.map((item) => (
              <a key={item.section} href={`${base}#${item.section}`}>
                {item.label[locale]}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <a
              className="login-button"
              href={`/ra/${tenant.slug}/login?lang=${locale}`}
            >
              {t("nav.login")} <ArrowUpRight size={15} aria-hidden="true" />
            </a>
            <a href={`${base}#plans`} className="button primary small">
              {t("nav.subscribe")}{" "}
            </a>
            <button
              className="menu-toggle"
              ref={menuToggle}
              aria-label={menuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="mobile-nav"
            className="mobile-nav container"
            aria-label={t("nav.mobileLabel")}
          >
            {navigation.map((item) => (
              <a
                key={item.section}
                href={`${base}#${item.section}`}
                onClick={navigate}
              >
                {item.label[locale]}
                <ArrowUpRight size={18} />
              </a>
            ))}
            <a
              href={`/ra/${tenant.slug}/login?lang=${locale}`}
              onClick={navigate}
            >
              {t("nav.memberLogin")}{" "}
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </nav>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        <LandingSections
          tenant={tenant}
          website={website}
          openModal={openModal}
        />
      </main>
      <footer data-footer={website.layout.footer ?? "columns"}>
        <div className="container">
          <div className="footer-top">
            <div>
              <Brand tenant={tenant} footer />
              <p>
                {t("footer.thinking")} <br />
                {t("footer.perspective")}{" "}
              </p>
            </div>
            <div>
              <h3>{t("footer.explore")} </h3>
              <a href={`${base}#research`}>{t("footer.research")} </a>
              <a href={`${base}#approach`}>{t("nav.approach")} </a>
              <a href={`${base}#about`}>{t("footer.analyst")} </a>
            </div>
            <div>
              <h3>{t("footer.policies")} </h3>
              <button onClick={() => openModal("terms")}>
                {t("policies.terms")}{" "}
              </button>
              <button onClick={() => openModal("privacy")}>
                {t("policies.privacy")}{" "}
              </button>
              <button onClick={() => openModal("refund")}>
                {t("policies.refund")}{" "}
              </button>
            </div>
            <div className="footer-contact">
              <h3>{t("analyst.role")} </h3>
              <p>{tenant.profile.legalName}</p>
              <p>
                {tenant.synthetic
                  ? t("demo.tenant")
                  : tenant.profile.registration}
              </p>
              {website.contact?.email && (
                <a href={`mailto:${website.contact.email}`}>
                  {website.contact.email}
                </a>
              )}
              {website.contact?.phone && (
                <a href={`tel:${website.contact.phone}`}>
                  {website.contact.phone}
                </a>
              )}
              {!website.contact?.email && !website.contact?.phone && (
                <p>{t("analyst.contactPending")} </p>
              )}
            </div>
          </div>
          <div className="risk-disclosure">
            <p>{t("disclosures.accessibility")}</p>
            <p>{t("disclosures.marketRisk")} </p>
            <p>{t("disclosures.registration")} </p>
            <p>{t("disclosures.preview")} </p>
          </div>
          <div className="footer-bottom">
            <span>
              © {new Date(website.publishedAt).getUTCFullYear()}{" "}
              {tenant.profile.name}. {t("footer.copyright")}
            </span>
            <a href="#main">
              {t("footer.backToTop")}{" "}
              <MoveUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      </footer>
      <InfoDialog
        modal={modal}
        close={() => setModal(null)}
        tenant={tenant}
        returnFocus={returnFocus}
      />
    </div>
  );
}
