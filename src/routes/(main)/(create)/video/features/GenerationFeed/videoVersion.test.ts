import { describe, expect, it } from 'vitest';

import type { Generation, GenerationBatch } from '@/types/generation';

import { buildVideoVersionMap } from './videoVersion';

const makeBatch = (
  id: string,
  generation: Partial<Generation> & { id: string },
): GenerationBatch => ({
  createdAt: new Date(),
  generations: [
    {
      asyncTaskId: null,
      createdAt: new Date(),
      task: { id: '', status: 'success' as any },
      ...generation,
    },
  ],
  id,
  model: 'gemini-omni-1.1-flash',
  prompt: id,
  provider: 'google',
});

describe('buildVideoVersionMap', () => {
  it('numbers an edit chain from the original generation', () => {
    const map = buildVideoVersionMap([
      makeBatch('b1', { id: 'g1' }),
      makeBatch('b2', { id: 'g2', previousGenerationId: 'g1' }),
      makeBatch('b3', {
        asset: { previousGenerationId: 'g2', type: 'video' },
        id: 'g3',
      }),
    ]);

    expect(map.get('g1')).toMatchObject({ previousGenerationId: undefined, version: 1 });
    expect(map.get('g2')).toMatchObject({ previousGenerationId: 'g1', version: 2 });
    expect(map.get('g3')).toMatchObject({ previousGenerationId: 'g2', version: 3 });
    expect(map.get('g1')?.hasEdits).toBe(true);
    expect(map.get('g2')?.hasEdits).toBe(true);
    expect(map.get('g3')?.hasEdits).toBe(false);
  });

  it('keeps counting when the source generation is no longer loaded', () => {
    const map = buildVideoVersionMap([
      makeBatch('b2', { id: 'g2', previousGenerationId: 'deleted' }),
    ]);

    expect(map.get('g2')).toMatchObject({ previousGenerationId: 'deleted', version: 2 });
  });

  it('stops on a malformed cycle', () => {
    const map = buildVideoVersionMap([
      makeBatch('b1', { id: 'g1', previousGenerationId: 'g2' }),
      makeBatch('b2', { id: 'g2', previousGenerationId: 'g1' }),
    ]);

    expect(map.get('g1')?.version).toBeLessThanOrEqual(50);
  });
});
