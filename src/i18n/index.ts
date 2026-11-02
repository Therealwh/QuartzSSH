import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ru from "./ru.json";

export const LANGUAGES = [
  { id: "ru", label: "Русский" },
  { id: "en", label: "English" },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]["id"];

export async function initI18n(language: LanguageId) {
  await i18next.use(initReactI18next).init({
    resources: {
      ru: { translation: ru },
      en: { translation: en },
    },
    lng: language,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export async function changeLanguage(language: LanguageId) {
  await i18next.changeLanguage(language);
}
