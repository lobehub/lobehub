// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as cacheScope from '@/libs/swr/useCacheScope';
import * as projectionStore from '@/projection';
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
  const projectionActions = {
    deleteBriefProjection: vi.fn(),
    resolveBriefProjectionsAsRead: vi.fn(),
    scopes: {} as Record<string, unknown>,
    updateBriefReadState: vi.fn(),
    updateBriefResolution: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    projectionActions.scopes = {};
    vi.spyOn(Date, 'now').mockReturnValue(100);
    vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-1:workspace-1');
    vi.spyOn(projectionStore, 'getProjectionStoreState').mockReturnValue(
      projectionActions as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const SCOPE = 'user-1:workspace-1';

  it('removes resolved briefs from the legacy projection and canonical Home index', async () => {
    const resolvedBrief = createBrief('brief-resolved');
    const remainingBrief = createBrief('brief-remaining');
    const state = {
      briefs: [resolvedBrief, remainingBrief],
      briefsScope: SCOPE,
      isBriefsInit: true,
    };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'resolveManyAsRead').mockResolvedValue({
      data: [resolvedBrief.id],
    } as never);

    await action.resolveBriefsAsRead([resolvedBrief.id, remainingBrief.id]);

    expect(state.briefs).toEqual([remainingBrief]);
    expect(projectionActions.resolveBriefProjectionsAsRead).toHaveBeenCalledWith(
      'user-1:workspace-1',
      [resolvedBrief.id],
      expect.any(String),
      expect.any(Number),
    );
  });

  it('writes read state through the canonical Projection mutation path', async () => {
    const brief = createBrief('brief-1');
    const state = { briefs: [brief], isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'markRead').mockResolvedValue({
      data: { readAt: '2026-07-31T01:00:00.000Z' },
    } as never);

    await action.markBriefRead(brief.id);

    expect(state.briefs[0].readAt).toBe('2026-07-31T01:00:00.000Z');
    expect(projectionActions.updateBriefReadState).toHaveBeenCalledWith(
      'user-1:workspace-1',
      brief.id,
      state.briefs[0].readAt,
      expect.any(Number),
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
    expect(projectionActions.updateBriefResolution).toHaveBeenCalledWith(
      'user-1:workspace-1',
      brief.id,
      resolution,
      expect.any(Number),
    );
  });

  it('tombstones a deleted brief in the canonical Projection graph', async () => {
    const deleted = createBrief('brief-deleted');
    const remaining = createBrief('brief-remaining');
    const state = { briefs: [deleted, remaining], isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'delete').mockResolvedValue(undefined as never);

    await action.deleteBrief(deleted.id);

    expect(state.briefs).toEqual([remaining]);
    expect(projectionActions.deleteBriefProjection).toHaveBeenCalledWith(
      'user-1:workspace-1',
      deleted.id,
      expect.any(Number),
    );
  });

  it('keeps a Brief that a newer canonical edit preserved across deletion', async () => {
    const brief = createBrief('brief-edited');
    const state = { briefs: [brief], isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    projectionActions.scopes = {
      [SCOPE]: {
        records: {
          brief: {
            [brief.id]: { fragments: {}, id: brief.id, kind: 'brief' },
          },
        },
      },
    };
    vi.spyOn(briefService, 'delete').mockResolvedValue(undefined as never);

    await action.deleteBrief(brief.id);

    expect(state.briefs).toEqual([brief]);
    expect(set).not.toHaveBeenCalled();
  });

  // The legacy-projection patch must land on the list the ids came from. On a
  // mid-flight workspace switch the bucket already belongs to the next
  // partition, so splicing it would leak the previous workspace's briefs —
  // while the canonical Projection resolution still lands in the captured scope.
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
    expect(set).not.toHaveBeenCalled();
    expect(projectionActions.resolveBriefProjectionsAsRead).toHaveBeenCalledWith(
      SCOPE,
      [brief.id],
      expect.any(String),
      expect.any(Number),
    );
  });

  it('should not write an unstamped brief list into any scope entry', async () => {
    const brief = createBrief('brief-1');
    const state = { briefs: [brief], briefsScope: undefined, isBriefsInit: true };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new BriefListActionImpl(set as never, () => state as BriefStore);
    vi.spyOn(briefService, 'resolveManyAsRead').mockResolvedValue({ data: [brief.id] } as never);

    await action.resolveBriefsAsRead([brief.id]);

    expect(set).not.toHaveBeenCalled();
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
