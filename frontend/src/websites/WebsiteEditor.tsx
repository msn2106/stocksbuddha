import { PaymentSettings } from "./PaymentSettings";
import { IntegrationSettings } from "./IntegrationSettings";
import { SmsSettings } from "./SmsSettings";
import { useEffect, useState, useRef } from "react";
import { translator } from "../locales/messages";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from "lucide-react";
import {
  sectionIds,
  requiredSections,
  websiteContentKeys,
  editableWebsiteContentKeys,
  websiteSnapshotSchema,
  type Locale,
  type Snapshot,
  type Tenant,
  type WebsiteEditorState,
  type WebsiteSection,
} from "@ra/contracts";

const names: Record<WebsiteSection, string> = {
  hero: "Introduction",
  principles: "Principles",
  research: "Research",
  approach: "Approach",
  about: "About the analyst",
  expectations: "Expectations",
  plans: "Plans",
  faq: "Questions & answers",
  investor: "Investor information",
};
const tabs = [
  "Branding",
  "Navigation",
  "Sections",
  "Content",
  "Footer",
  "SMS Settings",
  "Telegram Settings",
  "Payment Settings",
] as const;
const defaults = ["research", "approach", "about", "investor"] as const;

/** Owner-only website workspace, preserving unsaved edits and optimistic draft versions. */
export function WebsiteEditor({ tenant }: { tenant: Tenant }) {
  const api = `/api/workspaces/${tenant.slug}/website`;
  const [state, setState] = useState<WebsiteEditorState | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Branding");
  const [language, setLanguage] = useState<Locale>("en");
  const [selected, setSelected] = useState<WebsiteSection>("hero");
  const [dirty, setDirty] = useState(false);
  const [privateDirty, setPrivateDirty] = useState(false);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState("");
  const [preview, setPreview] = useState(false);
  const [mobile, setMobile] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(api, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("The website could not load. Try again.");
        const data: WebsiteEditorState = await response.json();
        websiteSnapshotSchema.parse(data.snapshot);
        setState(data);
        setError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [api, loaded]);
  useEffect(() => {
    /** Protect unsaved local edits when the browser leaves this page. */
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || privateDirty || privateBusy) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, privateDirty, privateBusy]);
  if (!state)
    return (
      <section className="website-editor">
        <h1>Edit website</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => setLoaded(loaded + 1)}>Try again</button>
          </>
        ) : (
          <p role="status">Loading your website…</p>
        )}
      </section>
    );
  const integrationTab = [
    "SMS Settings",
    "Telegram Settings",
    "Payment Settings",
  ].includes(tab);
  const snapshot = state.snapshot;
  /** Apply an isolated local edit and invalidate the saved preview without mutating the source snapshot. */
  const update = (edit: (next: Snapshot) => void) => {
    const next = structuredClone(snapshot);
    edit(next);
    setState({ ...state, snapshot: next });
    setDirty(true);
    setPreview(false);
    setMessage("");
    setError("");
  };
  /** Read localized draft text, using shared defaults only for approved optional public copy. */
  const text = (key: (typeof editableWebsiteContentKeys)[number]) =>
    snapshot.content[language]?.[key] ??
    (websiteContentKeys.includes(key as (typeof websiteContentKeys)[number])
      ? ""
      : translator(language)(key));
  /** Render labeled plain-text controls for the selected approved content keys. */
  const fields = (
    keys: readonly (typeof editableWebsiteContentKeys)[number][],
  ) =>
    keys.map((key) => (
      <label key={key}>
        {fieldLabel(key)}
        <textarea
          aria-label={fieldLabel(key)}
          rows={text(key).length > 140 ? 4 : 2}
          maxLength={3000}
          value={text(key)}
          onChange={(event) =>
            update((next) => {
              next.content[language] ??= {};
              next.content[language]![key] = event.target.value;
            })
          }
        />
        {["about.belief", "about.analystIntroduction"].includes(key) && (
          <small>Use {"{name}"} for the website or analyst name.</small>
        )}
      </label>
    ));
  const enabled = snapshot.languages.enabled;
  const missing = enabled.reduce(
    (total, locale) =>
      total +
      websiteContentKeys.filter(
        (key) => !snapshot.content[locale]?.[key]?.trim(),
      ).length,
    0,
  );
  const nav =
    snapshot.layout.navigation ??
    defaults.map((section) => ({
      section,
      label: {
        en:
          snapshot.content.en?.[`nav.${section}`] ??
          translator("en")(`nav.${section}`),
        hi:
          snapshot.content.hi?.[`nav.${section}`] ??
          translator("hi")(`nav.${section}`),
      },
    }));
  const order = snapshot.layout.sections ?? [...sectionIds];
  /** Move a section one position in the local draft; the controls preserve the fixed hero position. */
  const move = (index: number, direction: number) =>
    update((next) => {
      const sections = [...order];
      [sections[index], sections[index + direction]] = [
        sections[index + direction],
        sections[index],
      ];
      next.layout.sections = sections;
    });
  /** Save, explicitly rebase or publish with an optimistic version and stable retry key; retain edits on failure. */
  const request = async (action: "save" | "publish" | "rebase") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = JSON.stringify({
        action,
        id: state.id,
        version: state.version,
        ...(action !== "publish" ? { snapshot } : {}),
      });
      if (retry.current?.body !== body)
        retry.current = { body, key: crypto.randomUUID() };
      const response = await fetch(api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": retry.current.key,
        },
        body,
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setConflict(result.error);
          throw new Error(
            "This draft or live website changed in another session. Your edits are still here. Copy any changes you need before reloading the editor.",
          );
        }
        if (response.status === 403 || response.status === 401)
          throw new Error(
            "Your editor access has expired. Sign in again before saving.",
          );
        throw new Error(
          result.issues?.join("\n") ||
            "The website could not be saved. Try again.",
        );
      }
      setState({
        ...state,
        ...result,
        ...(action === "publish" ? { id: null, version: 0 } : {}),
      });
      setConflict("");
      retry.current = null;
      setDirty(false);
      setPreview(false);
      setMessage(
        action === "publish"
          ? "Website published. Visitors can see this revision now."
          : action === "rebase"
            ? "Publishing base updated. Preview this draft before publishing."
            : "Draft saved. Your live website has not changed.",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The request failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="website-editor" aria-busy={busy || privateBusy}>
      <div className="editor-heading">
        <div>
          <p>{tenant.profile.name} / Website</p>
          <h1>Edit website</h1>
          <p>
            Shape your research website. Save a draft, review it, then publish.
          </p>
        </div>
        <a href={`/ra/${tenant.slug}`} target="_blank" rel="noreferrer">
          View live website <ExternalLink size={15} />
        </a>
      </div>
      {!integrationTab && (
        <div className="editor-toolbar">
          <span className="editor-status">
            {dirty
              ? "Unsaved changes"
              : state.id
                ? `Saved draft · revision ${state.revision}`
                : state.revision
                  ? `Published · revision ${state.revision}`
                  : "New website"}
          </span>
          <div>
            <button
              disabled={busy || (!dirty && !!state.id)}
              onClick={() => void request("save")}
            >
              {busy ? "Working…" : "Save draft"}
            </button>
            <button
              disabled={busy || dirty || !state.id || missing > 0}
              onClick={() => setPreview(!preview)}
              aria-expanded={preview}
            >
              Preview
            </button>
            <button
              className="button primary"
              disabled={busy || dirty || !state.id || missing > 0}
              onClick={() => {
                if (
                  window.confirm(
                    "Publish this saved draft to your public website?",
                  )
                )
                  void request("publish");
              }}
            >
              Publish website
            </button>
          </div>
        </div>
      )}
      {!integrationTab && message && (
        <p role="status" className="editor-success">
          {message}
        </p>
      )}
      {!integrationTab && error && (
        <p role="alert" className="account-error editor-error">
          {error}
        </p>
      )}
      {!integrationTab && conflict && (
        <div className="editor-toolbar">
          <button
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Reload the saved draft? Unsaved local changes will be lost.",
                )
              ) {
                setState(null);
                setDirty(false);
                setConflict("");
                setLoaded(loaded + 1);
              }
            }}
          >
            Reload saved draft
          </button>
          {conflict === "stale_publication" && (
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Use this draft against the current live website? Review the live website first. Publishing this draft will replace its content; changes are not merged.",
                  )
                )
                  void request("rebase");
              }}
            >
              Update publishing base
            </button>
          )}
        </div>
      )}
      {!integrationTab && (
        <p className="editor-help">
          {missing
            ? `${missing} content fields need completing across enabled languages.`
            : "All enabled language fields are complete."}{" "}
          Save changes before previewing or publishing. Images use hosted HTTPS
          URLs.
        </p>
      )}
      {!integrationTab && preview && (
        <section className="editor-preview" aria-label="Saved draft preview">
          <div>
            <strong>Private draft preview</strong>
            <button onClick={() => setMobile(!mobile)}>
              {mobile ? "Desktop view" : "Mobile view"}
            </button>
            <a
              href={`/ra/${tenant.slug}/workspace/website/preview?lang=${language}`}
              target="_blank"
              rel="noreferrer"
            >
              Open preview <ExternalLink size={15} />
            </a>
          </div>
          <iframe
            key={`${state.version}-${language}`}
            title="Website draft preview"
            style={{ width: mobile ? "375px" : "100%" }}
            src={`/ra/${tenant.slug}/workspace/website/preview?lang=${language}`}
          />
        </section>
      )}
      <nav className="editor-tabs" aria-label="Website settings">
        {tabs.map((item) => (
          <button
            key={item}
            disabled={privateBusy}
            aria-current={tab === item ? "page" : undefined}
            onClick={() => {
              if (
                item !== tab &&
                privateDirty &&
                !window.confirm("Discard unsaved integration settings?")
              )
                return;
              setPrivateDirty(false);
              setTab(item);
            }}
          >
            {item}
          </button>
        ))}
      </nav>
      {!integrationTab && (
        <fieldset className="editor-panel" disabled={busy}>
          <legend className="sr-only">{tab}</legend>
          {tab === "Branding" && (
            <>
              <h2>Your website’s identity</h2>
              <p>
                Website identity is published with the draft. Your organisation
                account details stay separate.
              </p>
              <div className="editor-fields">
                {(
                  [
                    ["name", "Website name"],
                    ["legalName", "Legal name"],
                    ["monogram", "Brand initials"],
                    ["registration", "Registration number"],
                    ["contactEmail", "Contact email"],
                    ["contactPhone", "Contact phone"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type={key === "contactEmail" ? "email" : "text"}
                      maxLength={key === "monogram" ? 3 : 254}
                      value={snapshot.publicProfile[key] ?? ""}
                      onChange={(event) =>
                        update((next) => {
                          if (
                            key === "registration" ||
                            key === "contactEmail" ||
                            key === "contactPhone"
                          )
                            next.publicProfile[key] =
                              event.target.value || null;
                          else next.publicProfile[key] = event.target.value;
                        })
                      }
                    />
                  </label>
                ))}
                {(
                  [
                    ["accent", "Theme colour"],
                    ["surface", "Visual background"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="color"
                      value={snapshot.branding[key] ?? "#244b3b"}
                      onChange={(event) =>
                        update((next) => {
                          next.branding[key] = event.target.value;
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Font
                  <select
                    value={snapshot.branding.font ?? "classic"}
                    onChange={(event) =>
                      update((next) => {
                        next.branding.font = event.target.value as
                          "classic" | "sans";
                      })
                    }
                  >
                    <option value="classic">Classic serif</option>
                    <option value="sans">Modern sans serif</option>
                  </select>
                </label>
                <label>
                  Page layout
                  <select
                    value={snapshot.layout.template ?? "classic"}
                    onChange={(event) =>
                      update((next) => {
                        next.layout.template = event.target.value as
                          "classic" | "editorial";
                      })
                    }
                  >
                    <option value="classic">
                      Classic with research compass
                    </option>
                    <option value="editorial">Editorial, text first</option>
                  </select>
                </label>
                <label>
                  Default language
                  <select
                    value={snapshot.languages.default}
                    onChange={(event) =>
                      update((next) => {
                        next.languages.default = event.target.value as Locale;
                      })
                    }
                  >
                    {enabled.map((locale) => (
                      <option value={locale} key={locale}>
                        {locale === "en" ? "English" : "हिन्दी"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="editor-check">
                <input
                  type="checkbox"
                  checked={enabled.includes("hi")}
                  disabled={snapshot.languages.default === "hi"}
                  onChange={(event) =>
                    update((next) => {
                      if (event.target.checked) {
                        next.languages.enabled.push("hi");
                        next.content.hi ??= {};
                      } else {
                        next.languages.enabled = next.languages.enabled.filter(
                          (locale) => locale !== "hi",
                        );
                        delete next.content.hi;
                        setLanguage("en");
                      }
                    })
                  }
                />
                Enable Hindi content
              </label>
            </>
          )}
          {tab === "Navigation" && (
            <>
              <h2>Navigation</h2>
              <p>
                Choose links and their order. Labels can be different in English
                and Hindi.
              </p>
              {nav.map((item, index) => (
                <div className="editor-nav-row" key={item.section}>
                  <label>
                    Section
                    <select
                      value={item.section}
                      onChange={(event) =>
                        update((next) => {
                          next.layout.navigation = nav.map((entry, i) =>
                            i === index
                              ? {
                                  ...entry,
                                  section: event.target.value as WebsiteSection,
                                }
                              : entry,
                          );
                        })
                      }
                    >
                      {order
                        .filter(
                          (section) =>
                            section === item.section ||
                            !nav.some((entry) => entry.section === section),
                        )
                        .map((section) => (
                          <option value={section} key={section}>
                            {names[section]}
                          </option>
                        ))}
                    </select>
                  </label>
                  {(["en", "hi"] as const).map((locale) => (
                    <label key={locale}>
                      {locale === "en" ? "English label" : "Hindi label"}
                      <input
                        maxLength={60}
                        value={item.label[locale]}
                        onChange={(event) =>
                          update((next) => {
                            next.layout.navigation = nav.map((entry, i) =>
                              i === index
                                ? {
                                    ...entry,
                                    label: {
                                      ...entry.label,
                                      [locale]: event.target.value,
                                    },
                                  }
                                : entry,
                            );
                          })
                        }
                      />
                    </label>
                  ))}
                  <button
                    aria-label={`Move ${names[item.section]} link up`}
                    disabled={index === 0}
                    onClick={() =>
                      update((next) => {
                        const items = [...nav];
                        [items[index - 1], items[index]] = [
                          items[index],
                          items[index - 1],
                        ];
                        next.layout.navigation = items;
                      })
                    }
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    aria-label={`Remove ${names[item.section]} link`}
                    onClick={() =>
                      update((next) => {
                        next.layout.navigation = nav.filter(
                          (_, i) => i !== index,
                        );
                      })
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
              <button
                disabled={nav.length >= order.length}
                onClick={() =>
                  update((next) => {
                    const section = order.find(
                      (id) => !nav.some((item) => item.section === id),
                    )!;
                    next.layout.navigation = [
                      ...nav,
                      {
                        section,
                        label: { en: names[section], hi: names[section] },
                      },
                    ];
                  })
                }
              >
                <Plus size={17} /> Add navigation link
              </button>
              {fields(
                editableWebsiteContentKeys.filter(
                  (key) => key.startsWith("nav.") || key.startsWith("brand."),
                ),
              )}
            </>
          )}
          {tab === "Sections" && (
            <>
              <h2>Landing page sections</h2>
              <p>
                Arrange the page and edit each section. Required research and
                investor sections remain available.
              </p>
              <div className="editor-section-layout">
                <div className="editor-section-list">
                  {order.map((section, index) => (
                    <div
                      key={section}
                      className={selected === section ? "selected" : ""}
                    >
                      <button
                        onClick={() => setSelected(section)}
                        aria-pressed={selected === section}
                      >
                        {names[section]}
                        <small>
                          {requiredSections.includes(section)
                            ? "Required"
                            : "Optional"}
                        </small>
                      </button>
                      <button
                        aria-label={`Move ${names[section]} up`}
                        disabled={index <= 1}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        aria-label={`Move ${names[section]} down`}
                        disabled={index === 0 || index === order.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                      {!requiredSections.includes(section) && (
                        <button
                          aria-label={`Remove ${names[section]}`}
                          onClick={() =>
                            update((next) => {
                              next.layout.sections = order.filter(
                                (id) => id !== section,
                              );
                              next.layout.navigation = nav.filter(
                                (item) => item.section !== section,
                              );
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                  {sectionIds
                    .filter((id) => !order.includes(id))
                    .map((section) => (
                      <button
                        key={section}
                        onClick={() => {
                          update((next) => {
                            next.layout.sections = [...order, section];
                          });
                          setSelected(section);
                        }}
                      >
                        <Plus size={16} /> Add {names[section]}
                      </button>
                    ))}
                </div>
                <div>
                  <h3>{names[selected]}</h3>
                  <label>
                    Section layout
                    <select
                      value={
                        snapshot.layout.sectionStyles?.[selected] ?? "default"
                      }
                      onChange={(event) =>
                        update((next) => {
                          next.layout.sectionStyles ??= {};
                          next.layout.sectionStyles[selected] = event.target
                            .value as "default" | "stacked" | "reversed";
                        })
                      }
                    >
                      <option value="default">Original layout</option>
                      <option value="stacked">Stacked content</option>
                      <option value="reversed">Reversed columns</option>
                    </select>
                  </label>
                  <label>
                    Image URL
                    <input
                      type="url"
                      placeholder="https://…"
                      value={snapshot.layout.images?.[selected]?.src ?? ""}
                      onChange={(event) =>
                        update((next) => {
                          next.layout.images ??= {};
                          if (!event.target.value)
                            delete next.layout.images[selected];
                          else
                            next.layout.images[selected] = {
                              src: event.target.value,
                              alt: next.layout.images[selected]?.alt ?? {
                                en: "",
                                hi: "",
                              },
                            };
                        })
                      }
                    />
                  </label>
                  {snapshot.layout.images?.[selected] &&
                    (["en", "hi"] as const).map((locale) => (
                      <label key={locale}>
                        Image description (
                        {locale === "en" ? "English" : "Hindi"}
                        )
                        <input
                          maxLength={200}
                          value={
                            snapshot.layout.images?.[selected]?.alt[locale] ??
                            ""
                          }
                          onChange={(event) =>
                            update((next) => {
                              next.layout.images![selected]!.alt[locale] =
                                event.target.value;
                            })
                          }
                        />
                      </label>
                    ))}
                  <LanguageSelect
                    value={language}
                    onChange={setLanguage}
                    enabled={enabled}
                  />
                  {fields(
                    editableWebsiteContentKeys.filter(
                      (key) =>
                        key.startsWith(`${selected}.`) ||
                        (selected === "hero" && key.startsWith("site.")) ||
                        (selected === "research" &&
                          key.startsWith("services.")) ||
                        (selected === "approach" &&
                          key.startsWith("framework.")),
                    ),
                  )}
                </div>
              </div>
            </>
          )}
          {(tab === "Content" || tab === "Footer") && (
            <>
              <h2>
                {tab === "Footer"
                  ? "Footer & disclosures"
                  : "Bilingual website content"}
              </h2>
              <p>
                {tab === "Footer"
                  ? "Edit footer links, contact wording, policies and disclosures in each enabled language."
                  : "All website text, including page description, buttons and supporting labels."}
              </p>
              {tab === "Footer" && (
                <label>
                  Footer layout
                  <select
                    value={snapshot.layout.footer ?? "columns"}
                    onChange={(event) =>
                      update((next) => {
                        next.layout.footer = event.target.value as
                          "columns" | "compact";
                      })
                    }
                  >
                    <option value="columns">Columns</option>
                    <option value="compact">Compact</option>
                  </select>
                </label>
              )}
              <LanguageSelect
                value={language}
                onChange={setLanguage}
                enabled={enabled}
              />
              {fields(
                editableWebsiteContentKeys.filter(
                  (key) =>
                    tab === "Content" ||
                    /^(footer|disclosures|policies|analyst)\./.test(key),
                ),
              )}
            </>
          )}
        </fieldset>
      )}
      {tab === "SMS Settings" && (
        <SmsSettings
          slug={tenant.slug}
          onDirtyChange={setPrivateDirty}
          onBusyChange={setPrivateBusy}
        />
      )}
      {tab === "Telegram Settings" && (
        <IntegrationSettings
          slug={tenant.slug}
          kind="telegram"
          onDirtyChange={setPrivateDirty}
          onBusyChange={setPrivateBusy}
        />
      )}
      {tab === "Payment Settings" && (
        <PaymentSettings
          slug={tenant.slug}
          onDirtyChange={setPrivateDirty}
          onBusyChange={setPrivateBusy}
        />
      )}
    </section>
  );
}

/** Keep content language selection independent from the public default language. */
function LanguageSelect({
  value,
  onChange,
  enabled,
}: {
  value: Locale;
  onChange: (value: Locale) => void;
  enabled: Locale[];
}) {
  return (
    <label>
      Editing language
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Locale)}
      >
        {enabled.map((locale) => (
          <option key={locale} value={locale}>
            {locale === "en" ? "English" : "हिन्दी"}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Present stable content keys as readable editorial field names. */
function fieldLabel(key: string) {
  const explicit: Record<string, string> = {
    "site.hero": "Hero headline",
    "site.introduction": "Hero introduction",
    "site.description": "Website description",
  };
  if (explicit[key]) return explicit[key];
  const label = key.replaceAll(".", " ").replace(/([A-Z])/g, " $1");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
