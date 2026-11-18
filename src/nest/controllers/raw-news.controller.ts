import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WATCHERS_ENGINE } from '../tokens.js';
import type { WatchersEngine } from '../../orchestrator/watchers-engine.js';

@ApiTags('Raw News (Legacy Pre-Moderation)')
@Controller('api/v1/raw-news')
export class RawNewsController {
  constructor(
    @Inject(WATCHERS_ENGINE) private readonly engine: WatchersEngine
  ) {}

  @Get()
  @ApiOperation({ summary: 'List collected raw news items' })
  getRawNews(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('category') category?: string,
    @Query('watcherId') watcherId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string
  ) {
    return this.engine.getRawNews({
      limit: parseInt(limit || '20', 10),
      offset: parseInt(offset || '0', 10),
      category: category || undefined,
      watcherId: watcherId || undefined,
      status: status || undefined,
      search: search || undefined,
    });
  }

  @Post('batch-convert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch convert selected raw news into articles' })
  async batchConvert(@Body() body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const articles = await this.engine.convertBatchRawNews(ids);
    return {
      message: `Converted ${articles.length} news items into notes`,
      count: articles.length,
      articles,
    };
  }

  @Post('batch-convert-and-publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch convert and publish selected raw news to LemonBus' })
  async batchConvertAndPublish(@Body() body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const articles = await this.engine.convertAndPublishBatchRawNews(ids);
    return {
      message: `Converted and published ${articles.length} notes to LemonBus`,
      count: articles.length,
      articles,
    };
  }

  @Post('process-pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue pending raw news items for AI conversion' })
  async processPending() {
    const count = await this.engine.checkPendingRawNews();
    return { message: `Enqueued ${count} pending items for AI conversion` };
  }

  @Post(':id/convert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Convert single raw news item into an article' })
  async convertSingle(@Param('id') id: string) {
    const article = await this.engine.convertRawNews(id);
    if (!article) {
      throw new BadRequestException(`Failed to convert raw item: ${id}`);
    }
    return { message: 'Item converted successfully', article };
  }

  @Post(':id/convert-and-publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Convert and publish single raw news item to LemonBus' })
  async convertAndPublishSingle(@Param('id') id: string) {
    const res = await this.engine.promoteStreamItem(id);
    if (!res) {
      throw new BadRequestException(`Failed to convert raw item: ${id}`);
    }
    return {
      message: 'Item converted and published to LemonBus',
      article: res.article,
    };
  }
}
