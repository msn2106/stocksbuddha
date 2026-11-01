import { useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  LogOut,
  Check,
} from "lucide-react";
import type { PageData } from "@ra/contracts";
import { useLanguage } from "../i18n";
import { Brand } from "../websites/PublicWebsite";
import { AccessibilityControls } from "../components/AccessibilityControls";
import type { UiMessageKey } from "../locales/messages";

const capabilityLabels: Record<string, UiMessageKey> = {
  "website:edit": "auth.access.website",
  "research:publish": "auth.access.research",
  "subscribers:read": "auth.access.subscribers",
  "staff:manage": "auth.access.staff",
};
const roleLabels: Record<string, UiMessageKey> = {
  owner: "auth.role.owner",
  analyst: "auth.role.analyst",
  support: "auth.role.support",
  subscriber: "auth.role.subscriber",
};

/** Render tenant-scoped account forms and protected workspace states using the public brand system. */
export function AccountPage({ data }: { data: PageData }) {
  const { t, locale } = useLanguage();
  const account = data.account!;
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const base = data.tenant ? `/ra/${data.tenant.slug}` : "/ra/stocksbuddha";
  const tenant = data.tenant?.profile.name ?? t("auth.platform");
  const signup = account.mode === "signup";
  const form = account.mode === "login" || signup;
  const suffix = `?lang=${locale}`;
  const titleKey = `auth.${account.mode}.title` as UiMessageKey;
  return (
    <div
      className="account-shell"
      style={
        {
          "--primary": data.website?.branding.accent ?? "#244b3b",
        } as CSSProperties
      }
    >
      <a className="skip-link" href="#account-main">
        {t("a11y.skipToContent")}
      </a>
      <AccessibilityControls />
      <header className="account-header container">
        {data.tenant ? (
          <Brand
            tenant={data.tenant}
            tagline={data.website ? undefined : t("auth.tagline")}
          />
        ) : (
          <a className="account-platform" href={base}>
            {tenant}
          </a>
        )}
        <a className="account-back" href={`${base}${suffix}`}>
          <ArrowLeft size={17} aria-hidden="true" />
          {t("auth.back")}
        </a>
      </header>
      <main
        id="account-main"
        className={`account-main container ${form ? "" : "account-main-workspace"}`}
      >
        <aside className="account-story" aria-label={tenant}>
          <span className="account-story-mark" aria-hidden="true">
            {data.tenant?.profile.monogram ?? "sb"}
            <span />
          </span>
          <h2>{t("auth.story.title")}</h2>
          <p>{t("auth.story.body", { tenant })}</p>
          {data.tenant && (
            <div className="account-legal">
              <span>{data.tenant.profile.legalName}</span>
              {data.tenant.profile.registration && (
                <span>{data.tenant.profile.registration}</span>
              )}
            </div>
          )}
        </aside>
        <section className="account-panel" aria-labelledby="account-title">
          <div className="account-panel-heading">
            <h1 id="account-title">{t(titleKey)}</h1>
            {form && (
              <p>
                {t(
                  signup ? "auth.signup.description" : "auth.login.description",
                  { tenant },
                )}
              </p>
            )}
            {account.mode === "workspace" && (
              <p>{t("auth.workspace.description", { tenant })}</p>
            )}
          </div>
          {form ? (
            <>
              {account.error && (
                <p className="account-error" role="alert" id="account-error">
                  {t(
                    account.error === "service"
                      ? "auth.error.service"
                      : "auth.error.credentials",
                  )}
                </p>
              )}
              <form
                className="account-form"
                action={`${base}/${signup ? "signup" : "login"}${suffix}`}
                method="post"
                onSubmit={() => setPending(true)}
                aria-describedby={account.error ? "account-error" : undefined}
                aria-busy={pending}
              >
                {signup && (
                  <div className="account-field">
                    <label htmlFor="account-name">{t("auth.name")}</label>
                    <input
                      id="account-name"
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={160}
                      defaultValue={account.name}
                      disabled={account.error === "service"}
                    />
                  </div>
                )}
                <div className="account-field">
                  <label htmlFor="account-email">{t("auth.email")}</label>
                  <input
                    id="account-email"
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    maxLength={254}
                    defaultValue={account.email}
                    disabled={account.error === "service"}
                  />
                </div>
                <div className="account-field">
                  <label htmlFor="account-password">{t("auth.password")}</label>
                  <div className="account-password">
                    <input
                      id="account-password"
                      type={visible ? "text" : "password"}
                      name="password"
                      autoComplete={
                        signup ? "new-password" : "current-password"
                      }
                      minLength={8}
                      maxLength={128}
                      required
                      aria-describedby={signup ? "password-hint" : undefined}
                      disabled={account.error === "service"}
                    />
                    <button
                      type="button"
                      aria-label={t(
                        visible ? "auth.password.hide" : "auth.password.show",
                      )}
                      aria-pressed={visible}
                      onClick={() => setVisible(!visible)}
                      disabled={account.error === "service"}
                    >
                      {visible ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                  {signup && (
                    <small id="password-hint">{t("auth.password.hint")}</small>
                  )}
                </div>
                <button
                  className="button primary account-submit"
                  disabled={pending || account.error === "service"}
                >
                  {pending
                    ? t("auth.pending")
                    : t(signup ? "auth.signup.action" : "auth.login.action")}
                  <ArrowRight size={19} aria-hidden="true" />
                </button>
              </form>
              <p className="account-alternate">
                {t(signup ? "auth.existing" : "auth.new")}{" "}
                <a href={`${base}/${signup ? "login" : "signup"}${suffix}`}>
                  {t(signup ? "auth.login.action" : "auth.signup.action")}
                </a>
              </p>
              {signup && (
                <p className="account-footnote">
                  <LockKeyhole size={16} aria-hidden="true" />
                  {t("auth.note")}
                </p>
              )}
            </>
          ) : (
            <>
              {account.mode === "workspace" && (
                <dl className="account-access">
                  <div>
                    <dt>{t("auth.role")}</dt>
                    <dd>{t(roleLabels[account.role!]!)}</dd>
                  </div>
                  <div>
                    <dt>{t("auth.access")}</dt>
                    <dd>
                      <ul>
                        {(account.capabilities?.length
                          ? account.capabilities
                          : ["overview"]
                        ).map((capability) => (
                          <li key={capability}>
                            <Check size={17} aria-hidden="true" />
                            {t(
                              capabilityLabels[capability] ??
                                "auth.access.basic",
                            )}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </dl>
              )}
              {account.mode === "unavailable" && (
                <p className="account-empty">{t("auth.unavailable.body")}</p>
              )}
              {account.mode === "workspaces" &&
                (account.workspaces?.length ? (
                  <ul className="account-workspaces">
                    {account.workspaces.map((workspace) => (
                      <li key={workspace.slug}>
                        <a href={`/ra/${workspace.slug}/workspace${suffix}`}>
                          <span>
                            {workspace.name}
                            <small>{t(roleLabels[workspace.role]!)}</small>
                          </span>
                          <ArrowRight size={20} aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="account-empty">{t("auth.empty")}</p>
                ))}
              <div className="account-workspace-actions">
                {account.mode !== "workspaces" && (
                  <a href={`/workspace${suffix}`}>{t("auth.switch")}</a>
                )}
                <form
                  action={data.tenant ? `${base}/logout` : "/logout"}
                  method="post"
                >
                  <button className="account-signout">
                    <LogOut size={17} aria-hidden="true" />
                    {t("auth.signout")}
                  </button>
                </form>
              </div>
            </>
          )}
        </section>
      </main>
      <footer className="account-footer container">
        <span>{tenant}</span>
        <span>{data.website ? t("brand.tagline") : t("auth.tagline")}</span>
      </footer>
    </div>
  );
}
