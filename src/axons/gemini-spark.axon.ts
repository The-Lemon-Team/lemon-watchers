import crypto from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { AiStudioAxon } from '@lemon/ai-neurons';
import { RawFeedItem, WatcherConfig } from '../types/watcher.types.js';
import { SparkNotePayload } from '../types/note-payload.types.js';
import type { ContentOrigin } from './article-extractor.axon.js';

export type AiAssistAction = 'rewrite' | 'expand' | 'summarize' | 'custom';

export interface EnrichOptions {
  contentOrigin?: ContentOrigin;
  originalText?: string;
  sourceLangHint?: string;
}

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
    watcher: WatcherConfig,
    options?: EnrichOptions
  ): Promise<SparkNotePayload> {
    const noteId = crypto.randomUUID();
    const eventDate = item.pubDate || new Date().toISOString();
    const originalText = (options?.originalText ?? item.rawText ?? '').trim();
    const contentOrigin: ContentOrigin =
      options?.contentOrigin ??
      item.contentOrigin ??
      (originalText.length >= 1000 ? 'feed' : 'ai_generated');
    const hasOriginalText = contentOrigin !== 'ai_generated' && originalText.length > 0;

    if (this.enabled) {
      try {
        const enriched = await this.callSparkEnrichment(
          item,
          watcher,
          noteId,
          {
            contentOrigin,
            originalText: hasOriginalText ? originalText : undefined,
            sourceLangHint: options?.sourceLangHint,
          }
        );
        if (enriched) {
          return this.buildPayloadFromEnriched(
            noteId,
            item,
            watcher,
            enriched,
            eventDate,
            contentOrigin
          );
        }
      } catch (err: any) {
        console.warn(
          `[GeminiSparkAxon] AI enrichment failed for "${item.title}": ${err.message}. Using canonical fallback.`
        );
      }
    }

    return this.buildCanonicalFallbackPayload(
      noteId,
      item,
      watcher,
      eventDate,
      hasOriginalText ? originalText : undefined,
      contentOrigin,
      options?.sourceLangHint
    );
  }

  private detectLanguageHeuristic(text: string, hint?: string): string {
    if (hint && /^[a-z]{2}$/i.test(hint.trim())) {
      return hint.trim().toLowerCase();
    }
    const sample = text.slice(0, 2000);
    const cyrillic = (sample.match(/[а-яёА-ЯЁ]/g) || []).length;
    const latin = (sample.match(/[a-zA-Z]/g) || []).length;
    if (cyrillic > 15 && cyrillic >= latin * 0.25) return 'ru';
    if (latin > 15) return 'en';
    return 'unknown';
  }

  private async requestText(params: {
    prompt: string;
    temperature: number;
    correlationId?: string;
    responseMimeType?: 'application/json' | 'text/plain';
  }): Promise<{ text: string; engine: string }> {
    // 1. Primary path: @lemon/ai-neurons (lemon-ai-service gateway)
    if (this.aiStudio) {
      try {
        const res = await this.aiStudio.generateText({
          prompt: params.prompt,
          temperature: params.temperature,
          correlationId: params.correlationId,
        });
        return { text: res.text, engine: 'lemon-ai-service' };
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
    const generationConfig: Record<string, any> = {
      temperature: params.temperature,
    };
    if (params.responseMimeType === 'application/json') {
      generationConfig.responseMimeType = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: params.prompt }] }],
        generationConfig,
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

    return { text: candidateText, engine: this.modelName };
  }

  private async requestStructuredJson<T = Record<string, any>>(params: {
    prompt: string;
    temperature: number;
    correlationId?: string;
  }): Promise<{ parsed: T; engine: string }> {
    const { text, engine } = await this.requestText({
      ...params,
      responseMimeType: 'application/json',
    });
    return {
      parsed: this.parseJsonObject<T>(text),
      engine,
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
    correlationId: string,
    opts: {
      contentOrigin: ContentOrigin;
      originalText?: string;
      sourceLangHint?: string;
    }
  ): Promise<{
    title: string;
    summary: string;
    bodyMarkdown: string;
    tags: string[];
    resonanceScore: number;
    icon: string;
    sourceLanguage: string;
    coverPrompt?: string;
    enrichedBy: string;
  } | null> {
    const hasOriginal = opts.contentOrigin !== 'ai_generated' && Boolean(opts.originalText);
    const sourceTextForPrompt = hasOriginal
      ? opts.originalText!.slice(0, 6000)
      : item.summary || item.rawText || item.title;

    const prompt = hasOriginal
      ? `Ты — технический редактор Lemon Seasons (Spark).
У нас уже есть ПОЛНЫЙ ОРИГИНАЛЬНЫЙ ТЕКСТ статьи. НЕ переписывай и НЕ переводи её: твоя задача — только подготовить метаданные и краткую выжимку на ЯЗЫКЕ ОРИГИНАЛА статьи.

ИСХОДНАЯ СТАТЬЯ:
- Заголовок: ${item.title}
- Первоисточник: ${item.url}
- Ресурс: ${watcher.title} (категория: ${watcher.category})
- Дата события: ${item.pubDate}
- Автор: ${item.author || 'Не указан'}
- Фрагмент/Текст:
${sourceTextForPrompt}

ПРАВИЛА:
1. Определи язык оригинала (sourceLanguage, код ISO 639-1: en, ru, ...).
2. Выжимка (summary): 2-3 плотных предложения с ключевыми фактами НА ЯЗЫКЕ ОРИГИНАЛА (если оригинал на английском — пиши summary на английском; если на русском — на русском).
3. Теги (tags): 3-6 тематических тегов (без символа '#'). СТРОГО ЗАПРЕЩЕНО добавлять тег 'jmdaily'.
4. Резонанс (resonanceScore): целое число от 0 до 100, важность для индустрии.
5. Иконка (icon): подходящий единичный эмодзи (например 🤖, 🛡️, ⚡, 🚀, 📈).
6. Промпт обложки (coverPrompt): короткое описание на английском языке для редакционной иллюстрации-обложки (без текста, букв и логотипов).

ВЕРНИ ОТВЕТ СТРОГО В ФОРМАТЕ JSON без разметки markdown:
{
  "summary": "...",
  "tags": ["...", "..."],
  "resonanceScore": 75,
  "icon": "🤖",
  "sourceLanguage": "en",
  "coverPrompt": "..."
}`
      : `Ты — ведущий технический редактор и аналитик новостей Lemon Seasons (проект Spark).
Оригинальный полный текст статьи недоступен (есть только короткий анонс/тизер), поэтому нужно сформировать структурированную заметку на основе имеющихся фактов.

СЫРАЯ НОВОСТЬ:
- Заголовок: ${item.title}
- Первоисточник: ${item.url}
- Ресурс: ${watcher.title} (категория: ${watcher.category})
- Дата события: ${item.pubDate}
- Автор: ${item.author || 'Не указан'}
- Текст/Аннотация:
${sourceTextForPrompt}

ПРАВИЛА SPARK:
0. Определи язык первоисточника (sourceLanguage, код ISO 639-1: en, ru, ...).
   СОХРАНЯЙ ЯЗЫК ПЕРВОИСТОЧНИКА для полей title, summary и bodyMarkdown: если источник на английском (или другом иностранном языке) — пиши title, summary и bodyMarkdown на английском; если источник на русском — на русском. Ничего не выдумывай сверх источника.
1. Заголовок (title): четкий, емкий (без кликбейта, отражает суть, на языке источника).
2. Выжимка (summary): 2-3 плотных предложения с ключевыми фактами (на языке источника).
3. Тело статьи (bodyMarkdown): 2-4 абзаца с разбором доступных фактов и контекста (на языке источника).
4. Теги (tags): 3-6 тематических тегов (без символа '#').
   СТРОГО ЗАПРЕЩЕНО добавлять тег 'jmdaily' (зарезервирован для ручной курации).
5. Резонанс (resonanceScore): целое число от 0 до 100, отражающее важность инфоповода для индустрии.
6. Иконка (icon): подходящий единичный эмодзи (например 🤖, 🛡️, ⚡, 🚀, 📈).
7. Промпт обложки (coverPrompt): короткое описание на английском языке для генерации редакционной иллюстрации-обложки (без текста, букв и логотипов).

ВЕРНИ ОТВЕТ СТРОГО В ФОРМАТЕ JSON без разметки markdown:
{
  "title": "...",
  "summary": "...",
  "bodyMarkdown": "...",
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

    const detectedLang = String(
      parsed.sourceLanguage ||
        this.detectLanguageHeuristic(`${item.title} ${sourceTextForPrompt}`, opts.sourceLangHint)
    )
      .toLowerCase()
      .slice(0, 8);

    const parsedSummary = parsed.summary || parsed.summaryRu || item.summary || '';

    if (hasOriginal) {
      return {
        title: item.title,
        summary: parsedSummary || opts.originalText!.slice(0, 400),
        bodyMarkdown: opts.originalText!,
        tags: combinedTags,
        resonanceScore: Math.min(100, Math.max(0, parseInt(parsed.resonanceScore, 10) || 60)),
        icon: parsed.icon || '📰',
        sourceLanguage: detectedLang,
        coverPrompt: typeof parsed.coverPrompt === 'string' ? parsed.coverPrompt.trim() : undefined,
        enrichedBy: engine,
      };
    }

    return {
      title: parsed.title || parsed.titleRu || item.title,
      summary: parsedSummary || item.title,
      bodyMarkdown: parsed.bodyMarkdown || parsed.bodyMarkdownRu || parsedSummary || item.title,
      tags: combinedTags,
      resonanceScore: Math.min(100, Math.max(0, parseInt(parsed.resonanceScore, 10) || 60)),
      icon: parsed.icon || '📰',
      sourceLanguage: detectedLang,
      coverPrompt: typeof parsed.coverPrompt === 'string' ? parsed.coverPrompt.trim() : undefined,
      enrichedBy: engine,
    };
  }

  private buildPayloadFromEnriched(
    noteId: string,
    item: RawFeedItem,
    watcher: WatcherConfig,
    enriched: {
      title: string;
      summary: string;
      bodyMarkdown: string;
      tags: string[];
      resonanceScore: number;
      icon: string;
      sourceLanguage: string;
      coverPrompt?: string;
      enrichedBy: string;
    },
    eventDate: string,
    contentOrigin: ContentOrigin
  ): SparkNotePayload {
    const rawContent = this.formatSparkMarkdown({
      title: enriched.title,
      eventDate,
      tags: enriched.tags,
      sourceUrl: item.url,
      sourceTitle: watcher.title,
      resonanceScore: enriched.resonanceScore,
      icon: enriched.icon,
      summary: enriched.summary,
      body: enriched.bodyMarkdown,
    });

    return {
      id: noteId,
      title: enriched.title,
      summary: enriched.summary,
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
        translationStatus: enriched.sourceLanguage === 'ru' ? 'original-ru' : 'original',
        contentOrigin,
        enrichedBy: enriched.enrichedBy,
        coverPrompt: enriched.coverPrompt,
      },
    };
  }

  private buildCanonicalFallbackPayload(
    noteId: string,
    item: RawFeedItem,
    watcher: WatcherConfig,
    eventDate: string,
    originalText?: string,
    contentOrigin: ContentOrigin = 'ai_generated',
    sourceLangHint?: string
  ): SparkNotePayload {
    const tags = Array.from(
      new Set(
        [...(watcher.defaultTags || []), watcher.category]
          .map((t) => t.replace(/^#/, '').toLowerCase().trim())
          .filter((t) => t && t !== 'jmdaily')
      )
    );

    const summary = item.summary || (originalText ? originalText.slice(0, 500) : item.title);
    const body = originalText || summary;
    const sourceLanguage = this.detectLanguageHeuristic(`${item.title} ${body}`, sourceLangHint);
    const rawContent = this.formatSparkMarkdown({
      title: item.title,
      eventDate,
      tags,
      sourceUrl: item.url,
      sourceTitle: watcher.title,
      resonanceScore: 60,
      icon: '📰',
      summary,
      body,
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
        sourceLanguage,
        translationStatus: sourceLanguage === 'ru' ? 'original-ru' : 'fallback',
        contentOrigin,
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

  /** Переводит статью на русский язык (поддерживает длинные оригинальные тексты без обрезки). */
  async translateToRussian(input: {
    title: string;
    summary: string;
    content: string;
  }): Promise<{ titleRu: string; summaryRu: string; contentRu: string; sourceLanguage: string }> {
    if (!this.enabled) throw new Error('AI enrichment disabled');

    const metaPrompt = `Переведи заголовок и краткую выжимку новости на русский язык. Имена собственные, бренды и технические термины оставь в оригинале. Если текст уже на русском, верни без изменений.
Определи язык оригинала (sourceLanguage, ISO 639-1: en, ru, ...).

ЗАГОЛОВОК: ${input.title}
ВЫЖИМКА: ${input.summary}
ФРАГМЕНТ: ${input.content.slice(0, 600)}

ВЕРНИ СТРОГО JSON: {"titleRu":"...","summaryRu":"...","sourceLanguage":"en"}`;

    const { parsed: meta } = await this.requestStructuredJson<any>({
      prompt: metaPrompt,
      temperature: 0.1,
    });

    const sourceLanguage = String(meta.sourceLanguage || 'unknown').toLowerCase().slice(0, 8);
    if (sourceLanguage === 'ru') {
      return {
        titleRu: input.title,
        summaryRu: input.summary,
        contentRu: input.content,
        sourceLanguage: 'ru',
      };
    }

    const titleRu = String(meta.titleRu || input.title).trim();
    const summaryRu = String(meta.summaryRu || input.summary).trim();

    if (!input.content.trim()) {
      return { titleRu, summaryRu, contentRu: '', sourceLanguage };
    }

    const fmMatch = input.content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/);
    let frontMatter = fmMatch ? fmMatch[1] : '';
    const body = fmMatch ? fmMatch[2] : input.content;

    if (frontMatter) {
      frontMatter = frontMatter.replace(
        /^title:\s*".*?"$/m,
        `title: "${titleRu.replace(/"/g, '\\"')}"`
      );
    }

    const chunks = this.splitMarkdownChunks(body, 6000);
    const translatedChunks: string[] = [];

    for (const chunk of chunks) {
      if (!chunk.trim()) {
        translatedChunks.push(chunk);
        continue;
      }
      const chunkPrompt = `Переведи фрагмент статьи на русский язык, строго сохранив Markdown-разметку, заголовки, списки, блоки кода, цитаты и ссылки.
Имена собственные, бренды и технические термины оставляй в оригинале. Не сокращай текст, не добавляй пояснений от себя — верни ТОЛЬКО переведённый Markdown:

${chunk}`;

      const { text } = await this.requestText({
        prompt: chunkPrompt,
        temperature: 0.1,
        responseMimeType: 'text/plain',
      });
      translatedChunks.push(text.trim());
    }

    const bodyRu = translatedChunks.join('\n\n').trim();
    const contentRu = frontMatter ? `${frontMatter}\n${bodyRu}\n` : bodyRu;

    return {
      titleRu,
      summaryRu,
      contentRu: contentRu || input.content,
      sourceLanguage,
    };
  }

  private splitMarkdownChunks(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];
    const paragraphs = text.split(/\n{2,}/);
    const chunks: string[] = [];
    let current = '';

    for (const p of paragraphs) {
      if (current && current.length + p.length + 2 > maxChars) {
        chunks.push(current);
        current = p;
      } else {
        current = current ? `${current}\n\n${p}` : p;
      }
    }
    if (current) chunks.push(current);
    return chunks;
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
