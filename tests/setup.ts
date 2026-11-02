import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "../src/i18n/ru.json";
import en from "../src/i18n/en.json";

// One shared i18next instance for component tests.
void i18next.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: "ru",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});
