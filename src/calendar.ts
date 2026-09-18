import type { CalendarConfig, LocalDateTime, Outage } from "./types";

const CALENDAR_NAME = "Wylaczenia wody";
const encoder = new TextEncoder();

function escapeText(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/\r?\n/gu, "\\n")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,");
}

function foldLine(line: string): string {
  const lines: string[] = [];
  let current = "";
  let byteLength = 0;
  let limit = 75;

  for (const character of line) {
    const characterBytes = encoder.encode(character).byteLength;
    if (byteLength + characterBytes > limit && current.length > 0) {
      lines.push(current);
      current = character;
      byteLength = characterBytes;
      limit = 74;
      continue;
    }
    current += character;
    byteLength += characterBytes;
  }

  lines.push(current);
  return lines.join("\r\n ");
}

function formatUtcTimestamp(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function formatLocalTimestamp(value: LocalDateTime): string {
  return `${value.date.replaceAll("-", "")}T${value.time.replace(":", "")}00`;
}

function getSummary(outage: Outage): string {
  return outage.kind === "emergency"
    ? "Awaryjne wyłączenie wody"
    : "Planowana przerwa w dostawie wody";
}

function buildDescription(outage: Outage): string {
  return `${outage.message}\n\nŹródło: ${outage.link}`;
}

export async function calculateSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateCalendar(
  outages: Outage[],
  config: CalendarConfig,
  generatedAt: Date,
): Promise<string> {
  const timestamp = formatUtcTimestamp(generatedAt);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//zuk-ics//PL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(CALENDAR_NAME)}`,
    "X-WR-TIMEZONE:Europe/Warsaw",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];

  for (const outage of outages) {
    const summary = getSummary(outage);
    const uidHash = (await calculateSha256(outage.guid)).slice(0, 40);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uidHash}@zuk-ics`,
      `DTSTAMP:${timestamp}`,
      `CREATED:${formatUtcTimestamp(outage.published)}`,
      `LAST-MODIFIED:${timestamp}`,
      `DTSTART;TZID=Europe/Warsaw:${formatLocalTimestamp(outage.start)}`,
      `DTEND;TZID=Europe/Warsaw:${formatLocalTimestamp(outage.end)}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(buildDescription(outage))}`,
      `LOCATION:${escapeText(config.town)}`,
      `URL:${outage.link}`,
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
    );

    if (outage.kind === "planned") {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(`${summary} za 24 godziny`)}`,
        "TRIGGER:-P1D",
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
