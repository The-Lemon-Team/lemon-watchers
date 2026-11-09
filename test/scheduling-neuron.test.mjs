import { describe, it, expect } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { SchedulingNeuron } from '../src/neurons/scheduling.neuron.js';

describe('SchedulingNeuron', () => {
  it('triggers manually via triggerNow()', async () => {
    const scheduler = new SchedulingNeuron({
      intervalSeconds: 60,
      initialDelaySeconds: 100, // far in the future
      enableJitter: false,
    });

    const triggerPromise = firstValueFrom(scheduler.triggers$());
    scheduler.triggerNow();

    await expect(triggerPromise).resolves.toBeUndefined();
    scheduler.destroy();
  });
});
