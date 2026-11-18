import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Observable, concat, filter, from, map, merge, timer } from 'rxjs';
import { WATCHERS_ENGINE } from '../tokens.js';
import type { WatchersEngine } from '../../orchestrator/watchers-engine.js';
import { StreamLiveEvent, StreamNewsStatus } from '../../types/stream-news.types.js';

function parseCsvList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

@ApiTags('News Streams (Reactive SSE & Pre-Moderation)')
@Controller('api/v1/streams')
export class StreamsController {
  constructor(
    @Inject(WATCHERS_ENGINE) private readonly engine: WatchersEngine
  ) {}

  @Sse('live')
  @ApiOperation({
    summary:
      'Filtered reactive SSE stream of lightweight watcher news events with catch-up replay',
  })
  @ApiQuery({ name: 'categories', required: false, description: 'Comma-separated folder/category slugs' })
  @ApiQuery({ name: 'watchers', required: false, description: 'Comma-separated watcher IDs or slugs' })
  @ApiQuery({
    name: 'types',
    required: false,
    description: 'Comma-separated event types (news_item,news_promoted,news_dismissed,watcher_ping)',
  })
  @ApiQuery({ name: 'replay', required: false, description: 'Number of buffered events to replay on connect (default: 25)' })
  @ApiQuery({ name: 'since', required: false, description: 'Last processed event ID for replay' })
  liveStream(
    @Query('categories') categoriesParam?: string,
    @Query('watchers') watchersParam?: string,
    @Query('types') typesParam?: string,
    @Query('replay') replayParam?: string,
    @Query('since') since?: string,
    @Headers('last-event-id') lastEventId?: string
  ): Observable<MessageEvent> {
    const categories = parseCsvList(categoriesParam);
    const watchers = parseCsvList(watchersParam);
    const types = parseCsvList(typesParam) ?? [
      'news_item',
      'news_promoted',
      'news_dismissed',
    ];
    const parsedReplay = replayParam !== undefined ? parseInt(replayParam, 10) : 25;
    const replayLimit = Number.isFinite(parsedReplay) ? parsedReplay : 25;

    const filterSets = {
      categories: categories ? new Set(categories) : undefined,
      watchers: watchers ? new Set(watchers) : undefined,
      types: types ? new Set(types) : undefined,
    };

    const replayEvents = this.engine.getStreamReplay({
      categories,
      watchers,
      types,
      limit: replayLimit,
      sinceId: lastEventId || since,
    });

    const toMessageEvent = (ev: StreamLiveEvent): MessageEvent => ({
      id: ev.id,
      type: ev.type,
      data: ev,
    });

    const replay$ = from(replayEvents).pipe(map(toMessageEvent));

    const live$ = this.engine.streamEvents$.pipe(
      filter((ev) => this.engine.matchesStreamFilter(ev, filterSets)),
      map(toMessageEvent)
    );

    const heartbeat$ = timer(0, 20000).pipe(
      map(
        (): MessageEvent => ({
          type: 'heartbeat',
          data: { timestamp: new Date().toISOString() },
        })
      )
    );

    return merge(concat(replay$, live$), heartbeat$);
  }

  @Get('items')
  @ApiOperation({ summary: 'Get lightweight paginated stream news for pre-moderation' })
  @ApiQuery({ name: 'categories', required: false })
  @ApiQuery({ name: 'watchers', required: false })
  @ApiQuery({ name: 'status', required: false, description: 'NEW | DISMISSED | PROMOTED | FAILED | ALL (default NEW)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  getStreamItems(
    @Query('categories') categoriesParam?: string,
    @Query('watchers') watchersParam?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const normalizedStatus = (status || 'NEW').toUpperCase() as StreamNewsStatus | 'ALL';
    return this.engine.getStreamItems({
      categories: parseCsvList(categoriesParam),
      watchers: parseCsvList(watchersParam),
      status: normalizedStatus,
      search: search || undefined,
      limit: parseInt(limit || '25', 10),
      offset: parseInt(offset || '0', 10),
    });
  }

  @Post('items/batch-promote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch promote selected stream items to Note / LemonBus' })
  async batchPromote(@Body() body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const result = await this.engine.promoteBatchStreamItems(ids);
    return {
      message: `Promoted ${result.count} stream items to LemonBus`,
      count: result.count,
      articles: result.articles,
    };
  }

  @Post('items/batch-dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch dismiss stream items from pre-moderation queue' })
  async batchDismiss(@Body() body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const result = await this.engine.dismissStreamItems(ids);
    return {
      message: `Dismissed ${result.count} stream items`,
      ...result,
    };
  }

  @Post('items/:id/promote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Promote single stream item into enriched Note on LemonBus' })
  async promoteSingle(@Param('id') id: string) {
    const res = await this.engine.promoteStreamItem(id);
    if (!res) {
      throw new BadRequestException(`Failed to promote stream item: ${id}`);
    }
    return {
      message: 'Stream item promoted to LemonBus',
      article: res.article,
      item: res.item,
    };
  }

  @Post('items/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss single stream item and free raw content storage' })
  async dismissSingle(@Param('id') id: string) {
    const res = await this.engine.dismissStreamItems([id]);
    if (res.count === 0) {
      throw new NotFoundException(`Stream item not found: ${id}`);
    }
    return {
      message: 'Stream item dismissed',
      item: res.items[0],
    };
  }

  @Post('prune')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Prune expired raw news items while preserving dedup hashes' })
  pruneExpired(@Body() body: any) {
    const ttlHours =
      typeof body?.ttlHours === 'number' && body.ttlHours > 0
        ? body.ttlHours
        : undefined;
    return this.engine.pruneExpiredRawNews(ttlHours);
  }
}
