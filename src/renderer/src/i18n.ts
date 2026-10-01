/* eslint-disable import/no-extraneous-dependencies */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Import translation resources
import enTranslation from "./locales/en/translation.json";
import zhTranslation from "./locales/zh/translation.json";
import trTranslation from "./locales/tr-TR/translation.json";

// Configure i18next instance
i18n
  // Detect user language
  .use(LanguageDetector)
  // Pass the i18n instance to react-i18next
  .use(initReactI18next)
  // Initialize i18next
  .init({
    // Default language when detection fails
    fallbackLng: "tr-TR",
    // Debug mode for development
    debug: process.env.NODE_ENV === "development",
    // Namespaces configuration
    defaultNS: "translation",
    ns: ["translation"],
    // Resources containing translations
    resources: {
      "tr-TR": { translation: trTranslation },
      en: {
        translation: enTranslation,
      },
      zh: {
        translation: zhTranslation,
      },
    },
    // Language detection options
    detection: {
      // Order and from where user language should be detected
      order: ["localStorage"],
      // Cache user language detection
      caches: ["localStorage"],
      // HTML attribute with which to set language
      htmlTag: document.documentElement,
    },
    // Escaping special characters
    interpolation: {
      escapeValue: false, // React already safes from XSS
    },
    // React config
    react: {
      useSuspense: true,
    },
  });

// Save language change to localStorage
i18n.on("languageChanged", (lng) => {
  localStorage.setItem("i18nextLng", lng);
  // Update HTML document lang attribute
  document.documentElement.lang = lng;
});

export default i18n;
