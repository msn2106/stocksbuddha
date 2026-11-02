import { Building2, Globe2, LockKeyhole, Users } from "lucide-react";
import type { PageData } from "@ra/contracts";
import { AccessibilityControls } from "../components/AccessibilityControls";
import { useLanguage } from "../i18n";
import { platformContent } from "./content";

/** Render the tenant-independent platform website, with explicit audience-specific entry points. */
export function PlatformWebsite({ data }: { data: PageData }) {
  const { t } = useLanguage();
  const copy = platformContent[data.locale];
  const suffix = `?lang=${data.locale}`;
  return (
    <div className="platform-site">
      <a className="skip-link" href="#platform-main">
        {t("a11y.skipToContent")}
      </a>
      <AccessibilityControls />
      <header className="platform-header platform-container">
        <a className="platform-brand" href={`/${suffix}`}>
          <span aria-hidden="true" className="platform-mark">
            sb
          </span>
          StocksBuddha
        </a>
        <nav
          aria-label={
            data.locale === "hi" ? "मुख्य नेविगेशन" : "Main navigation"
          }
        >
          <a href="#platform">{copy.product}</a>
          <a href="#access">{copy.access}</a>
          <a className="platform-button" href="#contact">
            {copy.demo}
          </a>
        </nav>
      </header>
      <main id="platform-main" tabIndex={-1}>
        <section
          className="platform-hero platform-container"
          aria-labelledby="platform-title"
        >
          <div className="platform-hero-copy">
            <h1 id="platform-title">{copy.heading}</h1>
            <p>{copy.intro}</p>
            <div className="platform-hero-actions">
              <a className="platform-button" href="#contact">
                {copy.demo}
              </a>
              <a
                className="platform-text-link"
                href={`/ra/stocksbuddha${suffix}`}
              >
                {copy.example}
              </a>
            </div>
            <small>{copy.exampleNote}</small>
          </div>
          <div className="platform-map" role="group" aria-label={copy.mapLabel}>
            <div className="platform-map-heading">
              <Building2 aria-hidden="true" size={24} />
              <h2>{copy.mapTitle}</h2>
            </div>
            <div className="platform-space">
              <Globe2 aria-hidden="true" size={24} />
              <div>
                <h3>{copy.publicLabel}</h3>
                <p>{copy.publicBody}</p>
              </div>
            </div>
            <div className="platform-space">
              <LockKeyhole aria-hidden="true" size={24} />
              <div>
                <h3>{copy.privateLabel}</h3>
                <p>{copy.privateBody}</p>
              </div>
            </div>
            <div className="platform-investors">
              <Users aria-hidden="true" size={22} />
              <div>
                <h3>{copy.investorLabel}</h3>
                <p>{copy.investorBody}</p>
              </div>
            </div>
          </div>
        </section>
        <section
          id="platform"
          className="platform-features platform-container"
          aria-labelledby="platform-features-title"
        >
          <h2 id="platform-features-title">{copy.featuresTitle}</h2>
          <div className="platform-feature-list">
            {copy.features.map(([title, body]) => (
              <article key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          id="access"
          className="platform-access"
          aria-labelledby="platform-access-title"
        >
          <div className="platform-container platform-access-grid">
            <div>
              <h2 id="platform-access-title">{copy.accessTitle}</h2>
              <p>{copy.accessBody}</p>
              <form
                action="/access"
                method="get"
                className="platform-access-form"
              >
                <input type="hidden" name="lang" value={data.locale} />
                <label htmlFor="ra-slug">{copy.slugLabel}</label>
                <input
                  id="ra-slug"
                  name="slug"
                  required
                  minLength={2}
                  maxLength={48}
                  pattern={"[a-z][a-z0-9\\-]{1,47}"}
                  aria-describedby="ra-slug-hint"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <p id="ra-slug-hint">{copy.slugHint}</p>
                {data.platformAccessError && <p role="alert">{copy.invalid}</p>}
                <div className="platform-access-actions">
                  <button
                    className="platform-button"
                    name="audience"
                    value="organisation"
                  >
                    {copy.organisationAction}
                  </button>
                  <button
                    className="platform-button platform-button-secondary"
                    name="audience"
                    value="investor"
                  >
                    {copy.investorAction}
                  </button>
                </div>
              </form>
              <p className="platform-chooser">
                <a className="platform-text-link" href={`/workspaces${suffix}`}>
                  {copy.chooser}
                </a>
                <br />
                {copy.chooserHint}
              </p>
            </div>
            <aside
              className="platform-admin"
              aria-labelledby="platform-admin-title"
            >
              <LockKeyhole size={24} aria-hidden="true" />
              <h3 id="platform-admin-title">{copy.adminTitle}</h3>
              <p>{copy.adminBody}</p>
              <a
                className="platform-text-link"
                href={`/workspace/login${suffix}`}
              >
                {copy.adminAction}
              </a>
            </aside>
          </div>
        </section>
        <section
          id="contact"
          className="platform-contact platform-container"
          aria-labelledby="platform-contact-title"
        >
          <div>
            <h2 id="platform-contact-title">{copy.contactTitle}</h2>
            <p>{copy.contactBody}</p>
          </div>
          <a
            className="platform-button"
            href={`mailto:support@stocksbuddha.com?subject=${encodeURIComponent(copy.emailSubject)}`}
          >
            {copy.emailAction}
          </a>
        </section>
      </main>
      <footer className="platform-footer platform-container">
        <a className="platform-brand" href={`/${suffix}`}>
          StocksBuddha
        </a>
        <p>{copy.footer}</p>
      </footer>
    </div>
  );
}
