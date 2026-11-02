// Built-in color schemes. Each theme drives both the UI (CSS variables)
// and the terminal (xterm palette), so switching is instant and global.

export interface ThemeUi {
  bg: string;
  panel: string;
  elevated: string;
  hover: string;
  active: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  danger: string;
  warning: string;
  success: string;
}

export interface ThemeTerm {
  bg: string;
  fg: string;
  cursor: string;
  selection: string;
  /** 16 ANSI colors: black, red, green, yellow, blue, magenta, cyan, white, bright* */
  ansi: string[];
}

export interface Theme {
  id: string;
  name: string;
  isDark: boolean;
  ui: ThemeUi;
  term: ThemeTerm;
}

export const THEMES: Theme[] = [
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    isDark: true,
    ui: {
      bg: "#1e1e2e",
      panel: "#181825",
      elevated: "#313244",
      hover: "#45475a",
      active: "#45475a",
      border: "#313244",
      text: "#cdd6f4",
      muted: "#a6adc8",
      accent: "#b4befe",
      accentText: "#1e1e2e",
      danger: "#f38ba8",
      warning: "#f9e2af",
      success: "#a6e3a1",
    },
    term: {
      bg: "#1e1e2e",
      fg: "#cdd6f4",
      cursor: "#f5e0dc",
      selection: "#45475a",
      ansi: [
        "#45475a", "#f38ba8", "#a6e3a1", "#f9e2af",
        "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
        "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af",
        "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8",
      ],
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    isDark: true,
    ui: {
      bg: "#282a36",
      panel: "#21222c",
      elevated: "#44475a",
      hover: "#3a3d4d",
      active: "#44475a",
      border: "#191a21",
      text: "#f8f8f2",
      muted: "#6272a4",
      accent: "#bd93f9",
      accentText: "#282a36",
      danger: "#ff5555",
      warning: "#f1fa8c",
      success: "#50fa7b",
    },
    term: {
      bg: "#282a36",
      fg: "#f8f8f2",
      cursor: "#f8f8f2",
      selection: "#44475a",
      ansi: [
        "#21222c", "#ff5555", "#50fa7b", "#f1fa8c",
        "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
        "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5",
        "#d6acff", "#ff92df", "#a4ffff", "#ffffff",
      ],
    },
  },
  {
    id: "nord",
    name: "Nord",
    isDark: true,
    ui: {
      bg: "#2e3440",
      panel: "#292e39",
      elevated: "#3b4252",
      hover: "#434c5e",
      active: "#434c5e",
      border: "#3b4252",
      text: "#eceff4",
      muted: "#d8dee9",
      accent: "#88c0d0",
      accentText: "#2e3440",
      danger: "#bf616a",
      warning: "#ebcb8b",
      success: "#a3be8c",
    },
    term: {
      bg: "#2e3440",
      fg: "#e5e9f0",
      cursor: "#d8dee9",
      selection: "#434c5e",
      ansi: [
        "#3b4252", "#bf616a", "#a3be8c", "#ebcb8b",
        "#81a1c1", "#b48ead", "#8fbcbb", "#e5e9f0",
        "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b",
        "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
      ],
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    isDark: true,
    ui: {
      bg: "#1a1b26",
      panel: "#16161e",
      elevated: "#292e42",
      hover: "#2f334d",
      active: "#292e42",
      border: "#1f2233",
      text: "#c0caf5",
      muted: "#565f89",
      accent: "#7aa2f7",
      accentText: "#1a1b26",
      danger: "#f7768e",
      warning: "#e0af68",
      success: "#9ece6a",
    },
    term: {
      bg: "#1a1b26",
      fg: "#c0caf5",
      cursor: "#c0caf5",
      selection: "#33467c",
      ansi: [
        "#15161e", "#f7768e", "#9ece6a", "#e0af68",
        "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6",
        "#414868", "#f7768e", "#9ece6a", "#e0af68",
        "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5",
      ],
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    isDark: true,
    ui: {
      bg: "#002b36",
      panel: "#073642",
      elevated: "#0a4250",
      hover: "#0e4d5c",
      active: "#0a4250",
      border: "#073642",
      text: "#839496",
      muted: "#586e75",
      accent: "#268bd2",
      accentText: "#fdf6e3",
      danger: "#dc322f",
      warning: "#b58900",
      success: "#859900",
    },
    term: {
      bg: "#002b36",
      fg: "#839496",
      cursor: "#93a1a1",
      selection: "#073642",
      ansi: [
        "#073642", "#dc322f", "#859900", "#b58900",
        "#268bd2", "#d33682", "#2aa198", "#eee8d5",
        "#002b36", "#cb4b16", "#586e75", "#657b83",
        "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
      ],
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    isDark: true,
    ui: {
      bg: "#282828",
      panel: "#1d2021",
      elevated: "#3c3836",
      hover: "#504945",
      active: "#504945",
      border: "#3c3836",
      text: "#ebdbb2",
      muted: "#928374",
      accent: "#fe8019",
      accentText: "#282828",
      danger: "#fb4934",
      warning: "#fabd2f",
      success: "#b8bb26",
    },
    term: {
      bg: "#282828",
      fg: "#ebdbb2",
      cursor: "#ebdbb2",
      selection: "#504945",
      ansi: [
        "#3c3836", "#cc241d", "#98971a", "#d79921",
        "#458588", "#b16286", "#689d6a", "#a89984",
        "#928374", "#fb4934", "#b8bb26", "#fabd2f",
        "#83a598", "#d3869b", "#8ec07c", "#ebdbb2",
      ],
    },
  },
  {
    id: "one-dark",
    name: "One Dark",
    isDark: true,
    ui: {
      bg: "#282c34",
      panel: "#21252b",
      elevated: "#333842",
      hover: "#3e4451",
      active: "#3e4451",
      border: "#181a1f",
      text: "#abb2bf",
      muted: "#5c6370",
      accent: "#61afef",
      accentText: "#282c34",
      danger: "#e06c75",
      warning: "#e5c07b",
      success: "#98c379",
    },
    term: {
      bg: "#282c34",
      fg: "#abb2bf",
      cursor: "#528bff",
      selection: "#3e4451",
      ansi: [
        "#282c34", "#e06c75", "#98c379", "#e5c07b",
        "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
        "#5c6370", "#e06c75", "#98c379", "#e5c07b",
        "#61afef", "#c678dd", "#56b6c2", "#ffffff",
      ],
    },
  },
  {
    // Spec 20.3: maximum-contrast scheme (pure black background, white text,
    // yellow accent). Every text-bearing pair stays at or above the WCAG AAA
    // 7:1 threshold and the ANSI palette stays at or above 4.5:1 against the
    // terminal background; see tests/highContrast.test.ts.
    id: "high-contrast",
    name: "High Contrast",
    isDark: true,
    ui: {
      bg: "#000000",
      panel: "#000000",
      elevated: "#1a1a1a",
      hover: "#2e2e2e",
      active: "#3a3a3a",
      border: "#bfbfbf",
      text: "#ffffff",
      muted: "#bfbfbf",
      accent: "#ffff00",
      accentText: "#000000",
      danger: "#ff5555",
      warning: "#ffcc00",
      success: "#00ff00",
    },
    term: {
      bg: "#000000",
      fg: "#ffffff",
      cursor: "#ffff00",
      selection: "#005f87",
      ansi: [
        // The "black" slot is mid-gray so black text is still visible on the
        // black background; every other slot is a fully saturated hue.
        "#7f7f7f", "#ff5555", "#55ff55", "#ffff55",
        "#6666ff", "#ff55ff", "#55ffff", "#ffffff",
        "#bfbfbf", "#ff8080", "#80ff80", "#ffff80",
        "#8080ff", "#ff80ff", "#80ffff", "#ffffff",
      ],
    },
  },
];

export const DEFAULT_THEME_ID = "catppuccin-mocha";

// ---------------------------------------------------------------------------
// Color helpers (pure functions, unit-tested in tests/customTheme.test.ts)
// ---------------------------------------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(color: string): Rgb | null {
  let hex = color.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/** WCAG relative luminance of a hex color (0 = black, 1 = white). */
export function luminanceOf(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** A background counts as dark when its relative luminance is below the midpoint. */
export function isDarkColor(color: string): boolean {
  return luminanceOf(color) < 0.5;
}

/** "#RRGGBB" + opacity → rgba(); at full opacity the hex is kept as-is. */
export function withAlpha(color: string, opacity: number): string {
  if (opacity >= 1) return color;
  const rgb = parseHex(color);
  if (!rgb) return color;
  const alpha = Number(Math.min(1, Math.max(0, opacity)).toFixed(3));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** URL/id-safe slug: "My Cool Theme!" → "my-cool-theme"; fallback "theme". */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    // Combining marks (\p{M}) are kept so accents survive (NFC re-composes them).
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .normalize("NFC");
  return slug.length > 0 ? slug : "theme";
}

// ---------------------------------------------------------------------------
// Custom (user-defined) themes
// ---------------------------------------------------------------------------

/** Structurally validates an untrusted value (localStorage may be hand-edited). */
export function isValidTheme(value: unknown): value is Theme {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Theme;
  return (
    typeof t.id === "string" &&
    t.id.length > 0 &&
    typeof t.name === "string" &&
    typeof t.isDark === "boolean" &&
    typeof t.ui === "object" &&
    t.ui !== null &&
    typeof t.term === "object" &&
    t.term !== null &&
    Array.isArray(t.term.ansi) &&
    t.term.ansi.length === 16
  );
}

// Custom themes live in the settings store, but getTheme() may be called before
// the store module is initialized (or from modules that must not import it).
// The store therefore pushes its persisted list into this registry at startup
// and on every change; an empty registry simply falls back to built-ins.
let customThemes: Theme[] = [];

/** Replace the resolvable set of user-defined themes (no-op for invalid input). */
export function registerCustomThemes(themes: Theme[]) {
  customThemes = Array.isArray(themes) ? themes.filter(isValidTheme) : [];
}

export function getCustomThemes(): readonly Theme[] {
  return customThemes;
}

/** All themes available for the picker: built-ins first, then custom ones. */
export function allThemes(): Theme[] {
  return [...THEMES, ...customThemes];
}

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? customThemes.find((t) => t.id === id) ?? THEMES[0];
}

/** Fields the theme builder edits directly; everything else is inherited. */
export interface CustomThemeDraft {
  name: string;
  baseId: string;
  uiBg: string;
  uiPanel: string;
  uiAccent: string;
  uiText: string;
  termBg: string;
  termFg: string;
  termCursor: string;
  termSelection: string;
  /** 16 ANSI colors; a short list is padded from the base theme. */
  ansi: string[];
}

/** Build a full Theme out of the builder fields (id: custom-<slug>). */
export function buildCustomTheme(draft: CustomThemeDraft): Theme {
  const base = getTheme(draft.baseId);
  const name = draft.name.trim() || base.name;
  const ansi = Array.isArray(draft.ansi) ? draft.ansi.slice(0, 16) : [];
  while (ansi.length < 16) ansi.push(base.term.ansi[ansi.length]);
  return {
    id: `custom-${slugify(name)}`,
    name,
    isDark: isDarkColor(draft.uiBg),
    ui: {
      ...base.ui,
      bg: draft.uiBg,
      panel: draft.uiPanel,
      accent: draft.uiAccent,
      text: draft.uiText,
    },
    term: {
      bg: draft.termBg,
      fg: draft.termFg,
      cursor: draft.termCursor,
      selection: draft.termSelection,
      ansi,
    },
  };
}

// ---------------------------------------------------------------------------
// Terminal background opacity (spec 4.3)
// ---------------------------------------------------------------------------

// Kept here (not in the store) so xtermThemeOf can be called from anywhere
// without a circular import; the settings store pushes the persisted value.
let terminalBgOpacity = 1;

/** Clamp to the supported 70–100% range and remember it for xterm themes. */
export function setTerminalBgOpacity(opacity: number) {
  const value = typeof opacity === "number" && Number.isFinite(opacity) ? opacity : 1;
  terminalBgOpacity = Math.min(1, Math.max(0.7, value));
}

export function terminalBgOpacityOf(): number {
  return terminalBgOpacity;
}

export function xtermThemeOf(theme: Theme, bgOpacity: number = terminalBgOpacity) {
  const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = theme.term.ansi;
  return {
    background: withAlpha(theme.term.bg, bgOpacity),
    foreground: theme.term.fg,
    cursor: theme.term.cursor,
    cursorAccent: theme.term.bg,
    selectionBackground: theme.term.selection,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  };
}

/**
 * Push the theme into the CSS variables. bgOpacity < 1 blends --q-bg with the
 * backdrop (hex → rgba); it also becomes the terminal background opacity, so
 * xterm and the UI stay in sync. Default 1 = fully opaque.
 */
export function applyThemeToDom(theme: Theme, bgOpacity = 1) {
  const root = document.documentElement;
  const ui = theme.ui;
  setTerminalBgOpacity(bgOpacity);
  const vars: Record<string, string> = {
    "--q-bg": withAlpha(ui.bg, bgOpacity),
    "--q-panel": ui.panel,
    "--q-elevated": ui.elevated,
    "--q-hover": ui.hover,
    "--q-active": ui.active,
    "--q-border": ui.border,
    "--q-text": ui.text,
    "--q-muted": ui.muted,
    "--q-accent": ui.accent,
    "--q-accent-text": ui.accentText,
    "--q-danger": ui.danger,
    "--q-warning": ui.warning,
    "--q-success": ui.success,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = theme.isDark ? "dark" : "light";
}
