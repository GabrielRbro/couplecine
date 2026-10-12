import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findImportTitle } from "./tmdb.server";

const antebellum = { id: 627290, title: "A Escolhida", original_title: "Antebellum", release_date: "2020-09-18" };
const undertone = { id: 1480387, title: "Undertone", original_title: "Undertone", release_date: "2026-03-13" };
const endless = { id: 430231, title: "O Culto", original_title: "The Endless", release_date: "2017-04-21" };

beforeEach(() => vi.stubEnv("TMDB_API_KEY", "test-key"));
afterEach(() => vi.unstubAllGlobals());

function searchResults(results: Record<string, object[]>) {
  vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
    const query = new URL(String(input)).searchParams.get("query") ?? "";
    return { ok: true, json: async () => ({ results: results[query] ?? [] }) };
  }));
}

describe("title recognition from a spoken list", () => {
  it("accepts a Brazilian catalog title via its spoken original even when the guessed year differs", async () => {
    searchResults({ Antebellum: [antebellum] });
    const result = await findImportTitle({ title: "Antebellum", originalTitle: "Antebellum", mentionedTitle: "Antebellum", year: 2021, mediaType: "movie" });
    expect(result).toMatchObject({ tmdbId: 627290, title: "A Escolhida", originalTitle: "Antebellum" });
  });

  it("accepts a one-character transcript error when the catalog confirms the real title", async () => {
    searchResults({ underton: [], Undertone: [undertone] });
    const result = await findImportTitle({ title: "Undertone", mentionedTitle: "underton", year: 2025, mediaType: "movie" });
    expect(result?.tmdbId).toBe(1480387);
  });

  it("rejects an unrelated movie proposed for a named title", async () => {
    searchResults({ underton: [], "When Evil Lurks": [{ id: 744857, title: "O Mal que Nos Habita", original_title: "Cuando acecha la maldad", release_date: "2023-10-05" }] });
    const result = await findImportTitle({ title: "When Evil Lurks", mentionedTitle: "underton", mediaType: "movie" });
    expect(result).toBeNull();
  });

  it("corrects a subtitle that joins 'O Culto' into 'oculto'", async () => {
    searchResults({ Oculto: [], "The Endless": [endless] });
    const result = await findImportTitle({ title: "The Endless", originalTitle: "The Endless", mentionedTitle: "Oculto", year: 2017, mediaType: "movie" });
    expect(result?.tmdbId).toBe(430231);
  });
});
