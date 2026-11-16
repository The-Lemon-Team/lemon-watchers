import { XMLParser } from 'fast-xml-parser';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { RawFeedItem, WatcherProtocol } from '../types/watcher.types.js';
import { cleanHtmlContent } from './content-cleaner.axon.js';
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

  const rawDesc =
    getNodeText(it.description) ||
    getNodeText(it['content:encoded']) ||
    '';

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

  const cleanSummary = cleanHtmlContent(rawDesc).slice(0, 1000);

  return {
    guid: String(guid).trim(),
    url: String(link).trim(),
    title: String(title).trim(),
    summary: cleanSummary,
    contentHtml: rawDesc,
    rawText: cleanSummary,
    pubDate: pubDateIso,
    author: getNodeText(it.author) || getNodeText(it['dc:creator']) || undefined,
    imageUrl: extractFeedImageUrl(it, rawDesc),
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
  const rawContent =
    getNodeText(en.content) ||
    getNodeText(en.summary) ||
    '';

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

  const cleanSummary = cleanHtmlContent(rawContent).slice(0, 1000);

  return {
    guid: String(guid).trim(),
    url: String(link).trim(),
    title: String(title).trim(),
    summary: cleanSummary,
    contentHtml: rawContent,
    rawText: cleanSummary,
    pubDate: pubDateIso,
    author: getNodeText(en.author?.name) || undefined,
    imageUrl: extractFeedImageUrl(en, rawContent),
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
        results.push({
          guid: p.paper.id,
          url: `https://huggingface.co/papers/${p.paper.id}`,
          title: p.paper.title,
          summary: cleanHtmlContent(p.paper.summary || ''),
          pubDate: p.paper.publishedAt || new Date().toISOString(),
          author: p.paper.authors?.[0]?.name,
          categories: ['ai', 'papers'],
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

function extractFeedImageUrl(node: any, htmlContent: string): string | undefined {
  const mediaCandidates = [
    node['media:content'],
    node['media:thumbnail'],
    node.enclosure,
    node['itunes:image'],
  ];

  for (const candidate of mediaCandidates) {
    const items = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];
    for (const entry of items) {
      const url = entry?.['@_url'] || entry?.['@_href'];
      const type = String(entry?.['@_type'] || '').toLowerCase();
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        if (!type || type.startsWith('image/') || entry === node['media:thumbnail']) {
          return url;
        }
      }
    }
  }

  if (htmlContent) {
    const imgMatch = htmlContent.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (imgMatch?.[1]) return imgMatch[1];
  }

  return undefined;
}
