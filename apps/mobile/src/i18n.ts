import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, resolveLocale } from "@pi-desktop/i18n";

declare global {
  interface Window { __PI_MOBILE_MISSING_KEYS__?: string[] }
}

function savedLanguage(): string | null {
  try { return localStorage.getItem("pi.mobile.language"); } catch { return null; }
}

// Acceptance builds record keys absent from a catalog so user flows can assert on them.
const recordMissing = import.meta.env.MODE === "acceptance";
if (recordMissing) window.__PI_MOBILE_MISSING_KEYS__ = [];

void i18n.use(initReactI18next).init({
  lng: savedLanguage() ?? resolveLocale(navigator.language),
  fallbackLng: "en", interpolation: { escapeValue: false },
  resources: Object.fromEntries(Object.entries(catalogs).map(([locale, translation]) => [locale, { translation }])),
  ...(recordMissing ? {
    saveMissing: true,
    missingKeyHandler: (_languages: readonly string[], _namespace: string, key: string, _fallback: string, _update: boolean, options?: { defaultValue?: unknown }) => {
      // Server codes and messages are deliberately looked up with a default text.
      if (options?.defaultValue === undefined) window.__PI_MOBILE_MISSING_KEYS__?.push(key);
    },
  } : {}),
});

export default i18n;
