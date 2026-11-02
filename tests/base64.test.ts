import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, decodeUtf8Base64, encodeUtf8Base64 } from "../src/lib/base64";

describe("base64 helpers", () => {
  it("round-trips ASCII", () => {
    const text = "ls -la /var/log\r\n";
    expect(decodeUtf8Base64(encodeUtf8Base64(text))).toBe(text);
  });

  it("round-trips multibyte UTF-8 (Cyrillic, box drawing)", () => {
    const text = "привет ┌─┐ ✓ 日本語";
    expect(decodeUtf8Base64(encodeUtf8Base64(text))).toBe(text);
  });

  it("round-trips binary bytes", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("handles large payloads across chunk boundaries", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).fill(0xab);
    const decoded = base64ToBytes(bytesToBase64(bytes));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[bytes.length - 1]).toBe(0xab);
  });
});
