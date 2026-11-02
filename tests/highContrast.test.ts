import { describe, expect, it } from "vitest";
import { THEMES, getTheme, luminanceOf } from "../src/themes";

// WCAG 2.x contrast ratio: (L1 + 0.05) / (L2 + 0.05), where L1 is the
// relative luminance of the lighter of the two colors (0 = black, 1 = white).
// Pure black on pure white therefore scores exactly 21:1.
function contrastRatio(a: string, b: string): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

describe("high-contrast theme (spec 20.3)", () => {
  const theme = getTheme("high-contrast");

  it("is a built-in theme listed in THEMES", () => {
    expect(THEMES.some((t) => t.id === "high-contrast")).toBe(true);
    expect(theme.id).toBe("high-contrast");
    expect(theme.name).toBe("High Contrast");
    expect(theme.isDark).toBe(true);
    expect(THEMES.length).toBeGreaterThanOrEqual(8);
  });

  it("uses pure black background and pure white text (21:1)", () => {
    expect(theme.ui.bg.toLowerCase()).toBe("#000000");
    expect(theme.ui.text.toLowerCase()).toBe("#ffffff");
    // The anchor of the whole scheme: black/white is the theoretical maximum.
    expect(contrastRatio(theme.ui.bg, theme.ui.text)).toBeCloseTo(21, 5);
  });

  it("meets WCAG AAA (>= 7:1) for the main text colors", () => {
    // Body text (UI) and terminal foreground both count as main text.
    expect(contrastRatio(theme.ui.bg, theme.ui.text)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(theme.term.bg, theme.term.fg)).toBeGreaterThanOrEqual(7);
    // Secondary text is used for captions/labels: still AAA on the background.
    expect(contrastRatio(theme.ui.bg, theme.ui.muted)).toBeGreaterThanOrEqual(7);
    // Primary buttons render accentText on the accent color.
    expect(contrastRatio(theme.ui.accent, theme.ui.accentText)).toBeGreaterThanOrEqual(7);
  });

  it("meets WCAG AA (>= 4.5:1) for status colors on the background", () => {
    for (const color of [theme.ui.danger, theme.ui.warning, theme.ui.success]) {
      expect(contrastRatio(theme.ui.bg, color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("meets WCAG AA (>= 4.5:1) for every ANSI color on the terminal background", () => {
    expect(theme.term.ansi).toHaveLength(16);
    for (const color of theme.term.ansi) {
      expect(contrastRatio(theme.term.bg, color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps text readable on elevated surfaces (>= 4.5:1)", () => {
    expect(contrastRatio(theme.ui.elevated, theme.ui.text)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.ui.elevated, theme.ui.muted)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.ui.active, theme.ui.text)).toBeGreaterThanOrEqual(4.5);
  });

  it("has a non-text border visible against the background (>= 3:1)", () => {
    // WCAG 1.4.11 non-text contrast for UI component boundaries.
    expect(contrastRatio(theme.ui.bg, theme.ui.border)).toBeGreaterThanOrEqual(3);
  });

  it("distinguishes hover, active and elevated states from each other and the background", () => {
    const surfaces = [theme.ui.elevated, theme.ui.hover, theme.ui.active];
    // Each state must actually change something against #000000...
    for (const surface of surfaces) {
      expect(contrastRatio(theme.ui.bg, surface)).toBeGreaterThan(1);
    }
    // ...and no two states may look identical.
    for (let i = 0; i < surfaces.length; i++) {
      for (let j = i + 1; j < surfaces.length; j++) {
        expect(surfaces[i].toLowerCase()).not.toBe(surfaces[j].toLowerCase());
      }
    }
  });

  it("uses a visible cursor and selection on the terminal background", () => {
    expect(contrastRatio(theme.term.bg, theme.term.cursor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.term.selection, theme.term.fg)).toBeGreaterThanOrEqual(4.5);
  });
});
