import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findImportTitle, findImportTitleWithChoices, findSpokenTitle } from "./tmdb.server";

const antebellum = { id: 627290, title: "A Escolhida", original_title: "Antebellum", release_date: "2020-09-18" };
const undertone = { id: 1480387, title: "Undertone", original_title: "Undertone", release_date: "2026-03-13" };
const endless = { id: 430231, title: "O Culto", original_title: "The Endless", release_date: "2017-04-21" };
const coherence = { id: 220289, title: "Coherence", original_title: "Coherence", release_date: "2014-09-19" };

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

  it("does not auto-select an old namesake without an old year in the post", async () => {
    const silentNamesake = { id: 101, title: "Odisseia", original_title: "Odisseia", release_date: "1911-01-01", vote_count: 1 };
    searchResults({ Odisseia: [silentNamesake] });
    await expect(findImportTitle({ title: "Odisseia", mentionedTitle: "Odisseia", mediaType: "movie" })).resolves.toBeNull();
  });

  it("corrects a subtitle that joins 'O Culto' into 'oculto'", async () => {
    searchResults({ Oculto: [], "The Endless": [endless] });
    const result = await findImportTitle({ title: "The Endless", originalTitle: "The Endless", mentionedTitle: "Oculto", year: 2017, mediaType: "movie" });
    expect(result?.tmdbId).toBe(430231);
  });

  it("prefers Coherence to an unrelated film called Coerência", async () => {
    const wrong = { id: 509040, title: "Coerência", original_title: "Coerência", release_date: "2016-01-01" };
    searchResults({ coerência: [wrong], "Coerência": [wrong], Coherence: [coherence] });
    const result = await findImportTitle({ title: "Coerência", originalTitle: "Coherence", mentionedTitle: "coerência", year: 2013, mediaType: "movie" });
    expect(result?.tmdbId).toBe(220289);
    const review = await findImportTitleWithChoices({ title: "Coerência", originalTitle: "Coherence", mentionedTitle: "coerência", year: 2013, mediaType: "movie" });
    expect(review?.reviewAlternatives?.map((item) => item.tmdbId)).toEqual([509040]);
  });

  it("prefers O Culto / The Endless to an unrelated film called Oculto", async () => {
    const wrong = { id: 567802, title: "Oculto", original_title: "Oculto", release_date: "2018-01-01" };
    searchResults({ oculto: [wrong, endless], Oculto: [wrong, endless], "The Endless": [endless] });
    const result = await findImportTitle({ title: "Oculto", originalTitle: "The Endless", mentionedTitle: "oculto", year: 2017, mediaType: "movie" });
    expect(result?.tmdbId).toBe(430231);
    const review = await findImportTitleWithChoices({ title: "Oculto", originalTitle: "The Endless", mentionedTitle: "oculto", year: 2017, mediaType: "movie" });
    expect(review?.reviewAlternatives?.map((item) => item.tmdbId)).toEqual([567802]);
  });

  it("keeps the spoken exact match if the alleged original title is not corroborated", async () => {
    const wrongOriginal = { id: 123456, title: "The Keeping Hours", original_title: "The Keeping Hours", release_date: "2017-01-01" };
    const named = { id: 789012, title: "Faces da Verdade", original_title: "Faces da Verdade", release_date: "2008-01-01" };
    searchResults({ "Faces da Verdade": [named], "The Keeping Hours": [wrongOriginal] });
    const result = await findImportTitle({ title: "Faces da Verdade", originalTitle: "The Keeping Hours", mentionedTitle: "Faces da Verdade", mediaType: "movie" });
    expect(result?.tmdbId).toBe(789012);
  });
});

describe("explicit spoken name recovery", () => {
  it("finds Undertone from the transcript's 'se chama underton' when AI misses it", async () => {
    searchResults({ underton: [], undertone: [{ ...undertone, media_type: "movie" }] });
    const result = await findSpokenTitle("mas se ainda assim você quer desafiar o coisa ruim ele se chama underton tá na HBO Max");
    expect(result).toMatchObject({ tmdbId: 1480387, title: "Undertone" });
  });

  it("does not return a film unrelated to the spoken name", async () => {
    searchResults({ underton: [{ ...antebellum, media_type: "movie" }], undertone: [] });
    expect(await findSpokenTitle("ele se chama underton tá na HBO Max")).toBeNull();
  });
});
