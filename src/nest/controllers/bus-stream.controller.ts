import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { WATCHERS_ENGINE } from '../tokens.js';
import type { WatchersEngine } from '../../orchestrator/watchers-engine.js';

@ApiTags('LemonBus Bridge')
@Controller('api/v1/bus')
export class BusStreamController {
  constructor(
    @Inject(WATCHERS_ENGINE) private readonly engine: WatchersEngine
  ) {}

  @Get('stream')
  @ApiOperation({ summary: 'Legacy SSE alias for /api/v1/watchers/live' })
  stream(@Req() req: Request, @Res() res: Response) {
    this.engine.sse.addClient(req, res);
  }
}
