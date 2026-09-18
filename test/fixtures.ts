import { vi } from "vitest";

export const rssFixture = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>ZUK-Kiełczów - Awarie i wyłączenia</title>
    <item>
      <title>Przerwa w dostawie wody 21.09.2026 r. - Domaszczyn</title>
      <link>https://zuk-kielczow.pl/planned</link>
      <guid isPermaLink="true">https://zuk-kielczow.pl/planned</guid>
      <description><![CDATA[<p>W dniu <strong>21.09.2026 r.</strong> w godzinach <strong>08:30÷14:30</strong> w miejscowości <strong>Domaszczyn, ul. Brzozowa</strong> nastąpi przerwa w dostawie wody.</p>]]></description>
      <pubDate>Fri, 18 Sep 2026 08:00:00 +0200</pubDate>
    </item>
    <item>
      <title>Awaryjne wyłączenie wody - 18.09.2026 r. - Szczodre</title>
      <link>https://zuk-kielczow.pl/emergency</link>
      <guid isPermaLink="true">https://zuk-kielczow.pl/emergency</guid>
      <description><![CDATA[<p>W związku z awarią w dniu 18.09.2026 r. w godzinach 9:00-12:15 w miejscowościach Szczodre i Domaszczyn nastąpi przerwa.</p>]]></description>
      <pubDate>Fri, 18 Sep 2026 07:30:00 +0200</pubDate>
    </item>
    <item>
      <title>Przerwa w dostawie wody 22.09.2026 r. - Kiełczów</title>
      <link>https://zuk-kielczow.pl/other</link>
      <guid isPermaLink="true">https://zuk-kielczow.pl/other</guid>
      <description><![CDATA[<p>Niepełny komunikat dla Kiełczowa.</p>]]></description>
      <pubDate>Fri, 18 Sep 2026 08:00:00 +0200</pubDate>
    </item>
    <item>
      <title>Przerwa w dostawie wody 22.09.2026 r. - Domaszczyniec</title>
      <link>https://zuk-kielczow.pl/substring</link>
      <guid isPermaLink="true">https://zuk-kielczow.pl/substring</guid>
      <description><![CDATA[<p>W dniu 22.09.2026 r. w godzinach 10:00÷11:00 w miejscowości Domaszczyniec.</p>]]></description>
      <pubDate>Fri, 18 Sep 2026 08:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

export function createRssMock(xml = rssFixture) {
  return vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(xml, {
        headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
      }),
  );
}
