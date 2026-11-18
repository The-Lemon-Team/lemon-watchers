import { DynamicModule, Module } from '@nestjs/common';
import type { WatchersEngine } from '../orchestrator/watchers-engine.js';
import { WATCHERS_ENGINE } from './tokens.js';
import { HealthController } from './controllers/health.controller.js';
import { FoldersController } from './controllers/folders.controller.js';
import { WatchersController } from './controllers/watchers.controller.js';
import { ItemsController } from './controllers/items.controller.js';
import { RawNewsController } from './controllers/raw-news.controller.js';
import { StreamsController } from './controllers/streams.controller.js';
import { BusStreamController } from './controllers/bus-stream.controller.js';

@Module({})
export class WatchersNestModule {
  static register(engine: WatchersEngine): DynamicModule {
    return {
      module: WatchersNestModule,
      controllers: [
        HealthController,
        FoldersController,
        WatchersController,
        ItemsController,
        RawNewsController,
        StreamsController,
        BusStreamController,
      ],
      providers: [
        {
          provide: WATCHERS_ENGINE,
          useValue: engine,
        },
      ],
      exports: [WATCHERS_ENGINE],
    };
  }
}
