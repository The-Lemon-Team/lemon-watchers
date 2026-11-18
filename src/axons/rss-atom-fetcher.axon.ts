import { XMLParser } from 'fast-xml-parser';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { RawFeedItem, WatcherProtocol } from '../types/watcher.types.js';
import { cleanHtmlContent, htmlToArticleMarkdown } from './content-cleaner.axon.js';
import { config } from '../config.js';
import { proxyQueue } from './proxy-queue.axon.js';

export interface FetchResult {
  statusCode: number;
  latencyMs: number;
  notModified: boolean;
  etag?: string | null;
  lastModified?: string | null;
  items: RawFeedItem[];
  error?: string | null;
}

let defaultProxyAgent: HttpsProxyAgent<string> | null = null;
function getProxyAgent(proxyUrl?: string): HttpsProxyAgent<string> | undefined {
  const target = proxyUrl || config.watcherProxyUrl;
  if (!target) return undefined;
  if (!defaultProxyAgent) {
    try {
      defaultProxyAgent = new HttpsProxyAgent(target);
    } catch (e: any) {
      console.warn('[rss-atom-fetcher] Proxy init error:', e.message);
    }
  }
  return defaultProxyAgent || undefined;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  cdataPropName: '__cdata',
});

export async function fetchFeedItems(params: {
  url: string;
  protocol: WatcherProtocol;
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  proxyUrl?: string;
}): Promise<FetchResult> {
  return proxyQueue.enqueue(
    { url: params.url, protocol: params.protocol },
    () => executeFetchDirectly(params)
  );
}

async function executeFetchDirectly(params: {
  url: string;
  protocol: WatcherProtocol;
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  proxyUrl?: string;
}): Promise<FetchResult> {
  const startTime = Date.now();
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept:
      params.protocol === 'json_api'
        ? 'application/json'
        : 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  };

  if (params.etag) {
    headers['If-None-Match'] = params.etag;
  }
  if (params.lastModified) {
    headers['If-Modified-Since'] = params.lastModified;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    params.timeoutMs || 15000
  );

  const proxyAgent = getProxyAgent(params.proxyUrl);

  try {
    const fetchOptions: any = {
      method: 'GET',
      headers,
      signal: controller.signal,
    };
    if (proxyAgent) {
      fetchOptions.agent = proxyAgent;
    }

    const res = await fetch(params.url, fetchOptions);
    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startTime;
    const statusCode = res.status;

    if (statusCode === 304) {
      return {
        statusCode,
        latencyMs,
        notModified: true,
        etag: params.etag,
        lastModified: params.lastModified,
        items: [],
      };
    }

    if (!res.ok) {
      return {
        statusCode,
        latencyMs,
        notModified: false,
        items: [],
        error: `HTTP Error ${res.status}: ${res.statusText}`,
      };
    }

    const newEtag = res.headers.get('etag') || null;
    const newLastModified = res.headers.get('last-modified') || null;

    if (params.protocol === 'json_api') {
      const json = await res.json();
      const items = parseJsonApiItems(json, params.url);
      return {
        statusCode,
        latencyMs,
        notModified: false,
        etag: newEtag,
        lastModified: newLastModified,
        items,
      };
    }

    const rawXml = await res.text();
    const items = parseXmlFeed(rawXml, params.url);

    return {
      statusCode,
      latencyMs,
      notModified: false,
      etag: newEtag,
      lastModified: newLastModified,
      items,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    const causeMsg = err.cause ? ` (${err.cause.message || err.cause})` : '';
    console.error(`[rss-atom-fetcher] Fetch error for ${params.url}:`, err.message, err.cause);
    return {
      statusCode: err.name === 'AbortError' ? 408 : 500,
      latencyMs,
      notModified: false,
      items: [],
      error: `${err.message || 'Network fetch failure'}${causeMsg}`,
    };
  }
}

export function parseXmlFeed(xml: string, sourceUrl: string): RawFeedItem[] {
  try {
    const parsed = xmlParser.parse(xml);
    const results: RawFeedItem[] = [];

    // 1. RSS 2.0 / RSS 0.9x: <rss><channel><item>
    if (parsed.rss?.channel?.item) {
      const items = Array.isArray(parsed.rss.channel.item)
        ? parsed.rss.channel.item
        : [parsed.rss.channel.item];

      for (const it of items) {
        const item = extractRssItem(it, sourceUrl);
        if (item) results.push(item);
      }
      return results;
    }

    // 2. RDF: <rdf:RDF><item>
    if (parsed['rdf:RDF']?.item) {
      const items = Array.isArray(parsed['rdf:RDF'].item)
        ? parsed['rdf:RDF'].item
        : [parsed['rdf:RDF'].item];

      for (const it of items) {
        const item = extractRssItem(it, sourceUrl);
        if (item) results.push(item);
      }
      return results;
    }

    // 3. Atom: <feed><entry>
    if (parsed.feed?.entry) {
      const entries = Array.isArray(parsed.feed.entry)
        ? parsed.feed.entry
        : [parsed.feed.entry];

      for (const en of entries) {
        const item = extractAtomEntry(en, sourceUrl);
        if (item) results.push(item);
      }
      return results;
    }

    return results;
  } catch {
    return [];
  }
}

function extractRssItem(it: any, sourceUrl: string): RawFeedItem | null {
  const title = getNodeText(it.title);
  const link = getNodeText(it.link) || sourceUrl;
  const guid =
    getNodeText(it.guid) ||
    getNodeText(it['@_guid']) ||
    link;

  if (!title && !guid) return null;

  const descRaw = getNodeText(it.description);
  const encodedRaw = getNodeText(it['content:encoded']);
  const descText = cleanHtmlContent(descRaw);
  const encodedText = cleanHtmlContent(encodedRaw);

  const fullHtml =
    encodedText.length >= descText.length ? encodedRaw || descRaw : descRaw;
  const fullText = htmlToArticleMarkdown(fullHtml) || descText || encodedText;
  const cleanSummary = (descText || encodedText).slice(0, 1000);

  const pubDateRaw =
    getNodeText(it.pubDate) ||
    getNodeText(it['dc:date']) ||
    new Date().toISOString();

  let pubDateIso: string;
  try {
    pubDateIso = new Date(pubDateRaw).toISOString();
  } catch {
    pubDateIso = new Date().toISOString();
  }

  const itemUrl = String(link).trim();

  return {
    guid: String(guid).trim(),
    url: itemUrl,
    title: String(title).trim(),
    summary: cleanSummary,
    contentHtml: fullHtml,
    rawText: fullText,
    pubDate: pubDateIso,
    author: getNodeText(it.author) || getNodeText(it['dc:creator']) || undefined,
    imageUrl: extractFeedImageUrl(it, fullHtml || descRaw, itemUrl || sourceUrl),
  };
}

function extractAtomEntry(en: any, sourceUrl: string): RawFeedItem | null {
  const title = getNodeText(en.title);
  let link = sourceUrl;
  if (en.link) {
    if (Array.isArray(en.link)) {
      const alt = en.link.find((l: any) => l['@_rel'] === 'alternate') || en.link[0];
      link = alt?.['@_href'] || getNodeText(alt) || sourceUrl;
    } else if (typeof en.link === 'object') {
      link = en.link['@_href'] || getNodeText(en.link) || sourceUrl;
    } else {
      link = String(en.link);
    }
  }

  const guid = getNodeText(en.id) || link;
  const contentRaw = getNodeText(en.content);
  const summaryRaw = getNodeText(en.summary);
  const contentText = cleanHtmlContent(contentRaw);
  const summaryText = cleanHtmlContent(summaryRaw);

  const fullHtml =
    contentText.length >= summaryText.length ? contentRaw || summaryRaw : summaryRaw;
  const fullText = htmlToArticleMarkdown(fullHtml) || contentText || summaryText;
  const cleanSummary = (summaryText || contentText).slice(0, 1000);

  const pubDateRaw =
    getNodeText(en.published) ||
    getNodeText(en.updated) ||
    new Date().toISOString();

  let pubDateIso: string;
  try {
    pubDateIso = new Date(pubDateRaw).toISOString();
  } catch {
    pubDateIso = new Date().toISOString();
  }

  const itemUrl = String(link).trim();

  return {
    guid: String(guid).trim(),
    url: itemUrl,
    title: String(title).trim(),
    summary: cleanSummary,
    contentHtml: fullHtml,
    rawText: fullText,
    pubDate: pubDateIso,
    author: getNodeText(en.author?.name) || undefined,
    imageUrl: extractFeedImageUrl(en, fullHtml || contentRaw, itemUrl || sourceUrl),
  };
}

function parseJsonApiItems(json: any, sourceUrl: string): RawFeedItem[] {
  const results: RawFeedItem[] = [];

  // 1. CISA KEV JSON
  if (Array.isArray(json.vulnerabilities)) {
    for (const v of json.vulnerabilities) {
      results.push({
        guid: v.cveID,
        url: v.notes || `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
        title: `${v.cveID}: ${v.vulnerabilityName || v.shortDescription}`,
        summary: cleanHtmlContent(v.shortDescription || v.requiredAction),
        pubDate: v.dateAdded ? new Date(v.dateAdded).toISOString() : new Date().toISOString(),
        author: v.vendorProject,
        categories: ['cve', 'kev', 'vulnerability'],
      });
    }
    return results;
  }

  // 2. Hugging Face Daily Papers
  if (Array.isArray(json)) {
    for (const p of json) {
      if (p.paper?.id) {
        const pageUrl = `https://huggingface.co/papers/${p.paper.id}`;
        results.push({
          guid: p.paper.id,
          url: pageUrl,
          title: p.paper.title,
          summary: cleanHtmlContent(p.paper.summary || ''),
          pubDate: p.paper.publishedAt || new Date().toISOString(),
          author: p.paper.authors?.[0]?.name,
          categories: ['ai', 'papers'],
          imageUrl: resolveCandidateImageUrl(
            p.thumbnail || p.paper?.thumbnail || p.mediaUrls?.[0],
            pageUrl
          ),
        });
      }
    }
    return results;
  }

  return results;
}

function getNodeText(node: any): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node.__cdata) return String(node.__cdata);
  if (node['#text']) return String(node['#text']);
  return '';
}

const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)(?:[?#]|$)/i;
const TRACKING_IMAGE_RE = /(?:1x1|pixel|tracker|spacer|blank\.gif|feedburner\.com\/~r\/|doubleclick\.net)/i;

export function resolveCandidateImageUrl(
  rawUrl?: string | null,
  baseUrl?: string
): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim().replace(/&amp;/g, '&');
  if (!trimmed || /^data:/i.test(trimmed) || TRACKING_IMAGE_RE.test(trimmed)) {
    return undefined;
  }
  try {
    const resolved = baseUrl ? new URL(trimmed, baseUrl).href : new URL(trimmed).href;
    if (/^https?:\/\//i.test(resolved)) {
      return resolved;
    }
  } catch {
    // Ignore malformed URLs
  }
  return undefined;
}

export function extractFirstImageFromHtml(
  htmlContent?: string | null,
  baseUrl?: string
): string | undefined {
  if (!htmlContent) return undefined;
  const imgTagRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgTagRe.exec(htmlContent)) !== null) {
    const tag = match[0];
    // Skip explicit 1x1 tracking pixels
    if (/\b(?:width|height)=["']?1(?:px)?["']?/i.test(tag)) continue;

    const attrMatch = tag.match(/\b(?:src|data-src|data-original)=["']([^"']+)["']/i);
    if (!attrMatch?.[1]) continue;

    const resolved = resolveCandidateImageUrl(attrMatch[1], baseUrl);
    if (resolved) return resolved;
  }
  return undefined;
}

function extractFeedImageUrl(
  node: any,
  htmlContent: string,
  baseUrl?: string
): string | undefined {
  const mediaCandidates = [
    node['media:content'],
    node['media:thumbnail'],
    node['media:group']?.['media:content'],
    node['media:group']?.['media:thumbnail'],
    node.enclosure,
    node['itunes:image'],
    node.image,
  ];

  for (const candidate of mediaCandidates) {
    const items = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];
    for (const entry of items) {
      const rawUrl =
        typeof entry === 'string'
          ? entry
          : entry?.['@_url'] || entry?.['@_href'] || getNodeText(entry?.url) || getNodeText(entry);
      const type = String(entry?.['@_type'] || '').toLowerCase();
      const medium = String(entry?.['@_medium'] || '').toLowerCase();
      const isThumbnail =
        entry === node['media:thumbnail'] ||
        entry === node['itunes:image'] ||
        medium === 'image' ||
        type.startsWith('image/') ||
        (!type && (!rawUrl || IMAGE_EXT_RE.test(rawUrl) || entry === node['media:content']));

      if (isThumbnail) {
        const resolved = resolveCandidateImageUrl(rawUrl, baseUrl);
        if (resolved) return resolved;
      }
    }
  }

  // Atom <link rel="enclosure" type="image/..." href="...">
  if (node.link) {
    const links = Array.isArray(node.link) ? node.link : [node.link];
    for (const l of links) {
      if (l?.['@_rel'] === 'enclosure') {
        const type = String(l['@_type'] || '').toLowerCase();
        const href = l['@_href'];
        if (type.startsWith('image/') || (typeof href === 'string' && IMAGE_EXT_RE.test(href))) {
          const resolved = resolveCandidateImageUrl(href, baseUrl);
          if (resolved) return resolved;
        }
      }
    }
  }

  return extractFirstImageFromHtml(htmlContent, baseUrl);
}
