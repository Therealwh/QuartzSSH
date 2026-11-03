import { create } from "zustand";
import {
  DEFAULT_THEME_ID,
  THEMES,
  applyThemeToDom,
  getTheme,
  isValidTheme,
  registerCustomThemes,
  setTerminalBgOpacity,
} from "../themes";
import type { Theme } from "../themes";
import type { LanguageId } from "../i18n";

export interface UiSettings {
  themeId: string;
  language: LanguageId;
  fontFamily: string;
  fontSize: number;
  /** Background opacity for UI and terminal, 0.7–1 (1 = fully opaque). */
  bgOpacity: number;
  /** User-defined themes created with the built-in theme builder. */
  customThemes: Theme[];
}

const STORAGE_KEY = "quartzssh.ui";
const MIN_OPACITY = 0.7;

const DEFAULTS: UiSettings = {
  themeId: DEFAULT_THEME_ID,
  language: "en",
  fontFamily: "JetBrains Mono Variable, Cascadia Mono, Consolas, Menlo, monospace",
  fontSize: 14,
  bgOpacity: 1,
  customThemes: [],
};

function clampOpacity(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(1, Math.max(MIN_OPACITY, n));
}

function load(): UiSettings {
  let state: UiSettings = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<UiSettings>) };
  } catch {
    // ignore corrupted storage
  }
  // Normalize untrusted values (storage may be corrupted or hand-edited).
  state.bgOpacity = clampOpacity(state.bgOpacity);
  state.customThemes = Array.isArray(state.customThemes)
    ? state.customThemes.filter(isValidTheme)
    : [];
  // Make custom themes resolvable by getTheme even before the store is used.
  registerCustomThemes(state.customThemes);
  setTerminalBgOpacity(state.bgOpacity);
  return state;
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
  setBgOpacity: (opacity: number) => void;
  /** Insert or replace a user-defined theme (persisted immediately). */
  saveCustomTheme: (theme: Theme) => void;
  deleteCustomTheme: (id: string) => void;
}

const initial = load();

export const useSettings = create<SettingsStore>((set, get) => ({
  ...initial,
  setTheme: (id) => {
    applyThemeToDom(getTheme(id), get().bgOpacity);
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
  setBgOpacity: (opacity) => {
    const bgOpacity = clampOpacity(opacity);
    setTerminalBgOpacity(bgOpacity);
    applyThemeToDom(getTheme(get().themeId), bgOpacity);
    const next = { ...get(), bgOpacity };
    persist(next);
    set({ bgOpacity });
  },
  saveCustomTheme: (theme) => {
    if (!isValidTheme(theme)) return;
    const customThemes = [...get().customThemes.filter((t) => t.id !== theme.id), theme];
    registerCustomThemes(customThemes);
    const next = { ...get(), customThemes };
    persist(next);
    set({ customThemes });
  },
  deleteCustomTheme: (id) => {
    const customThemes = get().customThemes.filter((t) => t.id !== id);
    registerCustomThemes(customThemes);
    const next = { ...get(), customThemes };
    persist(next);
    set({ customThemes });
    // Never leave a dangling active theme id.
    if (get().themeId === id) get().setTheme(DEFAULT_THEME_ID);
  },
}));

export function applyStartupTheme(state: UiSettings) {
  applyThemeToDom(getTheme(state.themeId), state.bgOpacity ?? 1);
}

/** Cycle to the next built-in theme (Ctrl+Shift+T). */
export function cycleTheme() {
  const { themeId, setTheme } = useSettings.getState();
  const index = THEMES.findIndex((theme) => theme.id === themeId);
  setTheme(THEMES[(index + 1) % THEMES.length].id);
}
