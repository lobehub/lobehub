// @vitest-environment node
import type { ScopedMutator } from 'swr/_internal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setScopedMutate } from '@/libs/swr';
import { briefKeys } from '@/libs/swr/keys';
import { briefService } from '@/services/brief';
import type { BriefStore } from '@/store/brief/store';
import type { BriefItem } from '@/store/brief/types';

import { BriefListActionImpl } from './action';

const createBrief = (id: string): BriefItem => ({
  actions: null,
  agent: null,
  agentId: null,
  artifacts: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  cronJobId: null,
  id,
  priority: null,
  readAt: null,
  resolvedAction: null,
  resolvedAt: null,
  resolvedComment: null,
  summary: `${id} summary`,
  taskId: null,
  title: `${id} title`,
  topicId: null,
  type: 'result',
  userId: 'user-1',
});

describe('BriefListActionImpl', () => {
  const cache = new Map<string, BriefItem[]>();

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    setScopedMutate((async (key, data) => {
      if (Array.isArray(data)) cache.set(JSON.stringify(key), data);
      return data;
    }) as ScopedMutator);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should remove resolved briefs from the SWR snapshot used on route remount', async () => {
    const resolvedBrief = createBrief('brief-resolved');
    const remainingBrief = createBrief('brief-remaining');
    const initialBriefs = [resolvedBrief, remainingBrief];
    const cacheKey = JSON.stringify(briefKeys.list(true));
    cache.set(cacheKey, initialBriefs);

    const state = { briefs: initialBriefs, isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'resolveManyAsRead').mockResolvedValue({
      data: [resolvedBrief.id],
    } as never);

    await action.resolveBriefsAsRead(initialBriefs.map((brief) => brief.id));

    expect(state.briefs).toEqual([remainingBrief]);
    expect(cache.get(cacheKey)).toEqual([remainingBrief]);

    state.briefs = cache.get(cacheKey) ?? [];
    expect(state.briefs).not.toContainEqual(expect.objectContaining({ id: resolvedBrief.id }));
  });
});
