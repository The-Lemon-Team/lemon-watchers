function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&laquo;|&#171;/gi, '«')
    .replace(/&raquo;|&#187;/gi, '»')
    .replace(/&hellip;|&#8230;/gi, '…')
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _;
    });
}

/**
 * Lightweight text extraction and cleaner to strip HTML tags,
 * unescape HTML entities, and prepare compact text for the LLM.
 */
export function cleanHtmlContent(rawHtml?: string): string {
  if (!rawHtml) return '';

  const stripped = rawHtml
    // Remove script, style and noscript blocks
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    // Remove CDATA
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    // Replace breaks and block endings with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, '\n\n')
    // Remove all remaining HTML tags
    .replace(/<[^>]+>/g, ' ');

  return decodeHtmlEntities(stripped)
    // Collapse excess whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Converts article HTML (e.g. from RSS content:encoded or Readability) into
 * clean Markdown-friendly text while preserving headings, lists, quotes, and code blocks.
 */
export function htmlToArticleMarkdown(rawHtml?: string): string {
  if (!rawHtml) return '';

  const codeBlocks: string[] = [];
  let text = rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    // Preserve <pre> blocks before stripping inline whitespace
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
      const code = decodeHtmlEntities(inner.replace(/<[^>]+>/g, '')).trim();
      if (!code) return '\n\n';
      const idx = codeBlocks.length;
      codeBlocks.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
      return `__CODE_BLOCK_${idx}__`;
    })
    // Headings
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n\n# ${cleanHtmlContent(t)}\n\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n\n## ${cleanHtmlContent(t)}\n\n`)
    .replace(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi, (_, t) => `\n\n### ${cleanHtmlContent(t)}\n\n`)
    // Blockquotes
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => {
      const q = cleanHtmlContent(t)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return `\n\n${q}\n\n`;
    })
    // List items
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => {
      const item = cleanHtmlContent(t).replace(/\n+/g, ' ').trim();
      return item ? `\n- ${item}` : '';
    })
    .replace(/<\/(?:ul|ol)>/gi, '\n\n')
    // Line breaks and paragraphs
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|figcaption|tr)>/gi, '\n\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  for (let i = 0; i < codeBlocks.length; i++) {
    text = text.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}
