import crypto from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { AiStudioAxon } from '@lemon/ai-neurons';
import { RawFeedItem, WatcherConfig } from '../types/watcher.types.js';
import { SparkNotePayload } from '../types/note-payload.types.js';

export type AiAssistAction = 'rewrite' | 'expand' | 'summarize' | 'custom';

export interface GeminiSparkAxonOptions {
  apiKey: string;
  modelName?: string;
  proxyUrl?: string;
  enabled?: boolean;
  aiStudio?: AiStudioAxon;
}

export class GeminiSparkAxon {
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly proxyAgent?: any;
  private readonly enabled: boolean;
  private readonly aiStudio?: AiStudioAxon;

  constructor(options: GeminiSparkAxonOptions) {
    this.apiKey = options.apiKey;
    this.modelName = options.modelName || 'gemini-2.5-flash';
    this.aiStudio = options.aiStudio;
    this.enabled = options.enabled !== false && (Boolean(this.aiStudio) || Boolean(this.apiKey));

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
        const enriched = await this.callSparkEnrichment(item, watcher, noteId);
        if (enriched) {
          return this.buildPayloadFromEnriched(noteId, item, watcher, enriched, eventDate);
        }
      } catch (err: any) {
        console.warn(
          `[GeminiSparkAxon] AI enrichment failed for "${item.title}": ${err.message}. Using canonical fallback.`
        );
      }
    }

    return this.buildCanonicalFallbackPayload(noteId, item, watcher, eventDate);
  }

  private async requestStructuredJson<T = Record<string, any>>(params: {
    prompt: string;
    temperature: number;
    correlationId?: string;
  }): Promise<{ parsed: T; engine: string }> {
    // 1. Primary path: @lemon/ai-neurons (lemon-ai-service gateway)
    if (this.aiStudio) {
      try {
        const res = await this.aiStudio.generateText({
          prompt: params.prompt,
          temperature: params.temperature,
          correlationId: params.correlationId,
        });
        const parsed = this.parseJsonObject<T>(res.text);
        return { parsed, engine: 'lemon-ai-service' };
      } catch (err: any) {
        if (!this.apiKey) {
          throw err;
        }
        console.warn(
          `[GeminiSparkAxon] lemon-ai-service fallback to direct Gemini: ${err?.message || err}`
        );
      }
    }

    // 2. Direct Gemini REST fallback (when GEMINI_API_KEY is configured)
    if (!this.apiKey) {
      throw new Error('No AI provider configured (lemon-ai-service unavailable and GEMINI_API_KEY empty)');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: params.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: params.temperature,
        },
      }),
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
    if (!candidateText) {
      throw new Error('Empty Gemini response');
    }

    return {
      parsed: this.parseJsonObject<T>(candidateText),
      engine: this.modelName,
    };
  }

  private parseJsonObject<T>(rawText: string): T {
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return JSON.parse(cleaned) as T;
  }

  private async callSparkEnrichment(
    item: RawFeedItem,
    watcher: WatcherConfig,
    correlationId: string
  ): Promise<{
    titleRu: string;
    summaryRu: string;
    bodyMarkdownRu: string;
    tags: string[];
    resonanceScore: number;
    icon: string;
    sourceLanguage: string;
    coverPrompt?: string;
    enrichedBy: string;
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
0. ВСЕ текстовые поля ниже ОБЯЗАТЕЛЬНО на русском языке, даже если источник на английском или другом языке (переводи).
   Имена собственные, бренды, названия продуктов и технические термины оставляй в оригинале. Ничего не выдумывай сверх источника.
   Определи язык оригинала (sourceLanguage, код ISO 639-1: en, ru, ...).
1. Заголовок (titleRu): четкий, емкий, на русском языке (без кликбейта, отражает суть).
2. Выжимка (summaryRu): 2-3 плотных предложения с ключевыми фактами и цифрами.
3. Тело статьи (bodyMarkdownRu): 2-4 абзаца с аналитическим контекстом на русском языке.
4. Теги (tags): 3-6 тематических тегов на русском или латинице (без символа '#').
   СТРОГО ЗАПРЕЩЕНО добавлять тег 'jmdaily' (зарезервирован для ручной курации).
5. Резонанс (resonanceScore): целое число от 0 до 100, отражающее важность инфоповода для индустрии.
6. Иконка (icon): подходящий единичный эмодзи (например 🤖, 🛡️, ⚡, 🚀, 📈).
7. Промпт обложки (coverPrompt): короткое описание на английском языке для генерации редакционной иллюстрации-обложки (без текста, букв и логотипов).

ВЕРНИ ОТВЕТ СТРОГО В ФОРМАТЕ JSON без разметки markdown:
{
  "titleRu": "...",
  "summaryRu": "...",
  "bodyMarkdownRu": "...",
  "tags": ["...", "..."],
  "resonanceScore": 75,
  "icon": "🤖",
  "sourceLanguage": "en",
  "coverPrompt": "..."
}`;

    const { parsed, engine } = await this.requestStructuredJson<any>({
      prompt,
      temperature: 0.2,
      correlationId,
    });

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
      sourceLanguage: String(parsed.sourceLanguage || 'unknown').toLowerCase().slice(0, 8),
      coverPrompt: typeof parsed.coverPrompt === 'string' ? parsed.coverPrompt.trim() : undefined,
      enrichedBy: engine,
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
      sourceLanguage: string;
      coverPrompt?: string;
      enrichedBy: string;
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
        originalSummary: item.summary || '',
        sourceLanguage: enriched.sourceLanguage,
        translationStatus: enriched.sourceLanguage === 'ru' ? 'original-ru' : 'ok',
        enrichedBy: enriched.enrichedBy,
        coverPrompt: enriched.coverPrompt,
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
        originalTitle: item.title,
        originalSummary: item.summary || '',
        sourceLanguage: 'unknown',
        translationStatus: 'fallback',
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

  /** Переводит уже сохранённую статью на русский (для бэкфилла старых записей). */
  async translateToRussian(input: {
    title: string;
    summary: string;
    content: string;
  }): Promise<{ titleRu: string; summaryRu: string; contentRu: string; sourceLanguage: string }> {
    if (!this.enabled) throw new Error('AI enrichment disabled');
    const prompt = `Переведи заметку на русский язык, сохранив Markdown-разметку, YAML front matter (ключи не переводи, переводи только значения title) и ссылки.
Имена собственные, бренды и технические термины оставь в оригинале. Если текст уже на русском, верни его без изменений.
Определи язык оригинала (sourceLanguage, ISO 639-1).

ЗАГОЛОВОК: ${input.title}
ВЫЖИМКА: ${input.summary}
ТЕКСТ:
${input.content}

ВЕРНИ СТРОГО JSON: {"titleRu":"...","summaryRu":"...","contentRu":"...","sourceLanguage":"en"}`;

    const { parsed } = await this.requestStructuredJson<any>({
      prompt,
      temperature: 0.1,
    });
    if (!parsed.titleRu || !parsed.contentRu) throw new Error('Incomplete translation');
    return {
      titleRu: parsed.titleRu,
      summaryRu: parsed.summaryRu || input.summary,
      contentRu: parsed.contentRu,
      sourceLanguage: String(parsed.sourceLanguage || 'unknown').toLowerCase().slice(0, 8),
    };
  }

  /**
   * Помощь AI в генерации/переработке контента новости по запросу редактора.
   */
  async assistArticleContent(input: {
    id: string;
    title: string;
    summary: string;
    content: string;
    url: string;
    sourceTitle: string;
    eventDate: string;
    resonanceScore: number;
    tags: string[];
    action: AiAssistAction;
    instruction?: string;
  }): Promise<{
    title: string;
    summary: string;
    content: string;
    tags: string[];
    coverPrompt?: string;
    engine: string;
  }> {
    if (!this.enabled) {
      throw new Error('AI service is disabled');
    }

    const actionHint: Record<AiAssistAction, string> = {
      rewrite: 'Перепиши заголовок, выжимку и основной текст яснее, плотнее и в редакционном стиле Spark, без воды.',
      expand: 'Расширь аналитическую часть и добавь структурированный разбор последствий и контекста, не выдумывая фактов сверх текста.',
      summarize: 'Сделай максимально лаконичную, телеграфную выжимку и короткие тезисные пункты.',
      custom: input.instruction?.trim() || 'Улучши текст и структуру новости.',
    };

    const prompt = `Ты — старший редактор новостей Lemon Seasons (Spark).
Выполни редакторскую задачу над заметкой: ${actionHint[input.action]}
${input.action !== 'custom' && input.instruction ? `Дополнительное указание редактора: ${input.instruction}` : ''}

ИСХОДНАЯ СТАТЬЯ:
- Заголовок: ${input.title}
- Выжимка: ${input.summary}
- Текущие теги: ${input.tags.join(', ')}
- Текст:
${input.content}

ТРЕБОВАНИЯ:
- Отвечай строго на русском языке (технические термины и бренды оставляй в оригинале).
- Без '#' в тегах и без тега 'jmdaily'.
- Сформируй короткий coverPrompt на английском для обложки (без текста на картинке).

ВЕРНИ СТРОГО JSON без markdown-обертки:
{
  "titleRu": "...",
  "summaryRu": "...",
  "bodyMarkdownRu": "...",
  "tags": ["...", "..."],
  "coverPrompt": "..."
}`;

    const { parsed, engine } = await this.requestStructuredJson<any>({
      prompt,
      temperature: 0.3,
      correlationId: input.id,
    });

    const title = (parsed.titleRu || input.title).trim();
    const summary = (parsed.summaryRu || input.summary).trim();
    const body = (parsed.bodyMarkdownRu || input.content).trim();
    const rawTagList: unknown[] = Array.isArray(parsed.tags) ? parsed.tags : input.tags;
    const cleanTags: string[] = rawTagList
      .map((t: unknown) => String(t).replace(/^#/, '').trim().toLowerCase())
      .filter((t: string) => Boolean(t) && t !== 'jmdaily');

    const tags: string[] =
      cleanTags.length > 0 ? Array.from(new Set(cleanTags)) : input.tags;

    const content = this.formatSparkMarkdown({
      title,
      eventDate: input.eventDate,
      tags,
      sourceUrl: input.url,
      sourceTitle: input.sourceTitle,
      resonanceScore: input.resonanceScore,
      icon: '📰',
      summary,
      body,
    });

    return {
      title,
      summary,
      content,
      tags,
      coverPrompt: typeof parsed.coverPrompt === 'string' ? parsed.coverPrompt.trim() : undefined,
      engine,
    };
  }
}
