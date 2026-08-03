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

  const SCOPE = 'user-1:workspace-1';

  it('should remove resolved briefs from the SWR snapshot used on route remount', async () => {
    const resolvedBrief = createBrief('brief-resolved');
    const remainingBrief = createBrief('brief-remaining');
    const initialBriefs = [resolvedBrief, remainingBrief];
    const cacheKey = JSON.stringify(briefKeys.list(true, SCOPE));
    cache.set(cacheKey, initialBriefs);

    const state = { briefs: initialBriefs, briefsScope: SCOPE, isBriefsInit: true };
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

  // The write-back must land on the entry the list came from. Keying it off the
  // live scope instead would, on a mid-flight workspace switch, seed the new
  // workspace's bucket and cache key with the previous workspace's briefs.
  it('should abandon the write when the workspace changed while the request was in flight', async () => {
    const brief = createBrief('brief-1');
    const nextScopeBrief = createBrief('brief-from-next-workspace');
    const state = { briefs: [brief], briefsScope: SCOPE, isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'resolveManyAsRead').mockImplementation(async () => {
      // The switch lands before the response does.
      Object.assign(state, { briefs: [nextScopeBrief], briefsScope: 'user-1:workspace-2' });
      return { data: [brief.id] } as never;
    });

    await action.resolveBriefsAsRead([brief.id]);

    expect(state.briefs).toEqual([nextScopeBrief]);
    expect(cache.size).toBe(0);
  });

  it('should not write an unstamped brief list into any scope entry', async () => {
    const brief = createBrief('brief-1');
    const state = { briefs: [brief], briefsScope: undefined, isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'resolveManyAsRead').mockResolvedValue({ data: [brief.id] } as never);

    await action.resolveBriefsAsRead([brief.id]);

    expect(set).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it('should skip the store write when deleting a brief the list no longer holds', async () => {
    const state = { briefs: [createBrief('brief-1')], briefsScope: SCOPE, isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'delete').mockResolvedValue(undefined as never);

    await action.deleteBrief('brief-from-another-workspace');

    expect(set).not.toHaveBeenCalled();
  });
});
