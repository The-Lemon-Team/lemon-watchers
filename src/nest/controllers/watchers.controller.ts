import crypto from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { WATCHERS_ENGINE } from '../tokens.js';
import type { WatchersEngine } from '../../orchestrator/watchers-engine.js';
import { fetchFeedItems } from '../../axons/rss-atom-fetcher.axon.js';
import { WatcherConfig, WatcherProtocol } from '../../types/watcher.types.js';

@ApiTags('Watchers')
@Controller('api/v1/watchers')
export class WatchersController {
  constructor(
    @Inject(WATCHERS_ENGINE) private readonly engine: WatchersEngine
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Legacy multiplexed SSE stream for dashboard telemetry' })
  liveSse(@Req() req: Request, @Res() res: Response) {
    this.engine.sse.addClient(req, res);
  }

  @Get()
  @ApiOperation({ summary: 'List all configured watchers' })
  getAllWatchers() {
    const watchers = this.engine.getAllWatchers();
    return { total: watchers.length, items: watchers };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new watcher' })
  async createWatcher(@Body() body: any) {
    if (!body?.title || !body?.url) {
      throw new BadRequestException('Title and URL are required');
    }

    const id = body.id || `w-${crypto.randomUUID().slice(0, 8)}`;
    const baseSlug =
      (body.slug || body.title)
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
    return { config: watcherConfig, state: watcherState };
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate an RSS/Atom/JSON feed URL' })
  async validateFeed(@Body() body: any) {
    if (!body?.url) {
      throw new BadRequestException('Feed URL is required');
    }

    const protocol = (body.protocol as WatcherProtocol) || 'rss';
    const result = await fetchFeedItems({ url: body.url, protocol });

    if (result.error || (result.statusCode && result.statusCode >= 400)) {
      throw new UnprocessableEntityException({
        valid: false,
        statusCode: result.statusCode,
        error: result.error || `HTTP ${result.statusCode}`,
      });
    }

    return {
      valid: true,
      statusCode: result.statusCode,
      itemsCount: (result.items || []).length,
      sample: (result.items || []).slice(0, 3).map((i) => ({
        title: i.title,
        url: i.url,
        pubDate: i.pubDate,
        guid: i.guid,
      })),
    };
  }

  @Post('trigger-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger manual poll for all enabled watchers' })
  async triggerAll() {
    const count = await this.engine.triggerAll();
    return { message: `Triggered ${count} watchers` };
  }

  @Post('pause-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause all watchers' })
  async pauseAll() {
    const count = await this.engine.pauseAll();
    return { message: `Paused all ${count} watchers` };
  }

  @Post('resume-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume all watchers' })
  async resumeAll() {
    const count = await this.engine.resumeAll();
    return { message: `Resumed all ${count} watchers` };
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get ping history for a watcher' })
  async getPingHistory(
    @Param('id') id: string,
    @Query('limit') limit?: string
  ) {
    const parsedLimit = parseInt(limit || '50', 10);
    const history = await this.engine.getPingHistory(
      id,
      Number.isFinite(parsedLimit) ? parsedLimit : 50
    );
    return { watcherId: id, count: history.length, items: history };
  }

  @Post(':id/trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force immediate poll for a specific watcher' })
  async triggerWatcher(@Param('id') id: string) {
    const neuron = this.engine.getWatcher(id);
    if (!neuron) {
      throw new NotFoundException(`Watcher not found: ${id}`);
    }
    const ping = await this.engine.triggerWatcher(id);
    if (!ping) {
      throw new NotFoundException(`Watcher not found: ${id}`);
    }
    return ping;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get watcher configuration and live state' })
  getWatcher(@Param('id') id: string) {
    const watcher = this.engine.getWatcher(id);
    if (!watcher) {
      throw new NotFoundException(`Watcher not found: ${id}`);
    }
    return { config: watcher.config, state: watcher.state };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update watcher configuration or enabled status' })
  async updateWatcher(@Param('id') id: string, @Body() body: any) {
    const updated = await this.engine.updateWatcher(id, body || {});
    if (!updated) {
      throw new NotFoundException(`Watcher not found: ${id}`);
    }
    return { message: 'Watcher updated successfully', watcher: updated };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a watcher and stop its neuron' })
  async deleteWatcher(@Param('id') id: string) {
    const success = await this.engine.deleteWatcher(id);
    if (!success) {
      throw new NotFoundException(`Watcher not found: ${id}`);
    }
    return { message: 'Watcher deleted successfully' };
  }
}
