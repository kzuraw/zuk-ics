import { describe, expect, it } from "vitest";

import { generateCalendar } from "../src/calendar";
import type { Outage } from "../src/types";

const outages: Outage[] = [
  {
    end: { date: "2026-09-21", time: "14:30" },
    guid: "https://zuk-kielczow.pl/planned",
    kind: "planned",
    link: "https://zuk-kielczow.pl/planned",
    message: "Domaszczyn, ul. Brzozowa – przerwa w dostawie wody.",
    published: new Date("2026-09-18T06:00:00Z"),
    sourceTitle: "Planowane wyłączenie",
    start: { date: "2026-09-21", time: "08:30" },
  },
  {
    end: { date: "2026-09-18", time: "12:15" },
    guid: "https://zuk-kielczow.pl/emergency",
    kind: "emergency",
    link: "https://zuk-kielczow.pl/emergency",
    message: "Domaszczyn: awaria.",
    published: new Date("2026-09-18T05:30:00Z"),
    sourceTitle: "Awaryjne wyłączenie",
    start: { date: "2026-09-18", time: "09:00" },
  },
];

describe("generateCalendar", () => {
  it("creates transparent Warsaw-time events with stable distinct UIDs", async () => {
    const calendar = await generateCalendar(
      outages,
      { town: "Domaszczyn" },
      new Date("2026-09-18T08:00:00Z"),
    );

    expect(calendar).toContain("X-WR-CALNAME:Wylaczenia wody\r\n");
    expect(calendar.match(/BEGIN:VEVENT/gu)).toHaveLength(2);
    expect(calendar).toContain(
      "DTSTART;TZID=Europe/Warsaw:20260921T083000\r\n",
    );
    expect(calendar).toContain("DTEND;TZID=Europe/Warsaw:20260921T143000\r\n");
    expect(calendar.match(/UID:[a-f\d]{40}@zuk-ics/gu)).toHaveLength(2);
    expect(calendar.match(/TRANSP:TRANSPARENT/gu)).toHaveLength(2);
    expect(calendar).toContain("LOCATION:Domaszczyn\r\n");
    expect(calendar).toContain("URL:https://zuk-kielczow.pl/planned\r\n");
  });

  it("alerts only for planned outages", async () => {
    const calendar = await generateCalendar(
      outages,
      { town: "Domaszczyn" },
      new Date("2026-09-18T08:00:00Z"),
    );

    expect(calendar).toContain("SUMMARY:Planowana przerwa w dostawie wody\r\n");
    expect(calendar).toContain("SUMMARY:Awaryjne wyłączenie wody\r\n");
    expect(calendar.match(/BEGIN:VALARM/gu)).toHaveLength(1);
    expect(calendar).toContain("TRIGGER:-P1D\r\n");
  });

  it("uses CRLF and folds every physical line to at most 75 UTF-8 octets", async () => {
    const calendar = await generateCalendar(
      outages,
      { town: "Domaszczyn" },
      new Date("2026-09-18T08:00:00Z"),
    );

    expect(calendar.replaceAll("\r\n", "")).not.toContain("\n");
    for (const line of calendar.split("\r\n")) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    }
  });
});
