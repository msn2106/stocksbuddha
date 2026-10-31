import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@ra/contracts";
import { translator } from "./locales/messages";

const LanguageContext = createContext({
  locale: "en" as Locale,
  t: translator("en"),
});
export function LanguageProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LanguageContext.Provider value={{ locale, t: translator(locale) }}>
      {children}
    </LanguageContext.Provider>
  );
}
export const useLanguage = () => useContext(LanguageContext);
