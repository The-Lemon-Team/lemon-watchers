import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import type { WatchersEngine } from '../orchestrator/watchers-engine.js';
import { WatchersNestModule } from './watchers-nest.module.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

export class WatchersNestServer {
  private app: INestApplication | null = null;

  constructor(
    private readonly port: number,
    private readonly engine: WatchersEngine
  ) {}

  async start(): Promise<void> {
    this.app = await NestFactory.create(WatchersNestModule.register(this.engine), {
      logger: ['error', 'warn'],
    });

    this.app.enableCors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      allowedHeaders: 'Content-Type, Authorization, Last-Event-ID',
    });

    let swaggerEnabled = false;
    try {
      const swaggerConfig = new DocumentBuilder()
        .setTitle('Lemon-Watchers Reactive News Engine')
        .setDescription('Autonomous RSS/Atom/JSON watchers, filtered SSE news streams, and pre-moderation API')
        .setVersion('1.1.0')
        .build();

      const swaggerDoc = SwaggerModule.createDocument(this.app, swaggerConfig);
      SwaggerModule.setup('api/docs', this.app, swaggerDoc);
      swaggerEnabled = true;
    } catch (err: any) {
      console.warn(
        `⚠️ [Lemon-Watchers] Swagger UI skipped in current runtime (${err?.message || err}); run compiled dist build for full OpenAPI docs.`
      );
    }

    await this.app.init();

    // Serve Angular SPA / static assets for non-API GET routes after Nest routes are mounted
    const expressApp = this.app.getHttpAdapter().getInstance();
    expressApp.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') return next();
      const pathname = req.path || '/';
      if (pathname.startsWith('/api/') || pathname === '/api' || pathname === '/health') {
        return next();
      }
      this.serveStaticOrSpa(pathname, res)
        .then((handled) => {
          if (!handled) next();
        })
        .catch(next);
    });

    await this.app.listen(this.port);
    const boundPort = this.getPort();
    console.log(`🌐 [Lemon-Watchers] NestJS Server & SSE running at http://localhost:${boundPort}`);
    if (swaggerEnabled) {
      console.log(`📘 [Lemon-Watchers] Swagger UI available at http://localhost:${boundPort}/api/docs`);
    }
  }

  async stop(): Promise<void> {
    if (!this.app) return;
    await this.app.close();
    this.app = null;
  }

  getPort(): number {
    if (!this.app) return this.port;
    const addr = this.app.getHttpServer()?.address();
    if (addr && typeof addr === 'object' && 'port' in addr) {
      return addr.port;
    }
    return this.port;
  }

  private async serveStaticOrSpa(pathname: string, res: Response): Promise<boolean> {
    const hasAngular = fsSync.existsSync(path.join(angularDistDir, 'index.html'));
    const baseDir = hasAngular ? angularDistDir : publicDir;
    const ext = path.extname(pathname);

    if (ext && ext !== '.html') {
      const targetFile = path.resolve(baseDir, pathname.replace(/^\/+/, ''));
      if (!targetFile.startsWith(baseDir)) {
        return false;
      }
      if (fsSync.existsSync(targetFile)) {
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        const content = await fs.readFile(targetFile);
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.status(200).send(content);
        return true;
      }
      return false;
    }

    const indexPath = path.join(baseDir, 'index.html');
    if (fsSync.existsSync(indexPath)) {
      const html = await fs.readFile(indexPath, 'utf-8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).send(html);
      return true;
    }

    return false;
  }
}
