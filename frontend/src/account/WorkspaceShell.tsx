import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Menu,
  X,
  ChevronDown,
  LayoutDashboard,
  Building2,
  Users,
  BookOpen,
  FileText,
  Settings,
  LogOut,
  UserRound,
} from "lucide-react";
import type { PageData } from "@ra/contracts";
import { Brand } from "../websites/PublicWebsite";
import { useLanguage } from "../i18n";
import type { UiMessageKey } from "../locales/messages";

const roles: Record<string, UiMessageKey> = {
  owner: "org.role.admin",
  analyst: "auth.role.analyst",
  support: "auth.role.support",
  subscriber: "auth.role.subscriber",
  platform_owner: "org.role.platform",
};
/** Render the authenticated blank workspace, role-scoped navigation and profile without invented dashboard data. */
export function WorkspaceShell({ data }: { data: PageData }) {
  const { t, locale } = useLanguage();
  const account = data.account!,
    platform = account.area === "platform",
    investor = account.area === "investor";
  const base = platform
    ? "/workspace"
    : `/ra/${data.tenant!.slug}/${investor ? "account" : "workspace"}`;
  const profile = account.profile ?? {
    name: "",
    email: "",
    emailVerified: false,
  };
  const section = account.section ?? "overview",
    role = t(roles[account.role ?? "subscriber"] ?? "auth.role.subscriber");
  const [navigation, setNavigation] = useState(false),
    [pending, setPending] = useState(false);
  const logout = platform ? "/logout" : `/ra/${data.tenant!.slug}/logout`;
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">
        {t("a11y.skipToContent")}
      </a>
      <header className="workspace-header">
        <div className="workspace-brand">
          {data.tenant ? (
            <Brand
              tenant={data.tenant}
              tagline={t(
                investor ? "org.investorAccount" : "org.organisationWorkspace",
              )}
            />
          ) : (
            <a className="brand" href="/workspace">
              <span className="monogram" aria-hidden="true">
                sb
                <span />
              </span>
              <span>
                Stocks Buddha<small>{t("org.platformWorkspace")}</small>
              </span>
            </a>
          )}
        </div>
        <button
          className="workspace-menu"
          aria-label={t("org.navigation")}
          aria-expanded={navigation}
          aria-controls="workspace-navigation"
          onClick={() => setNavigation(!navigation)}
        >
          {navigation ? <X size={22} /> : <Menu size={22} />}
        </button>
        <Dialog.Root>
          <Dialog.Trigger className="workspace-profile">
            <span className="sr-only">{t("org.profile")} </span>
            <span className="profile-avatar" aria-hidden="true">
              {profile.name
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase() || <UserRound size={18} />}
            </span>
            <span className="profile-name">
              {profile.name}
              <small>{role}</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="workspace-profile-overlay" />
            <Dialog.Content className="workspace-profile-panel">
              <Dialog.Title>{t("org.yourProfile")}</Dialog.Title>
              <Dialog.Description>
                {t("org.profileDescription")}
              </Dialog.Description>
              <Dialog.Close
                className="dialog-close"
                aria-label={t("common.closeDialog")}
              >
                <X size={20} />
              </Dialog.Close>
              <dl className="profile-details">
                <dt>{t("auth.name")}</dt>
                <dd>{profile.name}</dd>
                <dt>{t("auth.email")}</dt>
                <dd>{profile.email}</dd>
                <dt>{t("auth.role")}</dt>
                <dd>{role}</dd>
                <dt>{t("org.verification")}</dt>
                <dd>
                  {t(profile.emailVerified ? "org.verified" : "org.unverified")}
                </dd>
                {data.tenant && (
                  <>
                    <dt>{t("org.organisation")}</dt>
                    <dd>{data.tenant.profile.name}</dd>
                  </>
                )}
              </dl>
              <form method="post" action={logout}>
                <button className="account-signout">
                  <LogOut size={17} aria-hidden="true" />
                  {t("auth.signout")}
                </button>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </header>
      <div className="workspace-layout">
        <aside
          className={`workspace-sidebar ${navigation ? "workspace-sidebar-open" : ""}`}
          id="workspace-navigation"
        >
          <p>
            {t(
              platform
                ? "org.platformWorkspace"
                : investor
                  ? "org.investorAccount"
                  : "org.organisationWorkspace",
            )}
          </p>
          <nav aria-label={t("org.navigation")}>
            <a
              href={`${base}?lang=${locale}`}
              aria-current={section === "overview" ? "page" : undefined}
            >
              <LayoutDashboard size={19} aria-hidden="true" />
              {t("org.overview")}
            </a>
            {platform && (
              <a
                href="/workspace/organisations"
                aria-current={section === "organisations" ? "page" : undefined}
              >
                <Building2 size={19} aria-hidden="true" />
                {t("org.organisations")}
              </a>
            )}
            {!platform && !investor && account.role === "owner" && (
              <a
                href={`${base}/team`}
                aria-current={section === "team" ? "page" : undefined}
              >
                <Users size={19} aria-hidden="true" />
                {t("org.team")}
              </a>
            )}
            {[
              [BookOpen, "org.research"],
              [FileText, "org.documents"],
              [Settings, "org.settings"],
            ].map(([Icon, key]) => {
              const Symbol = Icon as typeof BookOpen;
              return (
                <button key={key as string} disabled>
                  <Symbol size={19} aria-hidden="true" />
                  <span>
                    {t(key as UiMessageKey)}
                    <small>{t("org.comingSoon")}</small>
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="workspace-sidebar-footer">
            <a
              href={
                data.tenant ? `/ra/${data.tenant.slug}` : "/ra/stocksbuddha"
              }
            >
              {t("auth.back")}
            </a>
            {!platform && <a href="/workspaces">{t("auth.switch")}</a>}
          </div>
        </aside>
        <main
          id="workspace-content"
          className="workspace-content"
          tabIndex={-1}
        >
          {section === "overview" ? (
            <h1 className="sr-only">{t("org.overview")}</h1>
          ) : (
            <>
              <h1>
                {t(section === "team" ? "org.team" : "org.organisations")}
              </h1>
              {account.notice && (
                <p className="workspace-notice" role="status">
                  {t("org.invited")}
                </p>
              )}
              {account.error && (
                <p className="account-error" role="alert">
                  {t(
                    account.error === "service"
                      ? "auth.error.service"
                      : "org.inviteError",
                  )}
                </p>
              )}
              <div className="workspace-management">
                {section === "organisations" ? (
                  <>
                    <section aria-labelledby="organisation-create">
                      <h2 id="organisation-create">
                        {t("org.createOrganisation")}
                      </h2>
                      <form
                        className="workspace-form"
                        action="/workspace/organisations"
                        method="post"
                        onSubmit={() => setPending(true)}
                      >
                        {[
                          ["name", "org.name", 80],
                          ["legalName", "org.legalName", 100],
                          ["slug", "org.slug", 48],
                          ["monogram", "org.monogram", 3],
                          ["email", "org.adminEmail", 254],
                        ].map(([name, key, max]) => (
                          <label key={name as string}>
                            {t(key as UiMessageKey)}
                            <input
                              name={name as string}
                              type={name === "email" ? "email" : "text"}
                              required
                              maxLength={max as number}
                              pattern={
                                name === "slug"
                                  ? "[a-z][a-z0-9-]{1,47}"
                                  : undefined
                              }
                            />
                          </label>
                        ))}
                        <button
                          className="button primary"
                          disabled={pending || account.error === "service"}
                        >
                          {t(pending ? "auth.pending" : "org.createAndInvite")}
                        </button>
                      </form>
                    </section>
                    <section aria-labelledby="organisation-admin">
                      <h2 id="organisation-admin">{t("org.appointAdmin")}</h2>
                      <form
                        className="workspace-form"
                        action="/workspace/invitations"
                        method="post"
                        onSubmit={() => setPending(true)}
                      >
                        <label>
                          {t("org.organisation")}
                          <select name="tenantId" required defaultValue="">
                            <option value="" disabled>
                              {t("org.selectOrganisation")}
                            </option>
                            {account.organisations
                              ?.filter((org) =>
                                ["active", "draft"].includes(org.status),
                              )
                              .map((org) => (
                                <option value={org.id} key={org.id}>
                                  {org.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          {t("org.adminEmail")}
                          <input
                            name="email"
                            type="email"
                            required
                            maxLength={254}
                          />
                        </label>
                        <button
                          className="button primary"
                          disabled={pending || account.error === "service"}
                        >
                          {t(pending ? "auth.pending" : "org.sendInvitation")}
                        </button>
                      </form>
                    </section>
                  </>
                ) : (
                  <section aria-labelledby="team-invite">
                    <h2 id="team-invite">{t("org.inviteMember")}</h2>
                    <form
                      className="workspace-form"
                      action={`${base}/team`}
                      method="post"
                      onSubmit={() => setPending(true)}
                    >
                      <label>
                        {t("auth.email")}
                        <input
                          name="email"
                          type="email"
                          required
                          maxLength={254}
                        />
                      </label>
                      <label>
                        {t("auth.role")}
                        <select name="role">
                          <option value="analyst">
                            {t("auth.role.analyst")}
                          </option>
                          <option value="support">
                            {t("auth.role.support")}
                          </option>
                        </select>
                      </label>
                      <button
                        className="button primary"
                        disabled={pending || account.error === "service"}
                      >
                        {t(pending ? "auth.pending" : "org.sendInvitation")}
                      </button>
                    </form>
                  </section>
                )}
              </div>
              {section === "organisations" &&
                !!account.organisations?.length && (
                  <div className="workspace-table">
                    <table>
                      <caption>{t("org.organisations")}</caption>
                      <thead>
                        <tr>
                          <th>{t("org.organisation")}</th>
                          <th>{t("org.status")}</th>
                          <th>{t("org.admins")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.organisations.map((org) => (
                          <tr key={org.id}>
                            <td>
                              {org.name}
                              <small>/ra/{org.slug}</small>
                            </td>
                            <td>
                              {t(
                                org.status === "active"
                                  ? "org.active"
                                  : org.status === "draft"
                                    ? "org.awaitingAdmin"
                                    : "org.inactive",
                              )}
                            </td>
                            <td>{org.administrators}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              {section === "team" && !!account.invitations?.length && (
                <div className="workspace-table">
                  <table>
                    <caption>{t("org.invitations")}</caption>
                    <thead>
                      <tr>
                        <th>{t("auth.email")}</th>
                        <th>{t("auth.role")}</th>
                        <th>{t("org.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.invitations.map((invite) => (
                        <tr key={invite.id}>
                          <td>{invite.email}</td>
                          <td>{t(roles[invite.role]!)}</td>
                          <td>
                            {t(
                              invite.accepted_at
                                ? "org.accepted"
                                : invite.revoked_at
                                  ? "org.revoked"
                                  : invite.delivery_status === "failed"
                                    ? "org.deliveryFailed"
                                    : "org.pending",
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
