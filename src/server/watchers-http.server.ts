import http, { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { WatchersEngine } from '../orchestrator/watchers-engine.js';
import { fetchFeedItems } from '../axons/rss-atom-fetcher.axon.js';
import { WatcherConfig, WatcherProtocol } from '../types/watcher.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root project directory
const projectRoot = path.resolve(__dirname, '../../');
const angularDistDir = path.resolve(projectRoot, 'frontend/dist/frontend/browser');
const publicDir = path.resolve(projectRoot, 'public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

export class WatchersHttpServer {
  private server: http.Server | null = null;

  constructor(
    private readonly port: number,
    private readonly engine: WatchersEngine
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error(`[WatchersHttpServer] Handler error:`, err);
          this.sendJson(res, 500, { error: err.message || 'Internal Server Error' });
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.port, () => {
        console.log(`🌐 [Lemon-Watchers] Server & API running at http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host || `localhost:${this.port}`;
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method || 'GET').toUpperCase();

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Health check (GET /health)
    if (pathname === '/health' && method === 'GET') {
      this.sendJson(res, 200, {
        status: 'ok',
        service: 'lemon-watchers',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // 2. Metrics (GET /api/v1/metrics)
    if (pathname === '/api/v1/metrics' && method === 'GET') {
      const metrics = await this.engine.getMetrics();
      this.sendJson(res, 200, metrics);
      return;
    }

    // Whole Story API (GET /api/v1/story)
    if (pathname === '/api/v1/story' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const includeProxy = url.searchParams.get('includeProxy') !== 'false';
      const items = this.engine.getRecentStory(limit, includeProxy);
      this.sendJson(res, 200, { total: items.length, items });
      return;
    }

    // 3. SSE Stream (GET /api/v1/watchers/live and GET /api/v1/bus/stream)
    if ((pathname === '/api/v1/watchers/live' || pathname === '/api/v1/bus/stream') && method === 'GET') {
      this.engine.sse.addClient(req, res);
      return;
    }

    // Reactive LemonBus Bridge Status (GET /api/v1/bus/status)
    if (pathname === '/api/v1/bus/status' && method === 'GET') {
      const status = await this.engine.getBusMetrics();
      this.sendJson(res, 200, status);
      return;
    }

    // 4. Folders API
    if (pathname === '/api/v1/folders' && method === 'GET') {
      const folders = await this.engine.getFolders();
      this.sendJson(res, 200, { total: folders.length, items: folders });
      return;
    }

    if (pathname === '/api/v1/folders' && method === 'POST') {
      const body = await this.readJsonBody(req);
      if (!body.title) {
        this.sendJson(res, 400, { error: 'Folder title is required' });
        return;
      }
      const folder = await this.engine.createFolder(body);
      this.sendJson(res, 201, folder);
      return;
    }

    const deleteFolderMatch = pathname.match(/^\/api\/v1\/folders\/([^/]+)$/);
    if (deleteFolderMatch && method === 'DELETE') {
      const folderId = deleteFolderMatch[1];
      const success = await this.engine.deleteFolder(folderId);
      if (!success) {
        this.sendJson(res, 404, { error: `Folder not found or is a protected system folder: ${folderId}` });
        return;
      }
      this.sendJson(res, 200, { message: 'Folder deleted successfully' });
      return;
    }

    // 5. Watchers API
    if (pathname === '/api/v1/watchers' && method === 'GET') {
      const watchers = this.engine.getAllWatchers();
      this.sendJson(res, 200, {
        total: watchers.length,
        items: watchers,
      });
      return;
    }

    if (pathname === '/api/v1/watchers' && method === 'POST') {
      const body = await this.readJsonBody(req);
      if (!body.title || !body.url) {
        this.sendJson(res, 400, { error: 'Title and URL are required' });
        return;
      }

      const id = body.id || `w-${crypto.randomUUID().slice(0, 8)}`;
      const baseSlug = (body.slug || body.title)
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, '-')
        .replace(/^-|-$/g, '') || `pub-${Date.now()}`;
      const slug = baseSlug.startsWith('pub-') ? baseSlug : `pub-${baseSlug}`;

      const watcherConfig: WatcherConfig = {
        id,
        slug,
        title: body.title,
        description: body.description || '',
        category: body.category || 'general',
        feedSlug: body.feedSlug || `spark-${body.category || 'general'}`,
        url: body.url,
        protocol: (body.protocol as WatcherProtocol) || 'rss',
        pollIntervalSeconds: parseInt(body.pollIntervalSeconds || '900', 10),
        defaultTags: Array.isArray(body.defaultTags) ? body.defaultTags : [],
        enabled: body.enabled !== false,
      };

      const watcherState = await this.engine.addWatcher(watcherConfig);
      this.sendJson(res, 201, { config: watcherConfig, state: watcherState });
      return;
    }

    // Validate a feed URL
    if (pathname === '/api/v1/watchers/validate' && method === 'POST') {
      const body = await this.readJsonBody(req);
      if (!body.url) {
        this.sendJson(res, 400, { error: 'Feed URL is required' });
        return;
      }

      const protocol = (body.protocol as WatcherProtocol) || 'rss';
      const result = await fetchFeedItems({
        url: body.url,
        protocol,
      });

      if (result.error || (result.statusCode && result.statusCode >= 400)) {
        this.sendJson(res, 422, {
          valid: false,
          statusCode: result.statusCode,
          error: result.error || `HTTP ${result.statusCode}`,
        });
        return;
      }

      this.sendJson(res, 200, {
        valid: true,
        statusCode: result.statusCode,
        itemsCount: (result.items || []).length,
        sample: (result.items || []).slice(0, 3).map((i) => ({
          title: i.title,
          url: i.url,
          pubDate: i.pubDate,
          guid: i.guid,
        })),
      });
      return;
    }

    // Trigger all watchers (POST /api/v1/watchers/trigger-all)
    if (pathname === '/api/v1/watchers/trigger-all' && method === 'POST') {
      const count = await this.engine.triggerAll();
      this.sendJson(res, 200, { message: `Triggered ${count} watchers` });
      return;
    }

    // Pause all watchers (POST /api/v1/watchers/pause-all)
    if (pathname === '/api/v1/watchers/pause-all' && method === 'POST') {
      const count = await this.engine.pauseAll();
      this.sendJson(res, 200, { message: `Paused all ${count} watchers` });
      return;
    }

    // Resume all watchers (POST /api/v1/watchers/resume-all)
    if (pathname === '/api/v1/watchers/resume-all' && method === 'POST') {
      const count = await this.engine.resumeAll();
      this.sendJson(res, 200, { message: `Resumed all ${count} watchers` });
      return;
    }

    // Single Watcher routes
    const triggerMatch = pathname.match(/^\/api\/v1\/watchers\/([^/]+)\/trigger$/);
    if (triggerMatch && method === 'POST') {
      const watcherId = triggerMatch[1];
      const neuron = this.engine.getWatcher(watcherId);
      if (!neuron) {
        this.sendJson(res, 404, { error: `Watcher not found: ${watcherId}` });
        return;
      }
      try {
        const ping = await this.engine.triggerWatcher(watcherId);
        if (!ping) {
          this.sendJson(res, 404, { error: `Watcher not found: ${watcherId}` });
          return;
        }
        this.sendJson(res, 200, ping);
      } catch (err: any) {
        this.sendJson(res, 500, { error: err?.message || 'Failed to trigger watcher' });
      }
      return;
    }

    const historyMatch = pathname.match(/^\/api\/v1\/watchers\/([^/]+)\/history$/);
    if (historyMatch && method === 'GET') {
      const watcherId = historyMatch[1];
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const history = await this.engine.getPingHistory(watcherId, limit);
      this.sendJson(res, 200, {
        watcherId,
        count: history.length,
        items: history,
      });
      return;
    }

    const singleWatcherMatch = pathname.match(/^\/api\/v1\/watchers\/([^/]+)$/);
    if (singleWatcherMatch) {
      const watcherId = singleWatcherMatch[1];

      if (method === 'GET') {
        const watcher = this.engine.getWatcher(watcherId);
        if (!watcher) {
          this.sendJson(res, 404, { error: `Watcher not found: ${watcherId}` });
          return;
        }
        this.sendJson(res, 200, {
          config: watcher.config,
          state: watcher.state,
        });
        return;
      }

      if (method === 'PATCH') {
        const body = await this.readJsonBody(req);
        const updated = await this.engine.updateWatcher(watcherId, body);
        if (!updated) {
          this.sendJson(res, 404, { error: `Watcher not found: ${watcherId}` });
          return;
        }
        this.sendJson(res, 200, { message: 'Watcher updated successfully', watcher: updated });
        return;
      }

      if (method === 'DELETE') {
        const success = await this.engine.deleteWatcher(watcherId);
        if (!success) {
          this.sendJson(res, 404, { error: `Watcher not found: ${watcherId}` });
          return;
        }
        this.sendJson(res, 200, { message: 'Watcher deleted successfully' });
        return;
      }
    }

    // 6. Articles API
    if (pathname === '/api/v1/items' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const category = url.searchParams.get('category') || undefined;
      const watcherId = url.searchParams.get('watcherId') || undefined;
      const search = url.searchParams.get('search') || undefined;

      const result = await this.engine.getRecentItems({
        limit,
        offset,
        category,
        watcherId,
        search,
      });

      this.sendJson(res, 200, result);
      return;
    }

    const itemMatch = pathname.match(/^\/api\/v1\/items\/([^/]+)$/);
    if (itemMatch && method === 'GET') {
      const itemId = itemMatch[1];
      const item = await this.engine.getItemById(itemId);
      if (!item) {
        this.sendJson(res, 404, { error: `Item not found: ${itemId}` });
        return;
      }
      this.sendJson(res, 200, item);
      return;
    }

    // Publish single article to LemonBus (POST /api/v1/items/:id/publish-bus)
    const publishBusMatch = pathname.match(/^\/api\/v1\/items\/([^/]+)\/publish-bus$/);
    if (publishBusMatch && method === 'POST') {
      const itemId = publishBusMatch[1];
      const article = await this.engine.publishArticleToBus(itemId);
      if (!article) {
        this.sendJson(res, 404, { error: `Item not found: ${itemId}` });
        return;
      }
      this.sendJson(res, 200, { message: 'Article published to LemonBus', article });
      return;
    }

    // Bulk publish pending articles to LemonBus (POST /api/v1/items/publish-bus-pending)
    if (pathname === '/api/v1/items/publish-bus-pending' && method === 'POST') {
      const result = await this.engine.publishPendingArticlesToBus();
      this.sendJson(res, 200, { message: `Published ${result.count} articles to LemonBus`, count: result.count });
      return;
    }

    // Batch publish selected articles to LemonBus (POST /api/v1/items/batch-publish-bus)
    if (pathname === '/api/v1/items/batch-publish-bus' && method === 'POST') {
      const body = await this.readJsonBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const result = await this.engine.publishBatchArticlesToBus(ids);
      this.sendJson(res, 200, { message: `Published ${result.count} articles to LemonBus`, count: result.count, articles: result.articles });
      return;
    }

    // Generate or regenerate article cover via AI + Media Hub (POST /api/v1/items/:id/generate-cover)
    const generateCoverMatch = pathname.match(/^\/api\/v1\/items\/([^/]+)\/generate-cover$/);
    if (generateCoverMatch && method === 'POST') {
      const itemId = generateCoverMatch[1];
      const body = await this.readJsonBody(req);
      try {
        const article = await this.engine.generateArticleCover(itemId, {
          prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
          style: typeof body.style === 'string' ? body.style : undefined,
          aspectRatio: typeof body.aspectRatio === 'string' ? (body.aspectRatio as any) : undefined,
        });
        if (!article) {
          this.sendJson(res, 404, { error: `Item not found: ${itemId}` });
          return;
        }
        this.sendJson(res, 200, { message: 'Cover generated via Media Hub', article });
      } catch (err: any) {
        this.sendJson(res, 502, { error: err?.message || 'Cover generation failed' });
      }
      return;
    }

    // AI content assistance for article (POST /api/v1/items/:id/ai-assist)
    const aiAssistMatch = pathname.match(/^\/api\/v1\/items\/([^/]+)\/ai-assist$/);
    if (aiAssistMatch && method === 'POST') {
      const itemId = aiAssistMatch[1];
      const body = await this.readJsonBody(req);
      try {
        const article = await this.engine.assistArticleContent(itemId, {
          action: body.action || 'rewrite',
          instruction: typeof body.instruction === 'string' ? body.instruction : undefined,
        });
        if (!article) {
          this.sendJson(res, 404, { error: `Item not found: ${itemId}` });
          return;
        }
        this.sendJson(res, 200, { message: 'Article content updated with AI assist', article });
      } catch (err: any) {
        this.sendJson(res, 502, { error: err?.message || 'AI assist failed' });
      }
      return;
    }

    // Translate selected old articles to Russian (POST /api/v1/items/translate)
    if (pathname === '/api/v1/items/translate' && method === 'POST') {
      const body = await this.readJsonBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const result = await this.engine.translateArticles(ids);
      this.sendJson(res, 200, {
        message: `Translated ${result.translated.length}, failed ${result.failed.length}`,
        ...result,
      });
      return;
    }

    // 7. Raw News API (GET /api/v1/raw-news)
    if (pathname === '/api/v1/raw-news' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const category = url.searchParams.get('category') || undefined;
      const watcherId = url.searchParams.get('watcherId') || undefined;
      const status = url.searchParams.get('status') || undefined;
      const search = url.searchParams.get('search') || undefined;

      const result = await this.engine.getRawNews({
        limit,
        offset,
        category,
        watcherId,
        status,
        search,
      });

      this.sendJson(res, 200, result);
      return;
    }

    const convertRawMatch = pathname.match(/^\/api\/v1\/raw-news\/([^/]+)\/convert$/);
    if (convertRawMatch && method === 'POST') {
      const rawId = convertRawMatch[1];
      const article = await this.engine.convertRawNews(rawId);
      if (!article) {
        this.sendJson(res, 400, { error: `Failed to convert raw item: ${rawId}` });
        return;
      }
      this.sendJson(res, 200, { message: 'Item converted successfully', article });
      return;
    }

    const convertAndPubMatch = pathname.match(/^\/api\/v1\/raw-news\/([^/]+)\/convert-and-publish$/);
    if (convertAndPubMatch && method === 'POST') {
      const rawId = convertAndPubMatch[1];
      const article = await this.engine.convertRawNews(rawId);
      if (!article) {
        this.sendJson(res, 400, { error: `Failed to convert raw item: ${rawId}` });
        return;
      }
      await this.engine.publishArticleToBus(article.id);
      const updated = await this.engine.getItemById(article.id);
      this.sendJson(res, 200, { message: 'Item converted and published to LemonBus', article: updated || article });
      return;
    }

    // Batch convert selected raw news (POST /api/v1/raw-news/batch-convert)
    if (pathname === '/api/v1/raw-news/batch-convert' && method === 'POST') {
      const body = await this.readJsonBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const articles = await this.engine.convertBatchRawNews(ids);
      this.sendJson(res, 200, { message: `Converted ${articles.length} news items into notes`, count: articles.length, articles });
      return;
    }

    // Batch convert and publish selected raw news (POST /api/v1/raw-news/batch-convert-and-publish)
    if (pathname === '/api/v1/raw-news/batch-convert-and-publish' && method === 'POST') {
      const body = await this.readJsonBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const articles = await this.engine.convertAndPublishBatchRawNews(ids);
      this.sendJson(res, 200, { message: `Converted and published ${articles.length} notes to LemonBus`, count: articles.length, articles });
      return;
    }

    if (pathname === '/api/v1/raw-news/process-pending' && method === 'POST') {
      const count = await this.engine.checkPendingRawNews();
      this.sendJson(res, 200, { message: `Enqueued ${count} pending items for AI conversion` });
      return;
    }

    // 8. Serve Static Assets or SPA UI
    if (method === 'GET') {
      const handled = await this.serveStaticOrSpa(pathname, res);
      if (handled) return;
    }

    // Fallthrough 404
    this.sendJson(res, 404, { error: `Not found: ${method} ${pathname}` });
  }

  private async serveStaticOrSpa(pathname: string, res: ServerResponse): Promise<boolean> {
    // 1. Check if Angular dist exists
    const hasAngular = fsSync.existsSync(path.join(angularDistDir, 'index.html'));
    const baseDir = hasAngular ? angularDistDir : publicDir;

    let targetFile: string;
    const ext = path.extname(pathname);

    if (ext && ext !== '.html') {
      // It's a static file request (e.g. .js, .css, .ico)
      targetFile = path.join(baseDir, pathname.replace(/^\/+/, ''));
      if (fsSync.existsSync(targetFile)) {
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        const content = await fs.readFile(targetFile);
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
        res.end(content);
        return true;
      }
      return false;
    }

    // SPA fallback: serve index.html
    const indexPath = path.join(baseDir, 'index.html');
    if (fsSync.existsSync(indexPath)) {
      const html = await fs.readFile(indexPath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(html);
      return true;
    }

    return false;
  }

  private async readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  private sendJson(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
