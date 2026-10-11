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

  it("reads an oEmbed through the public reader when the short URL is blocked", async () => {
    const short = "https://vt.tiktok.com/ZSb3uY7AE/";
    const fetch = vi.fn(async (input: string) => {
      if (input === short) return new Response("Blocked", { status: 403 });
      if (input.startsWith("https://r.jina.ai/https://www.tiktok.com/oembed?url=")) {
        return new Response(`Title: \n\nURL Source: ${input}\n\nMarkdown Content:\n${JSON.stringify({ title: "Zodíaco (2007) #filmes", author_name: "Cinema em Questão", html: '<blockquote data-video-id="7673536585962523922">' })}`);
      }
      throw new Error("Unexpected URL");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchCaption(parseSocial(short)!);
    expect(result).toMatchObject({ status: "ok", caption: "Zodíaco (2007) #filmes", canonical: short });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("ignores a reader response for a different TikTok video", async () => {
    const full = "https://www.tiktok.com/@cinema_em_questao/video/7673536585962523922";
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.startsWith("https://r.jina.ai/")
      ? new Response(`Markdown Content:\n${JSON.stringify({ title: "Wrong (2007)", html: '<blockquote data-video-id="1234567890123456789">' })}`)
      : new Response("Blocked", { status: 403 })));
    expect((await fetchCaption(parseSocial(full)!)).caption).toBeNull();
  });
});

describe("Instagram public caption fallback", () => {
  it("reads the caption title when direct access is blocked", async () => {
    const reel = "https://www.instagram.com/reel/DXXrooqjCI9/";
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.startsWith("https://r.jina.ai/")
      ? new Response(`Title: Legend Original on Instagram: "Movie Name :- Watcher (2022)\n\nURL Source: ${reel}\n\nMarkdown Content:\n`)
      : new Response("Login", { status: 403 })));
    expect(await fetchCaption(parseSocial(reel)!)).toMatchObject({ status: "ok", caption: "Movie Name :- Watcher (2022)" });
  });
});
