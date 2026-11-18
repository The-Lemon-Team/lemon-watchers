import { describe, it, expect } from 'vitest';
import { parseXmlFeed } from '../dist/axons/rss-atom-fetcher.axon.js';
import { cleanHtmlContent, htmlToArticleMarkdown } from '../dist/axons/content-cleaner.axon.js';

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

  it('extracts original cover imageUrl from media:content, Atom enclosure, and HTML img (skipping tracking pixels)', () => {
    const rssWithMedia = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
      <channel>
        <item>
          <title>Visual Story</title>
          <link>https://news.example.com/posts/1</link>
          <guid>post-1</guid>
          <media:group>
            <media:content url="https://cdn.example.com/hero.jpg" medium="image" />
          </media:group>
          <description><![CDATA[<img src="https://tracker.example.com/1x1.gif" width="1" height="1"/><p>Text</p>]]></description>
        </item>
        <item>
          <title>Relative HTML Image</title>
          <link>https://news.example.com/posts/2</link>
          <guid>post-2</guid>
          <description><![CDATA[<img src="/assets/cover-2.png" alt="cover"/>]]></description>
        </item>
      </channel>
    </rss>`;

    const rssItems = parseXmlFeed(rssWithMedia, 'https://news.example.com/rss');
    expect(rssItems[0].imageUrl).toBe('https://cdn.example.com/hero.jpg');
    expect(rssItems[1].imageUrl).toBe('https://news.example.com/assets/cover-2.png');

    const atomWithEnclosure = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Atom Photo Story</title>
        <id>atom-photo-1</id>
        <link rel="alternate" href="https://blog.example.com/story"/>
        <link rel="enclosure" type="image/webp" href="//img.example.com/cover.webp"/>
      </entry>
    </feed>`;

    const atomItems = parseXmlFeed(atomWithEnclosure, 'https://blog.example.com/feed.xml');
    expect(atomItems[0].imageUrl).toBe('https://img.example.com/cover.webp');
  });

  it('prefers longer content:encoded over short description and keeps full rawText without 1000-char truncation', () => {
    const longParagraph = 'Security research details on reactive architectures and kernel telemetry. '.repeat(25);
    const rssWithEncoded = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel>
        <item>
          <title>Deep Technical Analysis</title>
          <link>https://security.example.com/deep-analysis</link>
          <guid>deep-1</guid>
          <description><![CDATA[<p>Short teaser only.</p>]]></description>
          <content:encoded><![CDATA[<h2>Architecture</h2><p>${longParagraph}</p><ul><li>Point A</li><li>Point B</li></ul>]]></content:encoded>
        </item>
      </channel>
    </rss>`;

    const items = parseXmlFeed(rssWithEncoded, 'https://security.example.com/feed');
    expect(items).toHaveLength(1);
    expect(items[0].summary).toBe('Short teaser only.');
    expect(items[0].rawText.length).toBeGreaterThan(1200);
    expect(items[0].rawText).toContain('## Architecture');
    expect(items[0].rawText).toContain('- Point A');
  });

  it('htmlToArticleMarkdown preserves headings, lists, blockquotes and code blocks', () => {
    const html = '<h2>Overview</h2><p>Paragraph text.</p><blockquote>Quoted insight</blockquote><pre><code>const x = 1;</code></pre>';
    const md = htmlToArticleMarkdown(html);
    expect(md).toContain('## Overview');
    expect(md).toContain('Paragraph text.');
    expect(md).toContain('> Quoted insight');
    expect(md).toContain('```\nconst x = 1;\n```');
  });
});
