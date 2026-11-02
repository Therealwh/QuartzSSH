import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  THEMES,
  allThemes,
  applyThemeToDom,
  buildCustomTheme,
  getCustomThemes,
  getTheme,
  isDarkColor,
  isValidTheme,
  luminanceOf,
  registerCustomThemes,
  setTerminalBgOpacity,
  slugify,
  withAlpha,
  xtermThemeOf,
} from "../src/themes";
import type { CustomThemeDraft } from "../src/themes";

const BASE = THEMES[0];

function draft(overrides: Partial<CustomThemeDraft> = {}): CustomThemeDraft {
  return {
    name: "My Theme",
    baseId: BASE.id,
    uiBg: "#112233",
    uiPanel: "#0a1420",
    uiAccent: "#33ccff",
    uiText: "#ddeeff",
    termBg: "#112233",
    termFg: "#ddeeff",
    termCursor: "#ffcc00",
    termSelection: "#334455",
    ansi: [...BASE.term.ansi],
    ...overrides,
  };
}

describe("color helpers", () => {
  it("computes WCAG relative luminance for hex colors", () => {
    expect(luminanceOf("#000000")).toBe(0);
    expect(luminanceOf("#ffffff")).toBeCloseTo(1, 5);
    // Mid-tones fall strictly between black and white.
    expect(luminanceOf("#808080")).toBeGreaterThan(0);
    expect(luminanceOf("#808080")).toBeLessThan(1);
  });

  it("classifies dark backgrounds by luminance below the midpoint", () => {
    expect(isDarkColor("#1e1e2e")).toBe(true); // Catppuccin Mocha bg
    expect(isDarkColor("#282a36")).toBe(true); // Dracula bg
    expect(isDarkColor("#000000")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#fdf6e3")).toBe(false); // Solarized light bg
  });

  it("applies alpha to hex only when opacity is below 1", () => {
    expect(withAlpha("#1e1e2e", 1)).toBe("#1e1e2e");
    expect(withAlpha("#1e1e2e", 0.7)).toBe("rgba(30, 30, 46, 0.7)");
    expect(withAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(withAlpha("#fff", 2)).toBe("#fff");
    // Unparseable input is returned unchanged.
    expect(withAlpha("nope", 0.5)).toBe("nope");
  });
});

describe("slugify", () => {
  it("produces id-safe slugs from theme names", () => {
    expect(slugify("My Cool Theme!")).toBe("my-cool-theme");
    expect(slugify("  Dark -- Theme  ")).toBe("dark-theme");
    expect(slugify("Моя тёмная тема")).toBe("моя-тёмная-тема");
    expect(slugify("")).toBe("theme");
    expect(slugify("!!!")).toBe("theme");
  });
});

describe("buildCustomTheme", () => {
  it("constructs a full Theme from the builder fields", () => {
    const theme = buildCustomTheme(draft());
    expect(theme.id).toBe("custom-my-theme");
    expect(theme.name).toBe("My Theme");
    expect(theme.isDark).toBe(true);
    expect(theme.ui.bg).toBe("#112233");
    expect(theme.ui.panel).toBe("#0a1420");
    expect(theme.ui.accent).toBe("#33ccff");
    expect(theme.ui.text).toBe("#ddeeff");
    expect(theme.term.bg).toBe("#112233");
    expect(theme.term.fg).toBe("#ddeeff");
    expect(theme.term.cursor).toBe("#ffcc00");
    expect(theme.term.selection).toBe("#334455");
    expect(theme.term.ansi).toHaveLength(16);
    expect(theme.term.ansi).toEqual(BASE.term.ansi);
  });

  it("derives isDark from the background luminance on the fly", () => {
    expect(buildCustomTheme(draft({ uiBg: "#101418" })).isDark).toBe(true);
    expect(buildCustomTheme(draft({ uiBg: "#fdf6e3" })).isDark).toBe(false);
  });

  it("inherits the remaining UI fields from the base theme", () => {
    const theme = buildCustomTheme(draft());
    expect(theme.ui.danger).toBe(BASE.ui.danger);
    expect(theme.ui.warning).toBe(BASE.ui.warning);
    expect(theme.ui.success).toBe(BASE.ui.success);
    expect(theme.ui.elevated).toBe(BASE.ui.elevated);
    expect(theme.ui.hover).toBe(BASE.ui.hover);
  });

  it("pads a short ANSI list from the base theme and trims long ones", () => {
    const short = buildCustomTheme(draft({ ansi: ["#000000", "#ff0000"] }));
    expect(short.term.ansi).toHaveLength(16);
    expect(short.term.ansi[0]).toBe("#000000");
    expect(short.term.ansi[1]).toBe("#ff0000");
    expect(short.term.ansi[2]).toBe(BASE.term.ansi[2]);
    const long = buildCustomTheme(draft({ ansi: [...BASE.term.ansi, "#123456", "#234567"] }));
    expect(long.term.ansi).toHaveLength(16);
  });

  it("falls back to the base theme name when the draft name is blank", () => {
    const theme = buildCustomTheme(draft({ name: "   " }));
    expect(theme.name).toBe(BASE.name);
    expect(theme.id).toBe(`custom-${slugify(BASE.name)}`);
  });

  it("passes isValidTheme for constructed themes and rejects garbage", () => {
    expect(isValidTheme(buildCustomTheme(draft()))).toBe(true);
    expect(isValidTheme(null)).toBe(false);
    expect(isValidTheme({ id: "x" })).toBe(false);
  });
});

describe("custom theme registry", () => {
  afterEach(() => {
    registerCustomThemes([]);
  });

  it("getTheme resolves registered custom themes", () => {
    const theme = buildCustomTheme(draft({ name: "Registry Test" }));
    expect(getTheme(theme.id).id).toBe(DEFAULT_THEME_ID); // not registered yet
    registerCustomThemes([theme]);
    expect(getTheme(theme.id)).toBe(theme);
    expect(getCustomThemes()).toEqual([theme]);
  });

  it("falls back to the default theme once custom themes are gone", () => {
    const theme = buildCustomTheme(draft({ name: "Registry Test 2" }));
    registerCustomThemes([theme]);
    registerCustomThemes([]);
    expect(getTheme(theme.id).id).toBe(DEFAULT_THEME_ID);
  });

  it("drops invalid entries and lists built-ins first", () => {
    const theme = buildCustomTheme(draft({ name: "Registry Test 3" }));
    registerCustomThemes([theme, { nope: true } as unknown as never]);
    expect(getCustomThemes()).toEqual([theme]);
    expect(allThemes().slice(0, THEMES.length)).toEqual(THEMES);
    expect(allThemes().at(-1)).toBe(theme);
  });

  it("built-in ids take priority over custom ones", () => {
    registerCustomThemes([{ ...THEMES[0], name: "Impostor" }]);
    expect(getTheme(THEMES[0].id)).toBe(THEMES[0]);
  });
});

describe("background opacity (spec 4.3)", () => {
  afterEach(() => {
    setTerminalBgOpacity(1);
  });

  it("applyThemeToDom keeps --q-bg opaque by default", () => {
    const theme = getTheme("dracula");
    applyThemeToDom(theme);
    expect(document.documentElement.style.getPropertyValue("--q-bg")).toBe(theme.ui.bg);
    expect(xtermThemeOf(theme).background).toBe(theme.term.bg);
  });

  it("applyThemeToDom sets an alpha background below 100%", () => {
    applyThemeToDom(getTheme("dracula"), 0.7);
    expect(document.documentElement.style.getPropertyValue("--q-bg")).toBe("rgba(40, 42, 54, 0.7)");
    // Terminal opacity stays in sync with the DOM application.
    expect(xtermThemeOf(getTheme("dracula")).background).toBe("rgba(40, 42, 54, 0.7)");
  });

  it("xtermThemeOf honors an explicitly passed opacity", () => {
    const theme = getTheme("nord");
    expect(xtermThemeOf(theme, 1).background).toBe("#2e3440");
    expect(xtermThemeOf(theme, 0.75).background).toBe("rgba(46, 52, 64, 0.75)");
  });

  it("terminal opacity is clamped to the 70–100% range", () => {
    setTerminalBgOpacity(0.1);
    expect(xtermThemeOf(getTheme("nord")).background).toBe("rgba(46, 52, 64, 0.7)");
    setTerminalBgOpacity(2);
    expect(xtermThemeOf(getTheme("nord")).background).toBe("#2e3440");
  });
});
