import { describe, expect, it } from "vitest";
import { explicitTitle } from "./explicit-title";

describe("explicit work titles in shared captions", () => {
  it("recognizes the supplied Instagram and TikTok examples", () => {
    expect(explicitTitle("Movie Name :- Watcher (2022)\n\nWatcher follows Julia..."))
      .toEqual({ title: "Watcher", year: 2022, mediaType: "movie" });
    expect(explicitTitle("Zodíaco (2007) #filmes #cinema"))
      .toEqual({ title: "Zodíaco", year: 2007, mediaType: null });
  });

  it("leaves prose and lists for the broader analysis", () => {
    expect(explicitTitle("Conheça os filmes mais vistos de 2022!")).toBeNull();
    expect(explicitTitle("Watcher (2022) e Zodíaco (2007)")).toBeNull();
  });
});
