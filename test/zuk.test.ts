import { afterEach, describe, expect, it, vi } from "vitest";

import {
  containsPlaceName,
  convertHtmlToPlainText,
  fetchOutageSchedule,
  parseRssFeed,
} from "../src/zuk";
import { createRssMock, rssFixture } from "./fixtures";

describe("ZUK RSS", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches complete place names case-insensitively", () => {
    expect(containsPlaceName("Domaszczyn, ul. Brzozowa", "domaszczyn")).toBe(
      true,
    );
    expect(containsPlaceName("DOMASZCZYN", "Domaszczyn")).toBe(true);
    expect(containsPlaceName("Domaszczyniec", "Domaszczyn")).toBe(false);
  });

  it("converts the notice HTML into readable plain text", () => {
    expect(
      convertHtmlToPlainText(
        "<p>Domaszczyn&nbsp;&amp; okolice<br><strong>Uwaga</strong></p>",
      ),
    ).toBe("Domaszczyn & okolice\nUwaga");
  });

  it("parses matching title and description notices but ignores other items", () => {
    const result = parseRssFeed(rssFixture, { town: "Domaszczyn" });

    expect(result.rawItemCount).toBe(4);
    expect(result.outages).toHaveLength(2);
    expect(result.outages.map(({ kind }) => kind)).toEqual([
      "emergency",
      "planned",
    ]);
    expect(result.outages[0]?.start).toEqual({
      date: "2026-09-18",
      time: "09:00",
    });
    expect(result.outages[0]?.end.time).toBe("12:15");
    expect(result.outages[1]?.message).toContain("ul. Brzozowa");
  });

  it("rejects a malformed matching notice", () => {
    const malformed = rssFixture.replace("08:30÷14:30", "od rana");
    expect(() => parseRssFeed(malformed, { town: "Domaszczyn" })).toThrow(
      "Cannot parse matching ZUK notice",
    );
  });

  it("fetches and parses the bounded RSS response", async () => {
    const fetchMock = createRssMock();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchOutageSchedule({ town: "Domaszczyn" });

    expect(result.outages).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("format=feed&type=rss");
  });
});
