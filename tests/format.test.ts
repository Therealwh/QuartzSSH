import { describe, expect, it } from "vitest";
import { formatBytes, joinPath, parentPath } from "../src/lib/format";

describe("formatBytes", () => {
  it("formats small values", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
  it("formats kilobytes and megabytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("formats gigabytes with one decimal", () => {
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});

describe("paths", () => {
  it("computes unix parent", () => {
    expect(parentPath("/var/log/app.log")).toBe("/var/log");
    expect(parentPath("/etc")).toBe("");
  });
  it("computes windows parent and keeps drive root", () => {
    expect(parentPath("C:\\Users\\bob", true)).toBe("C:\\Users");
    expect(parentPath("C:\\Users", true)).toBe("C:\\");
  });
  it("joins paths per platform", () => {
    expect(joinPath("/var", "log")).toBe("/var/log");
    expect(joinPath("C:\\Users", "bob", true)).toBe("C:\\Users\\bob");
  });
});
