import { describe, expect, it } from "vitest";
import { shareFallbackText } from "./share-fallback";

describe("shareFallbackText", () => {
  const url = "https://www.instagram.com/reel/Dcbr7-kKd9K/?igsh=abc";
  it("keeps the URL whole with 4000 chars of text", () => {
    const out = shareFallbackText({ title: "Título", text: "x".repeat(4000), url });
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out.startsWith(url + "\n")).toBe(true);
    expect(out).toContain("Título");
  });
  it("does not duplicate a URL also sent as text", () => {
    expect(shareFallbackText({ text: url, url })).toBe(url);
  });
  it("works without URL", () => {
    expect(shareFallbackText({ title: "a", text: "b" })).toBe("a\nb");
  });
});
