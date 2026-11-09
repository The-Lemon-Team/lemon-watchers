import crypto from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { RawFeedItem, WatcherConfig } from '../types/watcher.types.js';
import { SparkNotePayload } from '../types/note-payload.types.js';

export class GeminiSparkAxon {
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly proxyAgent?: any;
  private readonly enabled: boolean;

  constructor(options: {
    apiKey: string;
    modelName?: string;
    proxyUrl?: string;
    enabled?: boolean;
  }) {
    this.apiKey = options.apiKey;
    this.modelName = options.modelName || 'gemini-2.5-flash';
    this.enabled = options.enabled !== false && !!this.apiKey;

    if (options.proxyUrl) {
      try {
        this.proxyAgent = new HttpsProxyAgent(options.proxyUrl);
      } catch (err: any) {
        console.warn(`[GeminiSparkAxon] Proxy init warning: ${err.message}`);
      }
    }
  }

  async enrichRawFeedItem(
    item: RawFeedItem,
    watcher: WatcherConfig
  ): Promise<SparkNotePayload> {
    const noteId = crypto.randomUUID();
    const eventDate = item.pubDate || new Date().toISOString();

    if (this.enabled) {
      try {
        const enriched = await this.callGeminiApi(item, watcher);
        if (enriched) {
          return this.buildPayloadFromEnriched(noteId, item, watcher, enriched, eventDate);
        }
      } catch (err: any) {
        console.warn(
          `[GeminiSparkAxon] AI enrichment failed for "${item.title}": ${err.message}. Using canonical fallback.`
        );
      }
    }

    // Fallback if AI disabled or request failed
    return this.buildCanonicalFallbackPayload(noteId, item, watcher, eventDate);
  }

  private async callGeminiApi(
    item: RawFeedItem,
    watcher: WatcherConfig
  ): Promise<{
    titleRu: string;
    summaryRu: string;
    bodyMarkdownRu: string;
    tags: string[];
    resonanceScore: number;
    icon: string;
  } | null> {
    const prompt = `Ты — ведущий технический редактор и аналитик новостей Lemon Seasons (проект Spark).
Твоя задача — адаптировать сырую новость под строгий формат Spark Note.

СЫРАЯ НОВОСТЬ:
- Заголовок: ${item.title}
- Первоисточник: ${item.url}
- Ресурс: ${watcher.title} (категория: ${watcher.category})
- Дата события: ${item.pubDate}
- Автор: ${item.author || 'Не указан'}
- Текст/Аннотация:
${item.summary || item.rawText || item.title}

ПРАВИЛА SPARK:
1. Заголовок (titleRu): четкий, емкий, на русском языке (без кликбейта, отражает суть).
2. Выжимка (summaryRu): 2-3 плотных предложения с ключевыми фактами и цифрами.
3. Тело статьи (bodyMarkdownRu): 2-4 абзаца с аналитическим контекстом на русском языке.
4. Теги (tags): 3-6 тематических тегов на русском или латинице (без символа '#').
   СТРОГО ЗАПРЕЩЕНО добавлять тег 'jmdaily' (зарезервирован для ручной курации).
5. Резонанс (resonanceScore): целое число от 0 до 100, отражающее важность инфоповода для индустрии.
6. Иконка (icon): подходящий единичный эмодзи (например 🤖, 🛡️, ⚡, 🚀, 📈).

ВЕРНИ ОТВЕТ СТРОГО В ФОРМАТЕ JSON без разметки markdown:
{
  "titleRu": "...",
  "summaryRu": "...",
  "bodyMarkdownRu": "...",
  "tags": ["...", "..."],
  "resonanceScore": 75,
  "icon": "🤖"
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    };

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };

    if (this.proxyAgent) {
      (fetchOptions as any).agent = this.proxyAgent;
    }

    const res = await fetch(url, fetchOptions);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return null;

    const parsed = JSON.parse(candidateText);

    // Sanitize tags: remove '#' and exclude 'jmdaily'
    const cleanTags = (Array.isArray(parsed.tags) ? parsed.tags : [])
      .map((t: string) => String(t).replace(/^#/, '').trim().toLowerCase())
      .filter((t: string) => t && t !== 'jmdaily');

    const combinedTags = Array.from(
      new Set([...(watcher.defaultTags || []).map((t) => t.toLowerCase()), ...cleanTags])
    );

    return {
      titleRu: parsed.titleRu || item.title,
      summaryRu: parsed.summaryRu || item.summary,
      bodyMarkdownRu: parsed.bodyMarkdownRu || item.summary,
      tags: combinedTags,
      resonanceScore: Math.min(100, Math.max(0, parseInt(parsed.resonanceScore, 10) || 60)),
      icon: parsed.icon || '📰',
    };
  }

  private buildPayloadFromEnriched(
    noteId: string,
    item: RawFeedItem,
    watcher: WatcherConfig,
    enriched: {
      titleRu: string;
      summaryRu: string;
      bodyMarkdownRu: string;
      tags: string[];
      resonanceScore: number;
      icon: string;
    },
    eventDate: string
  ): SparkNotePayload {
    const rawContent = this.formatSparkMarkdown({
      title: enriched.titleRu,
      eventDate,
      tags: enriched.tags,
      sourceUrl: item.url,
      sourceTitle: watcher.title,
      resonanceScore: enriched.resonanceScore,
      icon: enriched.icon,
      summary: enriched.summaryRu,
      body: enriched.bodyMarkdownRu,
    });

    return {
      id: noteId,
      title: enriched.titleRu,
      summary: enriched.summaryRu,
      rawContent,
      eventDate,
      type: 'SINGLE',
      privacy: 'public',
      status: 'PUBLISHED',
      feedSlug: watcher.feedSlug,
      publicFeedSlug: watcher.slug,
      sourceLink: item.url,
      sourceType: 'LEMON_WATCHERS',
      author: item.author || watcher.title,
      tags: enriched.tags,
      resonanceScore: enriched.resonanceScore,
      icon: enriched.icon,
      metadata: {
        origin: 'CODING_AGENT',
        watcherId: watcher.id,
        watcherSlug: watcher.slug,
        rawGuid: item.guid,
        originalTitle: item.title,
        enrichedBy: this.modelName,
      },
    };
  }

  private buildCanonicalFallbackPayload(
    noteId: string,
    item: RawFeedItem,
    watcher: WatcherConfig,
    eventDate: string
  ): SparkNotePayload {
    const tags = Array.from(
      new Set(
        [...(watcher.defaultTags || []), watcher.category]
          .map((t) => t.replace(/^#/, '').toLowerCase().trim())
          .filter((t) => t && t !== 'jmdaily')
      )
    );

    const summary = item.summary || item.title;
    const rawContent = this.formatSparkMarkdown({
      title: item.title,
      eventDate,
      tags,
      sourceUrl: item.url,
      sourceTitle: watcher.title,
      resonanceScore: 60,
      icon: '📰',
      summary,
      body: summary,
    });

    return {
      id: noteId,
      title: item.title,
      summary,
      rawContent,
      eventDate,
      type: 'SINGLE',
      privacy: 'public',
      status: 'PUBLISHED',
      feedSlug: watcher.feedSlug,
      publicFeedSlug: watcher.slug,
      sourceLink: item.url,
      sourceType: 'LEMON_WATCHERS',
      author: item.author || watcher.title,
      tags,
      resonanceScore: 60,
      icon: '📰',
      metadata: {
        origin: 'CODING_AGENT',
        watcherId: watcher.id,
        watcherSlug: watcher.slug,
        rawGuid: item.guid,
        fallbackMode: true,
      },
    };
  }

  private formatSparkMarkdown(params: {
    title: string;
    eventDate: string;
    tags: string[];
    sourceUrl: string;
    sourceTitle: string;
    resonanceScore: number;
    icon: string;
    summary: string;
    body: string;
  }): string {
    const yamlTags = params.tags.map((t) => `  - "${t}"`).join('\n');
    return `---
title: "${params.title.replace(/"/g, '\\"')}"
type: "SINGLE"
event_date: "${params.eventDate}"
start_date: "${params.eventDate}"
end_date: null
privacy: "public"
published: true
icon: "${params.icon}"
resonance_score: ${params.resonanceScore}
tags:
${yamlTags}
links:
  - title: "${params.sourceTitle.replace(/"/g, '\\"')}"
    url: "${params.sourceUrl}"
    is_primary: true
---


# ${params.icon} ${params.title}

> ${params.summary}


---


## 📌 Подробности события

${params.body}
`;
  }
}
