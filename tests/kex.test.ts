import { describe, expect, it, vi } from "vitest";
import { classifyKex, selectKexBadge } from "../src/lib/kex";

// Pure classification of negotiated KEX names for the status-bar PQ
// indicator (29.3); no IPC is touched.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

describe("classifyKex", () => {
  it("recognizes the post-quantum hybrid negotiated by russh", () => {
    expect(classifyKex("mlkem768x25519-sha256")).toBe("pq");
  });

  it("classifies classical key exchanges as classic", () => {
    expect(classifyKex("curve25519-sha256")).toBe("classic");
    expect(classifyKex("curve25519-sha256@libssh.org")).toBe("classic");
    expect(classifyKex("diffie-hellman-group14-sha256")).toBe("classic");
    expect(classifyKex("diffie-hellman-group-exchange-sha256")).toBe("classic");
  });
});

describe("selectKexBadge", () => {
  it("shows nothing while no negotiated KEX is known", () => {
    expect(selectKexBadge([])).toBeNull();
    expect(selectKexBadge([undefined, undefined])).toBeNull();
  });

  it("shows the post-quantum badge when every session is PQ", () => {
    expect(selectKexBadge(["mlkem768x25519-sha256"])).toEqual({
      kind: "pq",
      kex: "mlkem768x25519-sha256",
    });
    expect(selectKexBadge(["mlkem768x25519-sha256", undefined])).toEqual({
      kind: "pq",
      kex: "mlkem768x25519-sha256",
    });
    expect(
      selectKexBadge(["mlkem768x25519-sha256", "mlkem768x25519-sha256"]),
    ).toEqual({ kind: "pq", kex: "mlkem768x25519-sha256" });
  });

  it("switches to the conservative classic badge with the classical name", () => {
    expect(selectKexBadge(["curve25519-sha256"])).toEqual({
      kind: "classic",
      kex: "curve25519-sha256",
    });
    // One classical session among post-quantum ones is enough.
    expect(
      selectKexBadge(["mlkem768x25519-sha256", "curve25519-sha256"]),
    ).toEqual({ kind: "classic", kex: "curve25519-sha256" });
  });
});
