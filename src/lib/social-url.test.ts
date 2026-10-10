import { describe, expect, it } from "vitest";
import { carouselIndexes, extractSocial, parseSocial, sourceUrl } from "./social-url";

const canon = (u: string) => { const r = parseSocial(u); return r ? sourceUrl(r) : null; };

describe("Instagram canonical source URL", () => {
  it("keeps Reels as /reel/ and drops tracking", () => {
    expect(canon("https://www.instagram.com/reel/Dcbr7-kKd9K/?dlrf=OXM4bXI0cmw2cm9n")).toBe("https://www.instagram.com/reel/Dcbr7-kKd9K/");
    expect(canon("https://instagram.com/reels/Dcbr7-kKd9K")).toBe("https://www.instagram.com/reel/Dcbr7-kKd9K/");
    expect(canon("https://www.instagram.com/someuser/reel/ABCDE12/?igsh=x")).toBe("https://www.instagram.com/reel/ABCDE12/");
  });
  it("keeps posts as /p/; img_index is a reference, not identity", () => {
    expect(canon("https://www.instagram.com/p/DcZua17jzOu/?img_index=4&igsh=abc")).toBe("https://www.instagram.com/p/DcZua17jzOu/");
    expect(parseSocial("https://www.instagram.com/p/DcZua17jzOu/?img_index=4")).toMatchObject({ imgIndex: 4, kind: "post" });
    expect(canon("https://www.instagram.com/p/DcZua17jzOu/?utm_source=x")).toBe("https://www.instagram.com/p/DcZua17jzOu/");
  });
  it("rejects non-allowlisted hosts and IPs", () => {
    expect(canon("https://evil.com/reel/ABCDE12/")).toBeNull();
    expect(canon("http://127.0.0.1/p/ABCDE12/")).toBeNull();
  });
});

describe("TikTok", () => {
  it("parses full and short links", () => {
    expect(canon("https://www.tiktok.com/@user.x/video/7312345678901234567?is_from_webapp=1")).toBe("https://www.tiktok.com/@user.x/video/7312345678901234567");
    expect(canon("https://vt.tiktok.com/ZSbnvdyM7/")).toBe("https://vt.tiktok.com/ZSbnvdyM7/");
  });
});

describe("extractSocial", () => {
  it("one source per post: two carousel images collapse, indexes kept as references; caps at 12", () => {
    const text = "https://www.instagram.com/reel/AAAAA11/?a=1 https://instagram.com/reel/AAAAA11 https://www.instagram.com/p/BBBBB22/?img_index=1 https://www.instagram.com/p/BBBBB22/?img_index=2";
    expect(extractSocial(text).map(sourceUrl)).toEqual(["https://www.instagram.com/reel/AAAAA11/", "https://www.instagram.com/p/BBBBB22/"]);
    expect(carouselIndexes(text).get("BBBBB22")).toEqual([1, 2]);
    const many = Array.from({ length: 20 }, (_, i) => `https://www.instagram.com/p/POST${String(i).padStart(3, "0")}x/`).join(" ");
    expect(extractSocial(many)).toHaveLength(12);
  });
});
