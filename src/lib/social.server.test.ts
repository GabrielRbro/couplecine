import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCaption, needsCaptionFetch, parseSocial, VIDEO_PROBE_STATUS } from "./social.server";

afterEach(() => vi.unstubAllGlobals());

it("rechecks an older ambiguous TikTok description once, preserving the retry cooldown for failed reads", () => {
  const source_url = "https://www.tiktok.com/@film/video/7673536585962523922";
  const old = { source_url, caption: "A história desse filme é incrível", caption_status: "ok", caption_fetched_at: "2026-10-01T00:00:00Z" };
  expect(needsCaptionFetch(old)).toBe(true);
  expect(needsCaptionFetch({ ...old, caption: "Descrição genérica\n\nLegendas automáticas do vídeo:\nRed Rooms", caption_status: VIDEO_PROBE_STATUS })).toBe(false);
  expect(needsCaptionFetch({ ...old, caption: "Descrição genérica", caption_status: VIDEO_PROBE_STATUS, caption_fetched_at: "2026-10-11T20:00:00Z" }, Date.parse("2026-10-11T20:01:00Z"))).toBe(false);
  expect(needsCaptionFetch({ ...old, caption: "Descrição genérica", caption_status: VIDEO_PROBE_STATUS, caption_fetched_at: "2026-10-11T20:00:00Z" }, Date.parse("2026-10-11T20:03:00Z"))).toBe(true);
  expect(needsCaptionFetch({ ...old, caption: "Descrição genérica\n\nLegendas automáticas do vídeo:\nRed Rooms", caption_status: VIDEO_PROBE_STATUS })).toBe(false);
  expect(needsCaptionFetch({ ...old, caption: "Zodíaco (2007) #filmes" })).toBe(false);
  expect(needsCaptionFetch({ ...old, caption: null, caption_status: "blocked", caption_fetched_at: "2026-10-11T20:00:00Z" }, Date.parse("2026-10-11T20:01:00Z"))).toBe(false);
});

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

  it("identifies a photo carousel whose public page and oEmbed expose no images or titles", async () => {
    const short = "https://vt.tiktok.com/ZSbwF86NW/";
    const full = "https://www.tiktok.com/@vtindica_/photo/7686999788637736213";
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === short) return new Response(null, { status: 301, headers: { location: `${full}?image_index=2` } });
      if (input.includes("/oembed?")) return new Response("rate limit", { status: 429 });
      if (input === full) return new Response('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{"__DEFAULT_SCOPE__":{}}</script>');
      throw new Error("Unexpected URL");
    }));
    const result = await fetchCaption(parseSocial(short)!);
    expect(result).toMatchObject({ canonical: full, caption: null, status: "photo_unavailable" });
  });

  it("adds native TikTok speech when the post description does not name a work", async () => {
    const full = "https://www.tiktok.com/@cinema_em_questao/video/7673536585962523922";
    const vttUrl = "https://v16-webapp.tiktokcdn-eu.com/subtitles/track.vtt?signature=test";
    const item = { id: "7673536585962523922", desc: "Esse suspense me surpreendeu", video: { subtitleInfos: [
      { Format: "webvtt", LanguageCodeName: "eng-US", Size: "300", Url: "https://v16-webapp.tiktokcdn-eu.com.evil.org/forbidden" },
      { Format: "webvtt", LanguageCodeName: "por-PT", Size: "300", Url: vttUrl },
    ] } };
    const page = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: item } } } })}</script>`;
    const fetch = vi.fn(async (input: string, options?: RequestInit) => {
      expect(options?.redirect).toBe("manual");
      expect(options?.headers).toMatchObject({ "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" });
      if (input.includes("/oembed?")) return new Response(JSON.stringify({ title: item.desc }));
      if (input === full) return new Response(page);
      if (input === vttUrl) return new Response("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nO filme é Zodíaco\n\n00:00:02.000 --> 00:00:03.000\nde David Fincher\n");
      throw new Error("Unexpected URL");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchCaption(parseSocial(full)!);
    expect(result).toMatchObject({ status: "ok", caption: "Esse suspense me surpreendeu\n\nLegendas automáticas do vídeo:\nO filme é Zodíaco de David Fincher" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries a page whose generic description had no native speech", async () => {
    const full = "https://www.tiktok.com/@film/video/7673536585962523922";
    const item = { id: "7673536585962523922", desc: "Esse filme é sinistro", video: { subtitleInfos: [] } };
    const page = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: item } } } })}</script>`;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.includes("/oembed?") ? new Response("rate", { status: 429 }) : new Response(page)));
    expect(await fetchCaption(parseSocial(full)!)).toMatchObject({ status: "ok", caption: item.desc, videoProbed: false });
  });

  it("uses a second safe track if the preferred one fails, without treating VTT notes as speech", async () => {
    const full = "https://www.tiktok.com/@film/video/7673536585962523922";
    const pt = "https://v16-webapp.tiktok.com/subtitles/pt.vtt";
    const en = "https://v16-webapp.tiktok.com/subtitles/en.vtt";
    const item = { id: "7673536585962523922", desc: "A história desse filme é incrível", video: { subtitleInfos: [
      { Format: "webvtt", LanguageCodeName: "por-BR", Url: pt },
      { Format: "webvtt", LanguageCodeName: "eng-US", Url: en },
      { Format: "webvtt", LanguageCodeName: "eng-US", Url: "https://example.org/private" },
    ] } };
    const page = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: item } } } })}</script>`;
    const fetch = vi.fn(async (input: string) => {
      if (input.includes("/oembed?")) return new Response(JSON.stringify({ title: item.desc }));
      if (input === full) return new Response(page);
      if (input === pt) return new Response("Forbidden", { status: 403 });
      if (input === en) return new Response("WEBVTT\n\nNOTE this is metadata\nignore this line\n\n00:00:01.000 --> 00:00:02.000\n<v Narrator>In the film Burning</v>\n\n00:00:02.000 --> 00:00:03.000\nIn the film Burning\n");
      throw new Error("Unexpected URL");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchCaption(parseSocial(full)!);
    expect(result).toMatchObject({ status: "ok", videoProbed: true, caption: "A história desse filme é incrível\n\nLegendas automáticas do vídeo:\nIn the film Burning" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe("Instagram public caption", () => {
  it("reads the description from the public Reel HTML", async () => {
    const reel = "https://www.instagram.com/reel/DXXrooqjCI9/";
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<meta property="og:description" content="Legend Original on Instagram: &quot;Movie Name :- Watcher (2022)&quot;" />')));
    expect(await fetchCaption(parseSocial(reel)!)).toMatchObject({ status: "ok", caption: "Movie Name :- Watcher (2022)" });
  });
});
