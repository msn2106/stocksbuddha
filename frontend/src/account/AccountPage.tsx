import { useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  LogOut,
} from "lucide-react";
import type { PageData } from "@ra/contracts";
import { useLanguage } from "../i18n";
import { Brand } from "../websites/PublicWebsite";
import { AccessibilityControls } from "../components/AccessibilityControls";
import { WorkspaceShell } from "./WorkspaceShell";
import type { UiMessageKey } from "../locales/messages";

const roleLabels: Record<string, UiMessageKey> = {
  owner: "org.role.admin",
  analyst: "auth.role.analyst",
  support: "auth.role.support",
  subscriber: "auth.role.subscriber",
};

/** Render platform and tenant account forms and protected workspace states using the public brand system. */
export function AccountPage({ data }: { data: PageData }) {
  const { t, locale } = useLanguage();
  const account = data.account!;
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [audience, setAudience] = useState(account.audience ?? "investor");
  if (account.mode === "workspace") return <WorkspaceShell data={data} />;
  const platform = account.audience === "platform";
  const base = platform
    ? "/workspace"
    : data.tenant
      ? `/ra/${data.tenant.slug}`
      : "/ra/stocksbuddha";
  const tenant = data.tenant?.profile.name ?? t("auth.platform");
  const signup = account.mode === "signup";
  const credentials = account.mode === "login" || signup;
  const recovery = [
    "verify-email",
    "forgot-password",
    "reset-password",
  ].includes(account.mode);
  const form = credentials || recovery || account.mode === "join";
  const suffix = `?lang=${locale}`;
  const messageMode = account.mode.replace(/-([a-z])/g, (_, char: string) =>
    char.toUpperCase(),
  );
  const titleKey = `auth.${messageMode}.title` as UiMessageKey;
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
          <a
            className="account-platform"
            href={platform ? "/workspace/login" : base}
          >
            {tenant}
          </a>
        )}
        <a
          className="account-back"
          href={`${platform ? "/workspace/login" : base}${suffix}`}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          {t(platform ? "auth.login.action" : "auth.back")}
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
            <h1 id="account-title">
              {t(
                platform && account.mode === "login"
                  ? "org.ownerSignIn"
                  : titleKey,
              )}
            </h1>
            {credentials && (
              <p>
                {t(
                  signup ? "auth.signup.description" : "auth.login.description",
                  { tenant },
                )}
              </p>
            )}
          </div>
          {account.mode === "invitation" ? (
            <div className="invitation-accept">
              {account.error ? (
                <p className="account-error" role="alert">
                  {t("org.invitationInvalid")}
                </p>
              ) : (
                <>
                  <p>
                    {t("org.invitationFor", {
                      email: account.invitedEmail ?? "",
                    })}
                  </p>
                  <p>
                    {t("auth.role")}:{" "}
                    {t(
                      account.invitedRole === "owner"
                        ? "org.role.admin"
                        : account.invitedRole === "support"
                          ? "auth.role.support"
                          : "auth.role.analyst",
                    )}
                  </p>
                  {account.signedIn ? (
                    <form action={`${base}/invitation`} method="post">
                      <button className="button primary">
                        {t("org.acceptInvitation")}
                      </button>
                    </form>
                  ) : (
                    <>
                      <a
                        className="button primary"
                        href={`${base}/login?audience=organisation`}
                      >
                        {t("auth.login.action")}
                      </a>
                      <a
                        className="account-invite-signup"
                        href={`${base}/signup`}
                      >
                        {t("auth.signup.action")}
                      </a>
                      <p className="account-footnote">
                        {t("org.invitationVerification")}
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          ) : form ? (
            <>
              {account.notice && (
                <p role="status">
                  {t(
                    account.notice === "sent"
                      ? "auth.email.sent"
                      : "auth.reset.done",
                  )}
                </p>
              )}
              {recovery && (
                <p>
                  {t(
                    platform
                      ? "org.recoveryDescription"
                      : "auth.recovery.description",
                  )}
                </p>
              )}
              {account.mode === "join" && (
                <p>{t("auth.join.description", { tenant })}</p>
              )}
              {account.error && (
                <p className="account-error" role="alert" id="account-error">
                  {t(
                    account.error === "service"
                      ? "auth.error.service"
                      : account.error === "access"
                        ? "org.accessDenied"
                        : account.error === "invitation"
                          ? "org.invitationInvalid"
                          : "auth.error.credentials",
                  )}
                </p>
              )}
              <form
                className="account-form"
                action={`${base}/${account.mode}${suffix}`}
                method="post"
                onSubmit={() => setPending(true)}
                aria-describedby={account.error ? "account-error" : undefined}
                aria-busy={pending}
              >
                {account.mode === "login" && !platform && (
                  <fieldset className="login-audience">
                    <legend className="sr-only">{t("org.signInAs")}</legend>
                    {(["investor", "organisation"] as const).map((value) => (
                      <label
                        key={value}
                        className={audience === value ? "selected" : ""}
                      >
                        <input
                          type="radio"
                          name="audience"
                          value={value}
                          checked={audience === value}
                          onChange={() => setAudience(value)}
                        />
                        {t(
                          value === "investor"
                            ? "org.investor"
                            : "org.organisation",
                        )}
                      </label>
                    ))}
                  </fieldset>
                )}
                {account.mode === "login" && audience === "organisation" && (
                  <p className="account-team-hint">{t("org.teamHint")}</p>
                )}
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
                {(credentials ||
                  account.mode === "forgot-password" ||
                  account.mode === "verify-email") && (
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
                )}
                {(credentials || account.mode === "reset-password") && (
                  <div className="account-field">
                    <label htmlFor="account-password">
                      {t("auth.password")}
                    </label>
                    <div className="account-password">
                      <input
                        id="account-password"
                        type={visible ? "text" : "password"}
                        name="password"
                        autoComplete={
                          signup || account.mode === "reset-password"
                            ? "new-password"
                            : "current-password"
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
                      <small id="password-hint">
                        {t("auth.password.hint")}
                      </small>
                    )}
                  </div>
                )}
                <button
                  className="button primary account-submit"
                  disabled={pending || account.error === "service"}
                >
                  {pending
                    ? t("auth.pending")
                    : t(`auth.${messageMode}.action` as UiMessageKey)}
                  <ArrowRight size={19} aria-hidden="true" />
                </button>
              </form>
              {!platform && audience !== "organisation" && (
                <p className="account-alternate">
                  {t(signup ? "auth.existing" : "auth.new")}{" "}
                  <a href={`${base}/${signup ? "login" : "signup"}${suffix}`}>
                    {t(signup ? "auth.login.action" : "auth.signup.action")}
                  </a>
                </p>
              )}
              {account.mode === "login" && (
                <p>
                  <a href={`${base}/forgot-password${suffix}`}>
                    {t("auth.forgotPassword.title")}
                  </a>
                  {" · "}
                  <a href={`${base}/verify-email${suffix}`}>
                    {t("auth.verifyEmail.title")}
                  </a>
                </p>
              )}
              {platform && recovery && (
                <p>
                  <a href={`${base}/login${suffix}`}>
                    {t("auth.login.action")}
                  </a>
                </p>
              )}
              {signup && (
                <p className="account-footnote">
                  <LockKeyhole size={16} aria-hidden="true" />
                  {t("auth.note")}
                </p>
              )}
            </>
          ) : (
            <>
              {account.mode === "unavailable" && (
                <>
                  <p className="account-empty">{t("auth.unavailable.body")}</p>
                  <a href={`${base}/join${suffix}`}>{t("auth.join.action")}</a>
                </>
              )}
              {account.mode === "workspaces" &&
                (account.workspaces?.length ? (
                  <ul className="account-workspaces">
                    {account.workspaces.map((workspace) => (
                      <li key={workspace.slug}>
                        <a
                          href={`/ra/${workspace.slug}/${workspace.role === "subscriber" ? "account" : "workspace"}${suffix}`}
                        >
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
                  <a href={`/workspaces${suffix}`}>{t("auth.switch")}</a>
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
