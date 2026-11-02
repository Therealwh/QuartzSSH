import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import ru from "../src/i18n/ru.json";

type Nested = Record<string, unknown>;

function flatten(obj: Nested, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? flatten(value as Nested, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("localization resources", () => {
  it("ru and en expose identical key sets", () => {
    const ruKeys = flatten(ru).sort();
    const enKeys = flatten(en).sort();
    expect(ruKeys).toEqual(enKeys);
  });

  it("contains no hardcoded values for critical screens", () => {
    const keys = flatten(ru);
    for (const critical of ["hostkey.changedTitle", "terminal.reconnect", "sftp.download", "settings.hostKeyMode"]) {
      expect(keys).toContain(critical);
    }
  });

  it("has no empty strings", () => {
    for (const key of flatten(ru)) {
      const v = key.split(".").reduce<unknown>((acc, part) => (acc as Nested)[part], ru);
      expect(v).not.toBe("");
    }
    for (const key of flatten(en)) {
      const v = key.split(".").reduce<unknown>((acc, part) => (acc as Nested)[part], en);
      expect(v).not.toBe("");
    }
  });
});
