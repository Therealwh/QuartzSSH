import { create } from "zustand";
import { DEFAULT_THEME_ID, THEMES, applyThemeToDom, getTheme } from "../themes";
import type { LanguageId } from "../i18n";

export interface UiSettings {
  themeId: string;
  language: LanguageId;
  fontFamily: string;
  fontSize: number;
}

const STORAGE_KEY = "quartzssh.ui";

const DEFAULTS: UiSettings = {
  themeId: DEFAULT_THEME_ID,
  language: "en",
  fontFamily: "Cascadia Mono, Consolas, Menlo, monospace",
  fontSize: 14,
};

function load(): UiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // ignore corrupted storage
  }
  return { ...DEFAULTS };
}

function persist(state: UiSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage may be unavailable
  }
}

interface SettingsStore extends UiSettings {
  setTheme: (id: string) => void;
  setLanguage: (lang: LanguageId) => void;
  setFont: (family: string, size: number) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  setTheme: (id) => {
    applyThemeToDom(getTheme(id));
    const next = { ...get(), themeId: id };
    persist(next);
    set({ themeId: id });
  },
  setLanguage: (lang) => {
    const next = { ...get(), language: lang };
    persist(next);
    set({ language: lang });
  },
  setFont: (family, size) => {
    const next = { ...get(), fontFamily: family, fontSize: size };
    persist(next);
    set({ fontFamily: family, fontSize: size });
  },
}));

export function applyStartupTheme(state: UiSettings) {
  applyThemeToDom(getTheme(state.themeId));
}

/** Cycle to the next built-in theme (Ctrl+Shift+T). */
export function cycleTheme() {
  const { themeId, setTheme } = useSettings.getState();
  const index = THEMES.findIndex((theme) => theme.id === themeId);
  setTheme(THEMES[(index + 1) % THEMES.length].id);
}
