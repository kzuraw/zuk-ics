import { calculateSha256, generateCalendar } from "./calendar";
import type {
  CalendarConfig,
  CalendarMetadata,
  CalendarSnapshot,
} from "./types";
import { fetchOutageSchedule } from "./zuk";

const CALENDAR_KEY = "calendar.ics";

function requireBinding(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required binding: ${name}`);
  }
  return normalized;
}

function getCalendarConfig(env: Env): CalendarConfig {
  return { town: requireBinding(env.ZUK_TOWN, "ZUK_TOWN") };
}

function logError(event: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
}

function serializeOutagesForHash(
  outages: Awaited<ReturnType<typeof fetchOutageSchedule>>["outages"],
): string {
  return JSON.stringify(
    outages.map((outage) => ({
      end: outage.end,
      guid: outage.guid,
      kind: outage.kind,
      link: outage.link,
      message: outage.message,
      published: outage.published.toISOString(),
      sourceTitle: outage.sourceTitle,
      start: outage.start,
    })),
  );
}

export async function refreshCalendar(
  env: Env,
  generatedAt = new Date(),
): Promise<CalendarSnapshot> {
  const config = getCalendarConfig(env);
  const schedule = await fetchOutageSchedule(config);
  const sourceHash = await calculateSha256(
    serializeOutagesForHash(schedule.outages),
  );
  const current = await env.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
    CALENDAR_KEY,
    "text",
  );

  if (
    current.value !== null &&
    current.metadata !== null &&
    current.metadata.sourceHash === sourceHash
  ) {
    console.log(
      JSON.stringify({
        event: "calendar.refresh.unchanged",
        eventCount: current.metadata.eventCount,
        lastModified: current.metadata.lastModified,
        rawItemCount: schedule.rawItemCount,
      }),
    );
    return { calendar: current.value, metadata: current.metadata };
  }

  const calendar = await generateCalendar(
    schedule.outages,
    config,
    generatedAt,
  );
  const metadata: CalendarMetadata = {
    etag: `"${await calculateSha256(calendar)}"`,
    eventCount: schedule.outages.length,
    lastModified: generatedAt.toISOString(),
    rawItemCount: schedule.rawItemCount,
    sourceHash,
  };
  await env.CALENDAR_KV.put(CALENDAR_KEY, calendar, { metadata });
  console.log(
    JSON.stringify({
      event: "calendar.refresh.success",
      eventCount: metadata.eventCount,
      lastModified: metadata.lastModified,
      rawItemCount: metadata.rawItemCount,
    }),
  );
  return { calendar, metadata };
}

async function getSnapshot(env: Env): Promise<CalendarSnapshot> {
  const stored = await env.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
    CALENDAR_KEY,
    "text",
  );
  if (stored.value !== null && stored.metadata !== null) {
    return { calendar: stored.value, metadata: stored.metadata };
  }
  return refreshCalendar(env);
}

function createResponseHeaders(metadata: CalendarMetadata): Headers {
  return new Headers({
    "Cache-Control": "private, max-age=3600, must-revalidate",
    "Content-Disposition": 'inline; filename="zuk.ics"',
    "Content-Type": "text/calendar; charset=utf-8",
    ETag: metadata.etag,
    "Last-Modified": new Date(metadata.lastModified).toUTCString(),
    "X-Calendar-Event-Count": metadata.eventCount.toString(),
    "X-Calendar-Last-Updated": metadata.lastModified,
    "X-ZUK-Raw-Item-Count": metadata.rawItemCount.toString(),
  });
}

async function tokensMatch(
  provided: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    difference |= providedBytes[index]! ^ expectedBytes[index]!;
  }
  return difference === 0;
}

async function hasValidCalendarPath(url: URL, env: Env): Promise<boolean> {
  const match = /^\/calendar\/([^/]+)\.ics$/u.exec(url.pathname);
  if (!match?.[1]) {
    return false;
  }
  let provided: string;
  try {
    provided = decodeURIComponent(match[1]);
  } catch {
    return false;
  }
  return tokensMatch(
    provided,
    requireBinding(env.CALENDAR_TOKEN, "CALENDAR_TOKEN"),
  );
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!(await hasValidCalendarPath(url, env))) {
    return new Response("Not found", { status: 404 });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  try {
    const stored = await getSnapshot(env);
    const headers = createResponseHeaders(stored.metadata);
    if (request.headers.get("If-None-Match") === stored.metadata.etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === "HEAD" ? null : stored.calendar, {
      status: 200,
      headers,
    });
  } catch (error) {
    logError("calendar.serve.error", error);
    return new Response("Calendar is temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "3600" },
    });
  }
}

export default {
  fetch: handleFetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      await refreshCalendar(env);
    } catch (error) {
      logError("calendar.refresh.error", error);
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
