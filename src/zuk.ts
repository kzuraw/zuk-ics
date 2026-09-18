import type {
  CalendarConfig,
  LocalDateTime,
  Outage,
  OutageKind,
  OutageSchedule,
} from "./types";

const RSS_URL =
  "https://zuk-kielczow.pl/index.php/wodociagi/awarie-i-wylaczenia-wody?format=feed&type=rss";
const MAX_FEED_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/giu,
    (match, entity: string) => {
      const normalized = entity.toLowerCase();
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : normalized.startsWith("#")
          ? Number.parseInt(normalized.slice(1), 10)
          : undefined;

      if (codePoint !== undefined) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }

      return named[normalized] ?? match;
    },
  );
}

function unwrapCdata(value: string): string {
  const trimmed = value.trim();
  const match = /^<!\[CDATA\[([\s\S]*)\]\]>$/u.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function extractTag(
  item: string,
  tag: "description" | "guid" | "link" | "pubDate" | "title",
): string | null {
  const match = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "iu",
  ).exec(item);
  return match?.[1] === undefined
    ? null
    : decodeEntities(unwrapCdata(match[1])).trim();
}

export function convertHtmlToPlainText(value: string): string {
  return decodeEntities(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "")
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<li\b[^>]*>/giu, "- ")
      .replace(/<\/(?:div|li|p)\s*>/giu, "\n")
      .replace(/<[^>]+>/gu, ""),
  )
    .replace(/\u00a0/gu, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("pl-PL");
}

export function containsPlaceName(value: string, town: string): boolean {
  const text = normalize(value);
  const place = normalize(town);
  if (place.length === 0) {
    return false;
  }

  let offset = text.indexOf(place);
  while (offset >= 0) {
    const before = offset === 0 ? undefined : text.at(offset - 1);
    const after = text.at(offset + place.length);
    const isWord = (character: string | undefined): boolean =>
      character !== undefined && /[\p{L}\p{N}]/u.test(character);
    if (!isWord(before) && !isWord(after)) {
      return true;
    }
    offset = text.indexOf(place, offset + place.length);
  }

  return false;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseLocalDate(text: string): string {
  const match = /\b(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4})\b/u.exec(
    text,
  );
  if (!match) {
    throw new Error("notice has no recognized outage date");
  }

  const day = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const year = Number.parseInt(match[3]!, 10);
  if (!isValidDate(year, month, day)) {
    throw new Error("notice has an invalid outage date");
  }

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseLocalTimes(text: string): { end: string; start: string } {
  const match =
    /\b(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:÷|[-–—])\s*(\d{1,2})\s*[:.]\s*(\d{2})\b/u.exec(
      text,
    );
  if (!match) {
    throw new Error("notice has no recognized outage time range");
  }

  const startHour = Number.parseInt(match[1]!, 10);
  const startMinute = Number.parseInt(match[2]!, 10);
  const endHour = Number.parseInt(match[3]!, 10);
  const endMinute = Number.parseInt(match[4]!, 10);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) {
    throw new Error("notice has an invalid outage time range");
  }
  if (endHour * 60 + endMinute <= startHour * 60 + startMinute) {
    throw new Error("notice outage end must be after its start");
  }

  return {
    start: `${startHour.toString().padStart(2, "0")}:${startMinute
      .toString()
      .padStart(2, "0")}`,
    end: `${endHour.toString().padStart(2, "0")}:${endMinute
      .toString()
      .padStart(2, "0")}`,
  };
}

function classifyOutage(text: string): OutageKind {
  return /\b(?:awari\p{L}*|awaryjn\p{L}*)/iu.test(text)
    ? "emergency"
    : "planned";
}

function parsePublished(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("notice has an invalid publication date");
  }
  return date;
}

function requireField(value: string | null, field: string): string {
  if (!value) {
    throw new Error(`notice is missing ${field}`);
  }
  return value;
}

function validateSourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("notice link is not HTTP(S)");
  }
  return url.toString();
}

function parseMatchingItem(
  item: string,
  config: CalendarConfig,
): Outage | null {
  const title = extractTag(item, "title") ?? "";
  const htmlDescription = extractTag(item, "description") ?? "";
  const message = convertHtmlToPlainText(htmlDescription);
  const searchableText = `${title}\n${message}`;
  if (!containsPlaceName(searchableText, config.town)) {
    return null;
  }

  try {
    const date = parseLocalDate(searchableText);
    const times = parseLocalTimes(searchableText);
    const start: LocalDateTime = { date, time: times.start };
    const end: LocalDateTime = { date, time: times.end };
    return {
      end,
      guid: requireField(extractTag(item, "guid"), "GUID"),
      kind: classifyOutage(searchableText),
      link: validateSourceUrl(requireField(extractTag(item, "link"), "link")),
      message: requireField(message, "description"),
      published: parsePublished(
        requireField(extractTag(item, "pubDate"), "publication date"),
      ),
      sourceTitle: requireField(title, "title"),
      start,
    };
  } catch (error) {
    throw new Error(
      `Cannot parse matching ZUK notice: ${title || "untitled"}`,
      {
        cause: error,
      },
    );
  }
}

export function parseRssFeed(
  xml: string,
  config: CalendarConfig,
): OutageSchedule {
  if (!/<rss\b/iu.test(xml) || !/<channel\b/iu.test(xml)) {
    throw new Error("ZUK response is not an RSS channel");
  }

  const openingItems = xml.match(/<item\b/giu)?.length ?? 0;
  const itemMatches = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)];
  if (itemMatches.length !== openingItems) {
    throw new Error("ZUK RSS contains an incomplete item");
  }

  const outages = itemMatches
    .map((match) => parseMatchingItem(match[1]!, config))
    .filter((outage): outage is Outage => outage !== null)
    .sort((left, right) => {
      const startComparison =
        `${left.start.date}T${left.start.time}`.localeCompare(
          `${right.start.date}T${right.start.time}`,
        );
      return startComparison || left.guid.localeCompare(right.guid);
    });

  return { outages, rawItemCount: itemMatches.length };
}

async function readBoundedText(response: Response): Promise<string> {
  const contentLength = response.headers.get("Content-Length");
  if (
    contentLength !== null &&
    Number.parseInt(contentLength, 10) > MAX_FEED_BYTES
  ) {
    throw new Error("ZUK RSS exceeds the maximum supported size");
  }
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytesRead += value.byteLength;
    if (bytesRead > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error("ZUK RSS exceeds the maximum supported size");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchOutageSchedule(
  config: CalendarConfig,
): Promise<OutageSchedule> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(RSS_URL, {
        headers: {
          Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`ZUK RSS returned HTTP ${response.status}`);
      }
      return parseRssFeed(await readBoundedText(response), config);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`ZUK RSS failed after ${MAX_ATTEMPTS} attempts`, {
    cause: lastError,
  });
}
