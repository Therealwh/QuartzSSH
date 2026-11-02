import { describe, expect, it, vi } from "vitest";
import { resolveBroadcastTargets } from "../src/store/sessions";

// The session store is imported for its pure helper; the IPC bridge is not
// touched by these tests.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

describe("resolveBroadcastTargets", () => {
  it("returns every connected session when the current one is among them", () => {
    const connected = ["s1", "s2", "s3"];
    expect(resolveBroadcastTargets(connected, "s2")).toEqual(["s1", "s2", "s3"]);
  });

  it("falls back to the current session when it is the only one connected", () => {
    expect(resolveBroadcastTargets(["s1"], "s1")).toEqual(["s1"]);
  });

  it("returns nothing without a current session", () => {
    expect(resolveBroadcastTargets(["s1", "s2"], undefined)).toEqual([]);
    expect(resolveBroadcastTargets([], undefined)).toEqual([]);
  });

  it("falls back to the current session when it is not connected", () => {
    expect(resolveBroadcastTargets(["s1", "s2"], "s3")).toEqual(["s3"]);
    expect(resolveBroadcastTargets([], "s3")).toEqual(["s3"]);
  });
});
