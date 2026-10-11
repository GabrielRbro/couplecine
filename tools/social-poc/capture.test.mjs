import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical } from "./capture.mjs";

test("rebuilds exact social post URLs without query parameters", () => {
  assert.deepEqual(canonical("https://www.instagram.com/reel/Dcbr7-kKd9K/?igsh=x"), {
    platform: "instagram", url: "https://www.instagram.com/reel/Dcbr7-kKd9K/",
  });
  assert.deepEqual(canonical("https://m.tiktok.com/@abc/video/1234567890123456789?x=1"), {
    platform: "tiktok", url: "https://www.tiktok.com/@abc/video/1234567890123456789",
  });
});

test("rejects arbitrary hosts, credentials and unsupported paths before opening a browser", () => {
  for (const url of [
    "https://www.instagram.com.evil.test/reel/Dcbr7-kKd9K/",
    "https://user:pass@www.instagram.com/reel/Dcbr7-kKd9K/",
    "http://www.instagram.com/reel/Dcbr7-kKd9K/",
    "https://www.instagram.com:8443/reel/Dcbr7-kKd9K/",
    "https://www.instagram.com/accounts/login/",
  ]) assert.throws(() => canonical(url));
});
