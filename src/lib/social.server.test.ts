import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCaption, parseSocial } from "./social.server";

afterEach(() => vi.unstubAllGlobals());

describe("TikTok public caption fallback", () => {
  it("expands a short link and reads the post when oEmbed is rate-limited", async () => {
    const full = "https://www.tiktok.com/@cinema_em_questao/video/7673536585962523922";
    const item = { id: "7673536585962523922", desc: "Zodíaco (2007) #filmes #cinema", author: { uniqueId: "cinema_em_questao" } };
    const page = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: item } } } })}</script>`;
    const fetch = vi.fn(async (input: string) => {
      if (input.startsWith("https://vt.tiktok.com/")) return new Response(null, { status: 301, headers: { location: `${full}?_t=test` } });
      if (input.includes("/oembed?")) return new Response("Rate limit", { status: 429 });
      if (input === full) return new Response(page, { status: 200 });
      throw new Error("Unexpected URL");
    });
    vi.stubGlobal("fetch", fetch);
    const ref = parseSocial("https://vt.tiktok.com/ZSb3Psn9b/");
    expect(ref).not.toBeNull();
    const result = await fetchCaption(ref!);
    expect(result).toMatchObject({ status: "ok", canonical: full, caption: item.desc, author: "cinema_em_questao" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
