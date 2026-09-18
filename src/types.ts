export interface CalendarConfig {
  town: string;
}

export type OutageKind = "emergency" | "planned";

export interface LocalDateTime {
  date: string;
  time: string;
}

export interface Outage {
  end: LocalDateTime;
  guid: string;
  kind: OutageKind;
  link: string;
  message: string;
  published: Date;
  sourceTitle: string;
  start: LocalDateTime;
}

export interface OutageSchedule {
  outages: Outage[];
  rawItemCount: number;
}

export interface CalendarMetadata {
  etag: string;
  eventCount: number;
  lastModified: string;
  rawItemCount: number;
  sourceHash: string;
}

export interface CalendarSnapshot {
  calendar: string;
  metadata: CalendarMetadata;
}
