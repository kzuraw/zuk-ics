# ZUK ICS

A self-hosted Cloudflare Worker that converts ZUK Kiełczów water-outage RSS
notices for one town into an Apple Calendar subscription.

The Worker refreshes the complete calendar every six hours, stores the last
valid ICS snapshot in Workers KV, and serves it through a secret URL. The first
valid subscription request initializes KV lazily, so the calendar works
immediately after deployment.

## Calendar behavior

- Notices match `ZUK_TOWN` case-insensitively as a complete place name in the
  RSS title or description.
- Timed events use the date and time range published by ZUK in the
  `Europe/Warsaw` time zone.
- The calendar is named `Wylaczenia wody`.
- Planned events are titled `Planowana przerwa w dostawie wody` and alert 24
  hours before they begin.
- Emergency events are titled `Awaryjne wyłączenie wody` and do not include an
  alert.
- Events are transparent and do not mark time as busy.
- The complete plain-text notice, source link, and configured town are included
  in each event.
- Each RSS item produces one event with a stable UID derived from its GUID.
- The feed is rebuilt from the authoritative RSS response; it does not maintain
  a separate historical archive.

If a refresh fails, or a matching notice has an unrecognized date or time, the
existing KV snapshot remains untouched. The failure is written to Cloudflare
logs and the next cron retries it. If the RSS data is unchanged, the Worker
preserves the existing snapshot, ETag, and event timestamps instead of making
Apple reprocess events.

## Requirements

- Node.js 24 LTS
- pnpm 12.4.2
- A Cloudflare account with Workers and Workers KV

## Local development

Install dependencies and create a local configuration:

```sh
pnpm install
cp .dev.vars.example .dev.vars
```

Replace every placeholder in `.dev.vars`. Generate a long calendar token with,
for example, `openssl rand -hex 32`.

Start the local Worker:

```sh
pnpm dev
```

Open the subscription path using the token from `.dev.vars`:

```text
http://localhost:8787/calendar/<CALENDAR_TOKEN>.ics
```

Trigger the scheduled handler locally:

```sh
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=17+*%2F6+*+*+*&format=json"
```

## Verification

```sh
pnpm lint
pnpm test
```

Tests run inside Cloudflare's Workers runtime with synthetic RSS fixtures; they
do not call the live ZUK website.

## Deployment

Deployment is intentionally manual.

1. Authenticate Wrangler:

   ```sh
   pnpm wrangler login
   pnpm wrangler whoami
   ```

2. The production `CALENDAR_KV` namespace is already configured in
   `wrangler.jsonc`. For a different Cloudflare account, create a namespace:

   ```sh
   pnpm wrangler kv namespace create CALENDAR_KV
   ```

   Then replace the existing namespace ID in `wrangler.jsonc` with the returned
   ID.

3. Add each production value as an encrypted Worker secret:

   ```sh
   pnpm wrangler secret put CALENDAR_TOKEN
   pnpm wrangler secret put ZUK_TOWN
   ```

4. Verify the project and build the production bundle without uploading it:

   ```sh
   pnpm lint
   pnpm test
   pnpm exec wrangler deploy --dry-run
   ```

5. Deploy:

   ```sh
   pnpm run deploy
   ```

6. Make one request to initialize KV:

   ```text
   https://<worker-host>/calendar/<CALENDAR_TOKEN>.ics
   ```

## Apple Calendar subscription

In Calendar on macOS, choose **File → New Calendar Subscription**, paste the
HTTPS subscription URL, and select a six-hour or more frequent auto-refresh
interval. Ensure **Ignore alerts** is disabled if you want the planned-outage
reminder.

Treat the full subscription URL as a password. Rotate access by changing
`CALENDAR_TOKEN`; old paths then return 404.

## HTTP behavior

Only `GET` and `HEAD` requests to the exact tokenized path are accepted. Other
paths return 404. Responses support `ETag` revalidation and expose snapshot
freshness through `Last-Modified`, `X-Calendar-Last-Updated`,
`X-Calendar-Event-Count`, and `X-ZUK-Raw-Item-Count` headers.

## Acknowledgements

Water-outage data comes from the public
[ZUK Kiełczów RSS feed](https://zuk-kielczow.pl/index.php/wodociagi/awarie-i-wylaczenia-wody?format=feed&type=rss).

This is an unofficial project. It is not affiliated with or endorsed by ZUK
Kiełczów. The upstream feed format may change without notice.

## License

This project is available under the [MIT License](LICENSE).
