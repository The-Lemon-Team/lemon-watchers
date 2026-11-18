import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { WATCHERS_ENGINE } from '../tokens.js';
import type { WatchersEngine } from '../../orchestrator/watchers-engine.js';

@ApiTags('Articles & Items')
@Controller('api/v1/items')
export class ItemsController {
  constructor(
    @Inject(WATCHERS_ENGINE) private readonly engine: WatchersEngine
  ) {}

  @Get()
  @ApiOperation({ summary: 'List converted/enriched watcher articles' })
  getItems(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('category') category?: string,
    @Query('watcherId') watcherId?: string,
    @Query('search') search?: string
  ) {
    return this.engine.getRecentItems({
      limit: parseInt(limit || '20', 10),
      offset: parseInt(offset || '0', 10),
      category: category || undefined,
      watcherId: watcherId || undefined,
      search: search || undefined,
    });
  }

  @Post('publish-bus-pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish all pending articles to LemonBus' })
  async publishBusPending() {
    const result = await this.engine.publishPendingArticlesToBus();
    return {
      message: `Published ${result.count} articles to LemonBus`,
      count: result.count,
    };
  }

  @Post('batch-publish-bus')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch publish selected articles to LemonBus' })
  async batchPublishBus(@Body() body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const result = await this.engine.publishBatchArticlesToBus(ids);
    return {
      message: `Published ${result.count} articles to LemonBus`,
      count: result.count,
      articles: result.articles,
    };
  }

  @Post('translate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Translate selected articles to Russian' })
  async translateArticles(@Body() body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const result = await this.engine.translateArticles(ids);
    return {
      message: `Translated ${result.translated.length}, failed ${result.failed.length}`,
      ...result,
    };
  }

  @Get(':id/cover')
  @ApiOperation({ summary: 'Serve article cover image from Media Hub or fallback' })
  async getCover(
    @Param('id') id: string,
    @Query('variant') variant: string | undefined,
    @Res() res: Response
  ) {
    try {
      const loaded = await this.engine.loadArticleCover(id, variant || undefined);
      if (!loaded) {
        res.status(404).json({ error: `Cover not found for item: ${id}` });
        return;
      }
      res.setHeader('Content-Type', loaded.contentType);
      res.setHeader('Content-Length', String(loaded.buffer.byteLength));
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).send(loaded.buffer);
    } catch (err: any) {
      throw new BadGatewayException(err?.message || 'Failed to load cover');
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get article details by ID' })
  async getItem(@Param('id') id: string) {
    const item = await this.engine.getItemById(id);
    if (!item) {
      throw new NotFoundException(`Item not found: ${id}`);
    }
    return item;
  }

  @Post(':id/publish-bus')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish single article to LemonBus' })
  async publishBus(@Param('id') id: string) {
    const article = await this.engine.publishArticleToBus(id);
    if (!article) {
      throw new NotFoundException(`Item not found: ${id}`);
    }
    return { message: 'Article published to LemonBus', article };
  }

  @Post(':id/generate-cover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate or regenerate article cover via AI + Media Hub' })
  async generateCover(@Param('id') id: string, @Body() body: any) {
    try {
      const article = await this.engine.generateArticleCover(id, {
        prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
        style: typeof body?.style === 'string' ? body.style : undefined,
        aspectRatio:
          typeof body?.aspectRatio === 'string' ? (body.aspectRatio as any) : undefined,
      });
      if (!article) {
        throw new NotFoundException(`Item not found: ${id}`);
      }
      return { message: 'Cover generated via Media Hub', article };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      throw new BadGatewayException(err?.message || 'Cover generation failed');
    }
  }

  @Post(':id/fetch-original-cover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fetch and store original cover from news source via Media Hub' })
  async fetchOriginalCover(@Param('id') id: string, @Body() body: any) {
    try {
      const article = await this.engine.fetchOriginalArticleCover(
        id,
        typeof body?.imageUrl === 'string' ? body.imageUrl : undefined
      );
      if (!article) {
        throw new NotFoundException(`Item not found: ${id}`);
      }
      return { message: 'Original cover saved via Media Hub', article };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      throw new BadGatewayException(err?.message || 'Original cover fetch failed');
    }
  }

  @Post(':id/ai-assist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run AI content assistance on an article' })
  async aiAssist(@Param('id') id: string, @Body() body: any) {
    try {
      const article = await this.engine.assistArticleContent(id, {
        action: body?.action || 'rewrite',
        instruction: typeof body?.instruction === 'string' ? body.instruction : undefined,
      });
      if (!article) {
        throw new NotFoundException(`Item not found: ${id}`);
      }
      return { message: 'Article content updated with AI assist', article };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      throw new BadGatewayException(err?.message || 'AI assist failed');
    }
  }
}
