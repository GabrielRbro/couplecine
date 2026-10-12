import { describe, expect, it } from "vitest";
import { reviewStartIndex } from "./import-review";

describe("reviewStartIndex", () => {
  it("starts at the first item that still needs a decision", () => {
    expect(reviewStartIndex([{ status: "saved" }, { status: "skipped" }, { status: "pending" }])).toBe(2);
  });

  it("opens the summary instead of restarting when every item is decided", () => {
    expect(reviewStartIndex([{ status: "saved" }, { status: "skipped" }, { status: "saved" }])).toBe(3);
  });
});
