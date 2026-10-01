import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, resolveLocale } from "@pi-desktop/i18n";

void i18n.use(initReactI18next).init({
  lng: localStorage.getItem("pi.mobile.language") ?? resolveLocale(navigator.language),
  fallbackLng: "en", interpolation: { escapeValue: false },
  resources: Object.fromEntries(Object.entries(catalogs).map(([locale, translation]) => [locale, { translation }])),
});

export default i18n;
