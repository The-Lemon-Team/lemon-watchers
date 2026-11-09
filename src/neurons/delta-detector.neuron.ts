import crypto from 'node:crypto';
import { RawFeedItem } from '../types/watcher.types.js';
import { DatabaseService } from '../db/database.service.js';

export interface DeltaItem {
  raw: RawFeedItem;
  contentHash: string;
}

export class DeltaDetectorNeuron {
  constructor(private readonly db: DatabaseService) {}

  async detectNewItems(
    watcherId: string,
    items: RawFeedItem[]
  ): Promise<DeltaItem[]> {
    const delta: DeltaItem[] = [];

    for (const item of items) {
      const isIngested = await this.db.isItemAlreadyIngested(watcherId, item.guid);
      if (!isIngested) {
        const contentHash = this.computeContentHash(item);
        delta.push({
          raw: item,
          contentHash,
        });
      }
    }

    return delta;
  }

  private computeContentHash(item: RawFeedItem): string {
    const data = `${item.guid}:${item.title}:${item.summary}`;
    return crypto.createHash('sha256').update(data, 'utf-8').digest('hex');
  }
}
