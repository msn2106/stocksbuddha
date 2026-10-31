import { useRef, useState, type CSSProperties, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Compass,
  FileText,
  Menu,
  MoveUpRight,
  X,
} from "lucide-react";
import type { PageData, Tenant } from "@ra/contracts";
import { LanguageProvider, useLanguage } from "./i18n";
import { tenantContent } from "./locales/messages";
import { AccessibilityControls } from "./components/AccessibilityControls";

const frameworkContent = [
  {
    name: "framework.business.label",
    phrase: "framework.business.summary",
    text: "framework.business.description",
  },
  {
    name: "framework.valuation.label",
    phrase: "framework.valuation.summary",
    text: "framework.valuation.description",
  },
  {
    name: "framework.risk.label",
    phrase: "framework.risk.summary",
    text: "framework.risk.description",
  },
  {
    name: "framework.time.label",
    phrase: "framework.time.summary",
    text: "framework.time.description",
  },
] as const;
const servicesContent = [
  {
    icon: BookOpen,
    name: "services.equity.title",
    description: "services.equity.description",
    tags: "services.equity.tags",
  },
  {
    icon: ChartNoAxesCombined,
    name: "services.derivatives.title",
    description: "services.derivatives.description",
    tags: "services.derivatives.tags",
  },
  {
    icon: FileText,
    name: "services.market.title",
    description: "services.market.description",
    tags: "services.market.tags",
  },
] as const;
type Modal =
  | "subscription"
  | "sample"
  | "login"
  | "charter"
  | "complaints"
  | "grievance"
  | "terms"
  | "privacy"
  | "refund"
  | null;

function Brand({
  tenant,
  footer = false,
}: {
  tenant: Tenant;
  footer?: boolean;
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
        <small>{t("brand.tagline")} </small>
      </span>
    </a>
  );
}

function ResearchCompass() {
  const { t } = useLanguage();
  const framework = frameworkContent.map((item) => ({
    ...item,
    name: t(item.name),
    phrase: t(item.phrase),
    text: t(item.text),
  }));
  const [active, setActive] = useState(0);
  return (
    <div className="framework-visual">
      <div className="compass-heading">
        <span>{t("compass.heading")} </span>
        <Compass size={18} aria-hidden="true" />
      </div>
      <div className="compass-dial" aria-hidden="true">
        <div className="dial-ring ring-outer" />
        <div className="dial-ring ring-inner" />
        <div className="dial-axis axis-horizontal" />
        <div className="dial-axis axis-vertical" />
        <div className="dial-orbit" />
        <div className={`dial-needle needle-${active}`} />
        <div className="dial-centre">
          <span>{t("nav.research")} </span>
          <small>{t("compass.subtitle")} </small>
        </div>
        <span className="dial-point point-one" />
        <span className="dial-point point-two" />
      </div>
      <div
        className="framework-options"
        role="group"
        aria-label={t("compass.accessibleLabel")}
      >
        {framework.map((item, index) => (
          <button
            key={item.name}
            className={`dial-label label-${index} ${active === index ? "selected" : ""}`}
            onClick={() => setActive(index)}
            aria-pressed={active === index}
          >
            {item.name}
            <span>
              {
                [
                  t("framework.business.hint"),
                  t("framework.valuation.hint"),
                  t("framework.risk.hint"),
                  t("framework.time.hint"),
                ][index]
              }
            </span>
          </button>
        ))}
      </div>
      <div className="compass-caption" aria-live="polite">
        <span className="caption-dot" />
        <div>
          <strong>{framework[active].phrase}</strong>
          <p>{framework[active].text}</p>
        </div>
      </div>
      <div className="visual-footnote">
        <span>{t("compass.footnote")} </span>
        <span aria-hidden="true">↗</span>
      </div>
    </div>
  );
}

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
      : modal === "login"
        ? t("dialog.login.title")
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
              : modal === "login"
                ? t("dialog.login.description")
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
          ) : modal !== "login" ? (
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
          ) : null}
          <Dialog.Close className="button primary dialog-button">
            {t("common.continueExploring")}{" "}
            <ArrowRight size={17} aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function App({ data }: { data: PageData }) {
  return (
    <LanguageProvider locale={data.locale ?? "en"}>
      <Website data={data} />
    </LanguageProvider>
  );
}

function Website({ data }: { data: PageData }) {
  const { t, locale } = useLanguage();
  const framework = frameworkContent.map((item) => ({
    ...item,
    name: t(item.name),
    phrase: t(item.phrase),
    text: t(item.text),
  }));
  const services = servicesContent.map((item) => ({
    ...item,
    name: t(item.name),
    description: t(item.description),
    tags: t(item.tags),
  }));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openModal = (next: Exclude<Modal, null>) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setModal(next);
  };
  if (!data.tenant)
    return (
      <>
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
            href={`/ra/stocks-buddha?lang=${locale}`}
          >
            {t("error.visitHome")} <ArrowRight size={18} />
          </a>
        </main>
      </>
    );
  const tenant = data.tenant;
  const copy = tenantContent(tenant, t);
  const base = `/ra/${tenant.slug}?lang=${locale}`;
  const theme = {
    "--primary": tenant.published.accent,
    "--visual-surface": tenant.published.surface,
  } as CSSProperties;
  const navigate = () => setMenuOpen(false);
  return (
    <div style={theme} className="site-shell">
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
              : `${t("analyst.registeredRole")} · ${tenant.profile.registration}`}
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
            <a href={`${base}#research`}>{t("nav.research")} </a>
            <a href={`${base}#approach`}>{t("nav.approach")} </a>
            <a href={`${base}#about`}>{t("nav.about")} </a>
            <a href={`${base}#investor`}>{t("nav.investor")} </a>
          </nav>
          <div className="header-actions">
            <button className="login-button" onClick={() => openModal("login")}>
              {t("nav.login")} <ArrowUpRight size={15} aria-hidden="true" />
            </button>
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
            {[
              [t("nav.research"), "research"],
              [t("nav.approach"), "approach"],
              [t("nav.about"), "about"],
              [t("nav.investor"), "investor"],
            ].map(([name, id]) => (
              <a key={id} href={`${base}#${id}`} onClick={navigate}>
                {name}
                <ArrowUpRight size={18} />
              </a>
            ))}
            <button
              onClick={() => {
                navigate();
                openModal("login");
              }}
            >
              {t("nav.memberLogin")} <ArrowUpRight size={18} />
            </button>
          </nav>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        <section className="hero container" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="hero-intro">
              <span className="short-rule" />
              {t("hero.eyebrow")}{" "}
            </div>
            <h1 id="hero-title">{copy.hero}</h1>
            <p className="hero-description">{copy.introduction}</p>
            <div className="hero-actions">
              <a className="button primary" href={`${base}#plans`}>
                {t("hero.explorePlans")}{" "}
                <ArrowUpRight size={19} aria-hidden="true" />
              </a>
              <a className="text-link" href={`${base}#approach`}>
                {t("hero.discoverApproach")}{" "}
                <ArrowDown size={16} aria-hidden="true" />
              </a>
            </div>
            <div className="hero-assurance">
              <span className="assurance-mark">
                <Check size={15} aria-hidden="true" />
              </span>
              <span>
                {t("hero.reasoning")} <br />
                <strong>{t("hero.noPromises")} </strong>
              </span>
            </div>
          </div>
          <ResearchCompass />
        </section>
        <div className="principles-bar">
          <div className="container principles-inner">
            <p>
              {t("principles.lessNoise")} <br />
              <strong>{t("principles.morePerspective")} </strong>
            </p>
            <span>{t("brand.tagline")} </span>
            <span>{t("principles.riskAware")} </span>
            <span>{t("principles.transparent")} </span>
            <span>{t("principles.indianMarkets")} </span>
          </div>
        </div>
        <section
          className="section container"
          id="research"
          aria-labelledby="research-title"
        >
          <div className="section-top">
            <div>
              <p className="section-label">{t("research.eyebrow")} </p>
              <h2 id="research-title">
                {t("research.headingStart")} <br />
                {t("research.headingEnd")}{" "}
              </h2>
            </div>
            <p>{t("research.description")} </p>
          </div>
          <div className="research-grid">
            {services.map(({ icon: Icon, name, description, tags }) => (
              <article className="research-card" key={name}>
                <Icon
                  className="service-icon"
                  size={29}
                  strokeWidth={1.3}
                  aria-hidden="true"
                />
                <h3>{name}</h3>
                <p>{description}</p>
                <div>{tags}</div>
              </article>
            ))}
          </div>
          <button
            className="text-link research-sample"
            onClick={() => openModal("sample")}
          >
            {t("research.reportStructure")}{" "}
            <ArrowUpRight size={17} aria-hidden="true" />
          </button>
        </section>
        <section
          className="approach-section"
          id="approach"
          aria-labelledby="approach-title"
        >
          <div className="container approach-grid">
            <div>
              <p className="section-label">{t("approach.eyebrow")} </p>
              <h2 id="approach-title">
                {t("approach.headingStart")} <br />
                {t("approach.headingEnd")}{" "}
              </h2>
              <p className="approach-intro">{t("approach.introduction")} </p>
              <p>{t("approach.description")} </p>
              <a className="text-link" href={`${base}#expectations`}>
                {t("approach.expectations")}{" "}
                <ArrowDown size={17} aria-hidden="true" />
              </a>
            </div>
            <div className="framework-list">
              {framework.map((item) => (
                <div key={item.name}>
                  <span className="framework-symbol" aria-hidden="true">
                    {item.name.charAt(0)}
                  </span>
                  <div>
                    <h3>{item.name}</h3>
                    <p>{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section
          className="section container about-grid"
          id="about"
          aria-labelledby="about-title"
        >
          <div className="profile-placeholder">
            <div className="portrait-mark" aria-hidden="true">
              {tenant.profile.monogram}
              <span />
            </div>
            <span>{t("about.portraitLabel")} </span>
            <p>{tenant.profile.legalName}</p>
            <small>{t("about.photoPending")} </small>
          </div>
          <div className="about-copy">
            <p className="section-label">{t("about.eyebrow")} </p>
            <h2 id="about-title">
              {t("about.headingStart")} <br />
              {t("about.headingEnd")}{" "}
            </h2>
            <p className="large-body">
              {t("about.belief", { name: tenant.profile.name })}
            </p>
            <p>
              {t("about.analystIntroduction", {
                name: tenant.profile.legalName,
              })}
            </p>
            <p>{t("about.mission")} </p>
            <div className="analyst-signoff">
              <span>{tenant.profile.legalName}</span>
              <small>
                {tenant.synthetic
                  ? t("demo.organization")
                  : `${t("analyst.registeredRole")} · ${tenant.profile.registration}`}
              </small>
            </div>
          </div>
        </section>
        <section className="expectations-section" id="expectations">
          <div className="container expectations-grid">
            <h2>
              {t("expectations.headingStart")} <br />
              {t("expectations.headingEnd")}{" "}
            </h2>
            <div>
              <h3>{t("expectations.decisionsTitle")} </h3>
              <p>{t("expectations.decisionsDescription")} </p>
            </div>
            <div>
              <h3>{t("expectations.riskTitle")} </h3>
              <p>{t("expectations.riskDescription")} </p>
            </div>
          </div>
        </section>
        <section
          className="section container plans-section"
          id="plans"
          aria-labelledby="plans-title"
        >
          <div className="plans-heading">
            <p className="section-label">{t("plans.eyebrow")} </p>
            <h2 id="plans-title">
              {t("plans.headingStart")} <br />
              {t("plans.headingEnd")}{" "}
            </h2>
            <p>{t("plans.description")} </p>
          </div>
          <div className="plans-panel">
            <div className="plans-panel-top">
              <BookOpen size={27} strokeWidth={1.4} aria-hidden="true" />
              <span className="availability">{t("plans.openingSoon")} </span>
            </div>
            <h3>{t("plans.subscriptionTitle")} </h3>
            <p>{t("plans.subscriptionDescription")} </p>
            <ul>
              {[
                t("plans.equityFeature"),
                t("plans.marketFeature"),
                t("plans.termsFeature"),
              ].map((text) => (
                <li key={text}>
                  <Check size={17} aria-hidden="true" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
            <button
              className="button primary"
              onClick={() => openModal("subscription")}
            >
              {t("plans.availability")}{" "}
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
            <small>{t("plans.pending")} </small>
          </div>
        </section>
        <section className="container faq-section" aria-labelledby="faq-title">
          <h2 id="faq-title">{t("faq.title")} </h2>
          <div>
            {[
              [t("faq.audience.question"), t("faq.audience.answer")],
              [t("faq.management.question"), t("faq.management.answer")],
              [t("faq.returns.question"), t("faq.returns.answer")],
              [t("faq.subscribe.question"), t("faq.subscribe.answer")],
            ].map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section
          className="investor-section"
          id="investor"
          aria-labelledby="investor-title"
        >
          <div className="container investor-grid">
            <div>
              <p className="section-label">{t("nav.investor")} </p>
              <h2 id="investor-title">
                {t("investor.headingStart")} <br />
                {t("investor.headingEnd")}{" "}
              </h2>
              <p>{t("investor.description")} </p>
            </div>
            <div className="investor-links">
              {(
                [
                  [t("investor.charter"), "charter"],
                  [t("investor.complaints"), "complaints"],
                  [t("investor.grievance"), "grievance"],
                ] as const
              ).map(([label, key]) => (
                <button key={key} onClick={() => openModal(key)}>
                  {label}
                  <span>
                    {t("investor.awaitingPublication")}{" "}
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </span>
                </button>
              ))}
              <a
                href="https://scores.sebi.gov.in/"
                target="_blank"
                rel="noreferrer"
              >
                {t("investor.scores")}{" "}
                <span>
                  {t("investor.externalPortal")}{" "}
                  <ArrowUpRight size={17} aria-hidden="true" />
                </span>
              </a>
              <a href="https://smartodr.in/" target="_blank" rel="noreferrer">
                {t("investor.odr")}{" "}
                <span>
                  {t("investor.externalPortal")}{" "}
                  <ArrowUpRight size={17} aria-hidden="true" />
                </span>
              </a>
            </div>
          </div>
        </section>
      </main>
      <footer>
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
              <p>{t("analyst.contactPending")} </p>
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
              © {new Date(tenant.published.publishedAt).getUTCFullYear()}{" "}
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
