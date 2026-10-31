import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Compass,
  FileText,
} from "lucide-react";
import type { Tenant, PublicWebsite, WebsiteSection } from "@ra/contracts";
import { useLanguage } from "../i18n";
import { SectionRenderer } from "./SectionRenderer";
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
/**
 * Render the translated research-framework selector with an accessible live caption.
 * @returns Four pressed-state buttons whose selection updates only local presentation state.
 */
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

/**
 * Compose approved landing sections using tenant identity and the scoped language context.
 * @param props - Tenant, validated published website layout and callback for preview dialogs.
 * @returns Sections in the website's configured DOM order, with its selected template presentation.
 * Marketing/disclosure text comes from the current translator; this component performs no fetches.
 */
export function LandingSections({
  tenant,
  website,
  openModal,
}: {
  tenant: Tenant;
  website: PublicWebsite;
  openModal: (
    modal: "subscription" | "sample" | "charter" | "complaints" | "grievance",
  ) => void;
}) {
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
  const copy = {
    hero: website.content["site.hero"],
    introduction: website.content["site.introduction"],
  };
  const base = `/ra/${tenant.slug}?lang=${locale}`;
  const sections: Record<WebsiteSection, ReactNode> = {
    hero: (
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
        {website.layout.template === "classic" && <ResearchCompass />}
      </section>
    ),
    principles: (
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
    ),
    research: (
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
    ),
    approach: (
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
    ),
    about: (
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
    ),
    expectations: (
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
    ),
    plans: (
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
    ),
    faq: (
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
    ),
    investor: (
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
    ),
  };
  return (
    <SectionRenderer sections={sections} order={website.layout.sections} />
  );
}
