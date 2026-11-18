import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { WATCHERS_ENGINE } from '../tokens.js';
import type { WatchersEngine } from '../../orchestrator/watchers-engine.js';

@ApiTags('Health & Telemetry')
@Controller()
export class HealthController {
  constructor(
    @Inject(WATCHERS_ENGINE) private readonly engine: WatchersEngine
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Service health check' })
  getHealth() {
    return {
      status: 'ok',
      service: 'lemon-watchers',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('api/v1/metrics')
  @ApiOperation({ summary: 'Aggregated watcher metrics' })
  getMetrics() {
    return this.engine.getMetrics();
  }

  @Get('api/v1/story')
  @ApiOperation({ summary: 'Recent story events buffer' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'includeProxy', required: false, type: Boolean })
  getStory(
    @Query('limit') limit?: string,
    @Query('includeProxy') includeProxy?: string
  ) {
    const parsedLimit = parseInt(limit || '50', 10);
    const items = this.engine.getRecentStory(
      Number.isFinite(parsedLimit) ? parsedLimit : 50,
      includeProxy !== 'false'
    );
    return { total: items.length, items };
  }

  @Get('api/v1/bus/status')
  @ApiOperation({ summary: 'LemonBus relay and SSE bridge status' })
  getBusStatus() {
    return this.engine.getBusMetrics();
  }
}
