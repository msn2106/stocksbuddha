import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Settings2, X } from "lucide-react";
import { useLanguage } from "../i18n";
import { localeOptions } from "../locales/messages";

const defaults = { textSize: 100, contrast: false, motion: false };
const storageKey = "ra-display-preferences-v1";

export function AccessibilityControls() {
  const { locale, t } = useLanguage();
  const [settings, setSettings] = useState(defaults);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (saved)
        setSettings({
          textSize: [100, 125, 150, 200].includes(saved.textSize)
            ? saved.textSize
            : 100,
          contrast: saved.contrast === true,
          motion: saved.motion === true,
        });
    } catch {
      /* Storage is optional; controls continue to work in memory. */
    }
    setLoaded(true);
    try {
      document.cookie = `ra-language=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      /* Explicit language links work even if cookies are unavailable. */
    }
  }, [locale]);
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.style.fontSize = `${settings.textSize}%`;
    document.documentElement.dataset.contrast = settings.contrast
      ? "high"
      : "standard";
    document.documentElement.dataset.reducedMotion = String(settings.motion);
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {
      /* See above. */
    }
  }, [settings, loaded]);
  return (
    <div
      className="accessibility-toolbar"
      role="region"
      aria-label={t("a11y.regionLabel")}
    >
      <div className="container toolbar-inner">
        <nav aria-label={t("languages.label")} className="language-switch">
          {localeOptions.map(({ code, labelKey }) => (
            <a
              key={code}
              href={`?lang=${code}`}
              lang={code}
              hrefLang={code}
              aria-current={locale === code ? "page" : undefined}
            >
              {t(labelKey)}
            </a>
          ))}
        </nav>
        <Dialog.Root>
          <Dialog.Trigger className="preferences-trigger">
            <Settings2 size={18} aria-hidden="true" />
            {t("preferences.title")}
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content preferences-dialog">
              <Dialog.Close
                className="dialog-close"
                aria-label={t("common.closeDialog")}
              >
                <X size={22} aria-hidden="true" />
              </Dialog.Close>
              <Dialog.Title>{t("preferences.title")}</Dialog.Title>
              <Dialog.Description>
                {t("preferences.description")}
              </Dialog.Description>
              <fieldset className="text-size-options">
                <legend>{t("preferences.textSize")}</legend>
                {(
                  [
                    [100, "preferences.standard"],
                    [125, "preferences.large"],
                    [150, "preferences.extraLarge"],
                    [200, "preferences.double"],
                  ] as const
                ).map(([size, label]) => (
                  <label key={size}>
                    <input
                      type="radio"
                      name="text-size"
                      value={size}
                      checked={settings.textSize === size}
                      onChange={() =>
                        setSettings({ ...settings, textSize: size })
                      }
                    />
                    {t(label)} ({size}%)
                  </label>
                ))}
              </fieldset>
              <label className="preference-checkbox">
                <input
                  type="checkbox"
                  checked={settings.contrast}
                  onChange={(event) =>
                    setSettings({ ...settings, contrast: event.target.checked })
                  }
                />
                {t("preferences.highContrast")}
              </label>
              <label className="preference-checkbox">
                <input
                  type="checkbox"
                  checked={settings.motion}
                  onChange={(event) =>
                    setSettings({ ...settings, motion: event.target.checked })
                  }
                />
                {t("preferences.reduceMotion")}
              </label>
              <details className="accessibility-help">
                <summary>{t("a11y.helpTitle")}</summary>
                <p>{t("a11y.keyboardHelp")}</p>
                <p>{t("a11y.storageHelp")}</p>
                <h3>{t("a11y.feedbackTitle")}</h3>
                <p>{t("a11y.feedbackDescription")}</p>
              </details>
              <div className="preferences-actions">
                <button
                  className="button secondary"
                  onClick={() => setSettings(defaults)}
                >
                  {t("preferences.reset")}
                </button>
                <Dialog.Close className="button primary">
                  {t("common.done")}
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}
