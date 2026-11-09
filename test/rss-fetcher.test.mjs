import { describe, it, expect } from 'vitest';
import { parseXmlFeed } from '../src/axons/rss-atom-fetcher.axon.js';
import { cleanHtmlContent } from '../src/axons/content-cleaner.axon.js';

describe('RSS / Atom & Cleaner Axons', () => {
  it('cleanHtmlContent removes scripts, tags and decodes entities', () => {
    const raw = '<p>Hello <b>World</b> &amp; Antigravity!<script>alert(1)</script><br/>Test &mdash; ok</p>';
    const cleaned = cleanHtmlContent(raw);
    expect(cleaned).toContain('Hello World & Antigravity!');
    expect(cleaned).not.toContain('<script>');
    expect(cleaned).toContain('Test — ok');
  });

  it('parseXmlFeed extracts items from RSS 2.0 XML', () => {
    const rssSample = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Tech News</title>
        <link>https://example.com</link>
        <item>
          <title>Anthropic Claude 3.5 Sonnet Release</title>
          <link>https://example.com/claude-3-5</link>
          <guid>guid-claude-35</guid>
          <pubDate>Mon, 09 Nov 2026 09:30:00 GMT</pubDate>
          <description><![CDATA[<p>New model released with enhanced reasoning.</p>]]></description>
        </item>
      </channel>
    </rss>`;

    const items = parseXmlFeed(rssSample, 'https://example.com');
    expect(items).toHaveLength(1);
    expect(items[0].guid).toBe('guid-claude-35');
    expect(items[0].title).toBe('Anthropic Claude 3.5 Sonnet Release');
    expect(items[0].url).toBe('https://example.com/claude-3-5');
    expect(items[0].summary).toContain('New model released with enhanced reasoning.');
    expect(items[0].pubDate).toBe('2026-11-09T09:30:00.000Z');
  });

  it('parseXmlFeed extracts entries from Atom 1.0 XML', () => {
    const atomSample = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Feed</title>
      <entry>
        <title>DeepMind Gemini 3.0 Breakthrough</title>
        <id>urn:uuid:12345</id>
        <updated>2026-11-08T18:00:00Z</updated>
        <link rel="alternate" href="https://deepmind.google/gemini-3"/>
        <summary>New multimodal reasoning model.</summary>
      </entry>
    </feed>`;

    const items = parseXmlFeed(atomSample, 'https://deepmind.google');
    expect(items).toHaveLength(1);
    expect(items[0].guid).toBe('urn:uuid:12345');
    expect(items[0].title).toBe('DeepMind Gemini 3.0 Breakthrough');
    expect(items[0].url).toBe('https://deepmind.google/gemini-3');
    expect(items[0].summary).toBe('New multimodal reasoning model.');
    expect(items[0].pubDate).toBe('2026-11-08T18:00:00.000Z');
  });
});
