import { HttpsProxyAgent } from 'https-proxy-agent';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { cleanHtmlContent, htmlToArticleMarkdown } from './content-cleaner.axon.js';
import { proxyQueue } from './proxy-queue.axon.js';

export type ContentOrigin = 'feed' | 'scraped' | 'ai_generated';

export interface ExtractedPageContent {
  text: string;
  title?: string;
  excerpt?: string;
  byline?: string;
  lang?: string;
}

export interface ResolvedArticleText {
  text: string;
  title?: string;
  excerpt?: string;
  byline?: string;
  lang?: string;
  contentOrigin: ContentOrigin;
  pageHtml?: string;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TEASER_END_RE =
  /(?:\.\.\.|…|читать\s+далее|читать\s+полностью|подробнее|read\s+more|continue\s+reading|view\s+full\s+article)\s*[→»]*\s*$/i;

const BOT_WALL_PATTERNS: RegExp[] = [
  /enable\s+javascript\s+and\s+cookies/i,
  /attention\s+required!\s*\|\s*cloudflare/i,
  /just\s+a\s+moment\.{0,3}\s*(?:checking|verifying)/i,
  /verify\s+you\s+are\s+(?:human|not\s+a\s+bot)/i,
  /please\s+turn\s+on\s+cookies/i,
  /access\s+to\s+this\s+page\s+has\s+been\s+denied/i,
  /subscribe\s+to\s+(?:continue|read\s+the\s+full\s+article)/i,
];

const NON_HTML_EXT_RE = /\.(?:pdf|zip|tar|gz|mp4|mp3|wav|png|jpe?g|webp|gif|svg|exe|dmg)(?:[?#]|$)/i;

export class ArticleExtractorAxon {
  private readonly proxyAgent?: HttpsProxyAgent<string>;
  private readonly timeoutMs: number;

  constructor(options?: { proxyUrl?: string; timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? 10000;
    if (options?.proxyUrl) {
      try {
        this.proxyAgent = new HttpsProxyAgent(options.proxyUrl);
      } catch (err: any) {
        console.warn(`[ArticleExtractorAxon] Proxy init warning: ${err?.message || err}`);
      }
    }
  }

  public isTeaserTruncated(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;
    return TEASER_END_RE.test(trimmed);
  }

  public isLikelyBlockedOrPaywall(text: string): boolean {
    const sample = text.slice(0, 1500);
    if (text.length < 1200 && BOT_WALL_PATTERNS.some((re) => re.test(sample))) {
      return true;
    }
    return false;
  }

  public extractFromHtml(html: string, articleUrl?: string): ExtractedPageContent | null {
    if (!html || html.trim().length < 100) return null;

    try {
      const { document } = parseHTML(html);
      if (articleUrl && document.head) {
        try {
          const base = document.createElement('base');
          base.setAttribute('href', articleUrl);
          document.head.prepend(base);
        } catch {
          // Ignore invalid base URL
        }
      }

      const reader = new Readability(
        document as unknown as ConstructorParameters<typeof Readability>[0],
        {
          charThreshold: 200,
        }
      );
      const parsed = reader.parse();
      if (!parsed) return null;

      const markdown = parsed.content
        ? htmlToArticleMarkdown(parsed.content)
        : cleanHtmlContent(parsed.textContent || '');
      const normalized = markdown.trim();

      if (normalized.length < 350) return null;
      if (this.isLikelyBlockedOrPaywall(normalized)) return null;

      return {
        text: normalized,
        title: parsed.title?.trim() || undefined,
        excerpt: parsed.excerpt?.trim() || undefined,
        byline: parsed.byline?.trim() || undefined,
        lang: parsed.lang?.trim().toLowerCase().slice(0, 8) || undefined,
      };
    } catch (err: any) {
      console.warn(
        `[ArticleExtractorAxon] Readability parse error (${articleUrl || 'html'}): ${err?.message || err}`
      );
      return null;
    }
  }

  public async fetchPageHtml(articleUrl: string): Promise<string | null> {
    if (!articleUrl || !/^https?:\/\//i.test(articleUrl)) return null;
    if (NON_HTML_EXT_RE.test(articleUrl)) return null;

    try {
      return await proxyQueue.enqueue({ url: articleUrl, protocol: 'html' }, async () => {
        const fetchOptions: any = {
          method: 'GET',
          headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        };
        if (this.proxyAgent) {
          fetchOptions.agent = this.proxyAgent;
        }

        const res = await fetch(articleUrl, fetchOptions);
        if (!res.ok) return null;

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (
          contentType &&
          !contentType.includes('text/html') &&
          !contentType.includes('application/xhtml+xml')
        ) {
          return null;
        }

        const html = await res.text();
        return html.slice(0, 1_500_000);
      });
    } catch {
      return null;
    }
  }

  /**
   * Resolves original article text with priority:
   * 1. Substantial non-truncated feed text ('feed')
   * 2. Scraped webpage body via linkedom + Readability ('scraped')
   * 3. Moderately complete feed text without teaser markers ('feed')
   * 4. Empty fallback signal ('ai_generated') so caller falls back to LLM generation
   */
  public async resolveArticleText(params: {
    url: string;
    feedText?: string;
    feedHtml?: string;
    minFeedLength?: number;
  }): Promise<ResolvedArticleText> {
    const minFeedLength = params.minFeedLength ?? 1000;
    const fromHtml = params.feedHtml ? htmlToArticleMarkdown(params.feedHtml) : '';
    const fromText = params.feedText ? cleanHtmlContent(params.feedText) : '';
    const normalizedFeed =
      fromHtml.length >= fromText.length ? fromHtml.trim() : (params.feedText || '').trim();

    if (normalizedFeed.length >= minFeedLength && !this.isTeaserTruncated(normalizedFeed)) {
      return {
        text: normalizedFeed,
        contentOrigin: 'feed',
      };
    }

    const pageHtml = await this.fetchPageHtml(params.url);
    if (pageHtml) {
      const extracted = this.extractFromHtml(pageHtml, params.url);
      if (extracted && extracted.text.length >= Math.max(350, normalizedFeed.length)) {
        return {
          ...extracted,
          contentOrigin: 'scraped',
          pageHtml,
        };
      }
    }

    if (normalizedFeed.length >= 450 && !this.isTeaserTruncated(normalizedFeed)) {
      return {
        text: normalizedFeed,
        contentOrigin: 'feed',
        pageHtml: pageHtml || undefined,
      };
    }

    return {
      text: '',
      contentOrigin: 'ai_generated',
      pageHtml: pageHtml || undefined,
    };
  }
}
