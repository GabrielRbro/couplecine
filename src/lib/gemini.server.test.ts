import { afterEach, describe, expect, it, vi } from "vitest";
import { AiUnavailable, isTransientGeminiStatus, requestGeminiContent } from "./gemini.server";

afterEach(() => vi.restoreAllMocks());

describe("Gemini resilience", () => {
  it("retries one transient primary-model failure before succeeding", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"candidates":[]}', { status: 200 }));
    const wait = vi.fn(async () => undefined);

    const result = await requestGeminiContent({ key: "test-key", models: ["primary", "fallback"], feature: "import", payload: {}, fetcher, wait });

    expect(result.model).toBe("primary");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("uses the fallback model after the primary retry is exhausted", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"candidates":[]}', { status: 200 }));

    const result = await requestGeminiContent({ key: "test-key", models: ["primary", "fallback"], feature: "import", payload: {}, fetcher, wait: async () => undefined });

    expect(result.model).toBe("fallback");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[2]?.[0])).toContain("fallback");
  });

  it("does not retry an unauthorized provider response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("denied", { status: 403 }));

    await expect(requestGeminiContent({ key: "test-key", models: ["primary", "fallback"], feature: "import", payload: {}, fetcher, wait: async () => undefined }))
      .rejects.toMatchObject<Partial<AiUnavailable>>({ message: "provider_unauthorized" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("recognizes the provider statuses that are safe to retry", () => {
    expect([408, 429, 500, 502, 503, 504].every(isTransientGeminiStatus)).toBe(true);
    expect(isTransientGeminiStatus(400)).toBe(false);
  });
});
