import { afterEach, expect, it, vi } from "vitest";
import { parseSocial } from "./social-url";
import { captureTikTokPhotos } from "./tiktok-photo";

afterEach(() => vi.unstubAllGlobals());

it("captures a short photo link in the browser without the blocked TikTok redirect", async () => {
  const short = "https://vt.tiktok.com/ZSbwkJy77/";
  const images = [1, 2, 3, 4].map(
    (n) =>
      `https://p16-common-sign.tiktokcdn-us.com/tos-alisg-i-photomode-sg/${n}~tplv-photomode-image.jpeg?signature=test`,
  );
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    expect(options?.credentials).toBe("omit");
    if (url.startsWith("https://tikwm.com/api/?"))
      return Response.json({
        code: 0,
        data: {
          id: "7686999788637736213",
          title: "Filmes essenciais",
          author: { unique_id: "vtindica_" },
          images,
        },
      });
    const n = images.indexOf(url) + 1;
    if (n)
      return new Response(new Uint8Array([0xff, 0xd8, n]), {
        headers: { "content-type": "image/jpeg" },
      });
    throw new Error("Unexpected URL");
  });
  vi.stubGlobal("fetch", fetch);
  const result = await captureTikTokPhotos(parseSocial(short)!);
  expect(result?.caption).toBe("Filmes essenciais");
  expect(result?.images.map((image) => atob(image.base64).charCodeAt(2))).toEqual([1, 2, 3, 4]);
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(decodeURIComponent(fetch.mock.calls[0]![0])).toContain(short);
});

it("refuses an untrusted image URL and an incomplete carousel", async () => {
  const short = parseSocial("https://vt.tiktok.com/ZSbwkJy77/")!;
  const good =
    "https://p16-common-sign.tiktokcdn-us.com/tos-alisg-i-photomode-sg/a~tplv-photomode-image.jpeg";
  const fetch = vi.fn(async (url: string) =>
    url.startsWith("https://tikwm.com/api/?")
      ? Response.json({
          code: 0,
          data: {
            id: "7686999788637736213",
            author: { unique_id: "vtindica_" },
            images: [good, "https://example.org/private"],
          },
        })
      : new Response("blocked", { status: 403 }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await captureTikTokPhotos(short)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockImplementation(async (url: string) =>
    url.startsWith("https://tikwm.com/api/?")
      ? Response.json({
          code: 0,
          data: {
            id: "7686999788637736213",
            author: { unique_id: "vtindica_" },
            images: [good, good],
          },
        })
      : new Response("blocked", { status: 403 }),
  );
  expect(await captureTikTokPhotos(short)).toBeNull();
});
