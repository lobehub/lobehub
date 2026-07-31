// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as clientDataStore from '@/client-data';
import * as cacheScope from '@/libs/swr/useCacheScope';
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
  const clientDataActions = {
    deleteBriefEntity: vi.fn(),
    resolveBriefEntitiesAsRead: vi.fn(),
    updateBriefReadState: vi.fn(),
    updateBriefResolution: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(100);
    vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-1:workspace-1');
    vi.spyOn(clientDataStore, 'getClientDataStoreState').mockReturnValue(
      clientDataActions as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes resolved briefs from the legacy projection and canonical Home index', async () => {
    const resolvedBrief = createBrief('brief-resolved');
    const remainingBrief = createBrief('brief-remaining');
    const state = { briefs: [resolvedBrief, remainingBrief], isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'resolveManyAsRead').mockResolvedValue({
      data: [resolvedBrief.id],
    } as never);

    await action.resolveBriefsAsRead([resolvedBrief.id, remainingBrief.id]);

    expect(state.briefs).toEqual([remainingBrief]);
    expect(clientDataActions.resolveBriefEntitiesAsRead).toHaveBeenCalledWith(
      'user-1:workspace-1',
      [resolvedBrief.id],
      expect.any(String),
      100,
    );
  });

  it('writes read state through the canonical entity mutation path', async () => {
    const brief = createBrief('brief-1');
    const state = { briefs: [brief], isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'markRead').mockResolvedValue({
      data: { readAt: '2026-07-31T01:00:00.000Z' },
    } as never);

    await action.markBriefRead(brief.id);

    expect(state.briefs[0].readAt).toBe('2026-07-31T01:00:00.000Z');
    expect(clientDataActions.updateBriefReadState).toHaveBeenCalledWith(
      'user-1:workspace-1',
      brief.id,
      state.briefs[0].readAt,
      100,
    );
  });

  it('uses the request-start observation for an authoritative Brief resolution', async () => {
    const brief = createBrief('brief-1');
    const state = { briefs: [brief], isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'resolve').mockResolvedValue({
      data: {
        resolvedAction: 'approve',
        resolvedAt: '2026-07-31T02:00:00.000Z',
        resolvedComment: null,
      },
    } as never);

    await action.resolveBrief(brief.id, 'approve');

    const resolution = {
      resolvedAction: 'approve',
      resolvedAt: '2026-07-31T02:00:00.000Z',
      resolvedComment: null,
    };
    expect(state.briefs[0]).toMatchObject(resolution);
    expect(clientDataActions.updateBriefResolution).toHaveBeenCalledWith(
      'user-1:workspace-1',
      brief.id,
      resolution,
      100,
    );
  });

  it('tombstones a deleted brief in the canonical entity graph', async () => {
    const deleted = createBrief('brief-deleted');
    const remaining = createBrief('brief-remaining');
    const state = { briefs: [deleted, remaining], isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'delete').mockResolvedValue(undefined as never);

    await action.deleteBrief(deleted.id);

    expect(state.briefs).toEqual([remaining]);
    expect(clientDataActions.deleteBriefEntity).toHaveBeenCalledWith(
      'user-1:workspace-1',
      deleted.id,
      100,
    );
  });
});
