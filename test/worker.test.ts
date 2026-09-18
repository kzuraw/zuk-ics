import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshCalendar } from "../src/index";
import type { CalendarMetadata } from "../src/types";
import { createRssMock } from "./fixtures";

const workerEnv = env as unknown as Env;
const calendarUrl = "https://example.com/calendar/test-token.ics";

describe("calendar Worker", () => {
  beforeEach(async () => {
    await workerEnv.CALENDAR_KV.delete("calendar.ics");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides every route except the tokenized subscription path", async () => {
    const fetchMock = createRssMock();
    vi.stubGlobal("fetch", fetchMock);

    const response = await exports.default.fetch(
      "https://example.com/calendar/wrong-token.ics",
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lazily initializes KV and serves subsequent requests from the snapshot", async () => {
    const fetchMock = createRssMock();
    vi.stubGlobal("fetch", fetchMock);

    const first = await exports.default.fetch(calendarUrl);
    const calendar = await first.text();

    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(first.headers.get("X-Calendar-Event-Count")).toBe("2");
    expect(first.headers.get("X-ZUK-Raw-Item-Count")).toBe("4");
    expect(first.headers.get("ETag")).toMatch(/^"[a-f\d]{64}"$/u);
    expect(calendar.match(/BEGIN:VEVENT/gu)).toHaveLength(2);

    const callsAfterInitialization = fetchMock.mock.calls.length;
    const second = await exports.default.fetch(calendarUrl);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterInitialization);
  });

  it("supports HEAD, method restrictions, and ETag revalidation", async () => {
    vi.stubGlobal("fetch", createRssMock());
    const first = await exports.default.fetch(calendarUrl);
    const etag = first.headers.get("ETag")!;

    const head = await exports.default.fetch(
      new Request(calendarUrl, { method: "HEAD" }),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const notModified = await exports.default.fetch(
      new Request(calendarUrl, { headers: { "If-None-Match": etag } }),
    );
    expect(notModified.status).toBe(304);

    const post = await exports.default.fetch(
      new Request(calendarUrl, { method: "POST" }),
    );
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("keeps timestamps and the ETag stable when the source is unchanged", async () => {
    const fetchMock = createRssMock();
    vi.stubGlobal("fetch", fetchMock);
    const initial = await exports.default.fetch(calendarUrl);
    const expectedCalendar = await initial.text();
    const expectedEtag = initial.headers.get("ETag");
    const before =
      await workerEnv.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
        "calendar.ics",
        "text",
      );

    fetchMock.mockClear();
    const refreshed = await refreshCalendar(
      workerEnv,
      new Date("2030-01-01T00:00:00Z"),
    );
    const after = await workerEnv.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
      "calendar.ics",
      "text",
    );

    expect(refreshed.metadata.lastModified).toBe(before.metadata?.lastModified);
    expect(refreshed.metadata.etag).toBe(expectedEtag);
    expect(after.value).toBe(expectedCalendar);
    expect(after.metadata).toEqual(before.metadata);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite the last good snapshot after an upstream failure", async () => {
    vi.stubGlobal("fetch", createRssMock());
    const initial = await exports.default.fetch(calendarUrl);
    const expectedCalendar = await initial.text();
    const before =
      await workerEnv.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
        "calendar.ics",
        "text",
      );

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await expect(refreshCalendar(workerEnv)).rejects.toThrow(
      "failed after 2 attempts",
    );

    const after = await workerEnv.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
      "calendar.ics",
      "text",
    );
    expect(after.value).toBe(expectedCalendar);
    expect(after.metadata).toEqual(before.metadata);
  });
});
