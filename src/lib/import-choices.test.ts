import { describe, expect, it } from "vitest";
import { choiceNote, parseChoiceNote } from "./import-choices";

describe("import review choices", () => {
  it("retains a distinct namesake for explicit review after the session is reloaded", () => {
    const current = { mediaType: "movie" as const, tmdbId: 430231, title: "O Culto", originalTitle: "The Endless", year: 2017, posterPath: "/culto.jpg", overview: "A couple returns to a cult.", backdropPath: null,
      mentionedTitle: "oculto", reviewAlternatives: [{ mediaType: "movie" as const, tmdbId: 567802, title: "Oculto", originalTitle: "Oculto", year: 2018, posterPath: "/oculto.jpg", overview: "Another film.", backdropPath: null }] };
    expect(parseChoiceNote(choiceNote(current))).toMatchObject({ mentionedTitle: "oculto", selectedOverview: current.overview, alternatives: [{ tmdbId: 567802, title: "Oculto" }] });
    expect(parseChoiceNote("Falha ao confirmar.")).toBeNull();
  });
});
