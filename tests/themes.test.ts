import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEMES, applyThemeToDom, getTheme, xtermThemeOf } from "../src/themes";

describe("themes", () => {
  it("provides at least 5 required schemes including the mandatory set", () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "catppuccin-mocha",
        "dracula",
        "nord",
        "tokyo-night",
        "solarized-dark",
        "gruvbox-dark",
        "one-dark",
      ]),
    );
  });

  it("falls back to the default theme for unknown ids", () => {
    expect(getTheme("nope").id).toBe(DEFAULT_THEME_ID);
  });

  it("every theme has a full 16-color ANSI palette and valid hex colors", () => {
    for (const theme of THEMES) {
      expect(theme.term.ansi).toHaveLength(16);
      const all = [theme.ui.bg, theme.ui.accent, ...theme.term.ansi];
      for (const color of all) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("applies CSS variables to the document", () => {
    const theme = getTheme("dracula");
    applyThemeToDom(theme);
    expect(document.documentElement.style.getPropertyValue("--q-bg")).toBe(theme.ui.bg);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("builds a complete xterm palette", () => {
    const xterm = xtermThemeOf(getTheme("nord"));
    expect(xterm.background).toBe("#2e3440");
    expect(xterm.brightWhite).toBeDefined();
    expect(Object.keys(xterm)).toContain("magenta");
  });
});
