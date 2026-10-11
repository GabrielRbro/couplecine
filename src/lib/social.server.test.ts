import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCaption, parseSocial } from "./social.server";

afterEach(() => vi.unstubAllGlobals());

describe("TikTok public caption fallback", () => {
  it("expands a short link and reads the post when oEmbed is rate-limited", async () => {
    const full = "https://www.tiktok.com/@cinema_em_questao/video/7673536585962523922";
    const item = { id: "7673536585962523922", desc: "Zodíaco (2007) #filmes #cinema", author: { uniqueId: "cinema_em_questao" } };
    const page = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: item } } } })}</script>`;
    const fetch = vi.fn(async (input: string, _options?: RequestInit) => {
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
    expect(fetch.mock.calls.every(([, options]) => options?.redirect === "manual")).toBe(true);
  });

  it("expands a short URL and reads its oEmbed title", async () => {
    const short = "https://vt.tiktok.com/ZSb3uY7AE/";
    const full = "https://www.tiktok.com/@cinema_em_questao/video/7673536585962523922";
    const fetch = vi.fn(async (input: string, _options?: RequestInit) => {
      if (input === short) return new Response(null, { status: 301, headers: { location: `${full}?_t=share` } });
      if (input.startsWith("https://www.tiktok.com/oembed?url=")) return new Response(JSON.stringify({ title: "Zodíaco (2007) #filmes", author_name: "Cinema em Questão" }));
      throw new Error("Unexpected URL");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchCaption(parseSocial(short)!);
    expect(result).toMatchObject({ status: "ok", caption: "Zodíaco (2007) #filmes", canonical: full });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, options]) => options?.redirect === "manual")).toBe(true);
  });

  it("does not follow a short-link redirect outside the allowed hosts", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.org/post" } }));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchCaption(parseSocial("https://vt.tiktok.com/ZSb3uY7AE/")!)).status).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Instagram public caption", () => {
  it("reads the description from the public Reel HTML", async () => {
    const reel = "https://www.instagram.com/reel/DXXrooqjCI9/";
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<meta property="og:description" content="Legend Original on Instagram: &quot;Movie Name :- Watcher (2022)&quot;" />')));
    expect(await fetchCaption(parseSocial(reel)!)).toMatchObject({ status: "ok", caption: "Movie Name :- Watcher (2022)" });
  });
});
