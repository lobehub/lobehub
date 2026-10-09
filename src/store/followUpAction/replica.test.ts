/**
 * The follow-up chip slots are a replica: `slots` is its view, `slotsReplica`
 * its bookkeeping. The slot is memory-only — it is never written to or
 * hydrated from storage — and a write under a new identity scope drops the
 * previous identity's slots instead of letting them bleed across users /
 * workspaces.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { followUpActionService } from '@/services/followUpAction';

import { followUpSlotResource } from './projection';
import { useFollowUpActionStore } from './store';

vi.mock('@/services/followUpAction', () => ({
  followUpActionService: { extract: vi.fn() },
}));

const KEY_A = 'main_agent-a_topic-a';
const KEY_B = 'main_agent-b_topic-b';
const MSG = 'msg-real';

const params = (topicId: string) => ({
  modelConfig: { model: 'scene-model', provider: 'scene-provider' },
  topicId,
});

const slot = (key: string) => useFollowUpActionStore.getState().slots[key];
const entry = (key: string) => useFollowUpActionStore.getState().slotsReplica.entries[key];

let scope = '';
const useScope = (next: string) => {
  scope = next;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
};

describe('followUpAction replica', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScope('u1:personal');
    useFollowUpActionStore.getState().reset();
    vi.mocked(followUpActionService.extract).mockResolvedValue({
      chips: [{ label: 'a', message: 'a' }],
      messageId: MSG,
    });
  });

  it('is a memory-only resource (a slot carries a live AbortController)', () => {
    expect(followUpSlotResource.persisted).toBe(false);
    expect(followUpSlotResource.storage).toBeUndefined();
  });

  it('keys the view by conversation and keeps the booking entry in step', async () => {
    await useFollowUpActionStore.getState().fetchFor(KEY_A, params('topic-a'));

    expect(slot(KEY_A)?.status).toBe('ready');
    expect(slot(KEY_A)?.messageId).toBe(MSG);
    // The view is backed by the replica engine (a local write, not a fetch).
    expect(entry(KEY_A)?.source).toBe('local');
    expect(useFollowUpActionStore.getState().slotsReplica.scope).toBe('u1:personal');

    useFollowUpActionStore.getState().clear(KEY_A);

    expect(slot(KEY_A)).toBeUndefined();
    expect(entry(KEY_A)).toBeUndefined();
  });

  it('writes the loading slot through the engine before the extraction resolves', async () => {
    vi.mocked(followUpActionService.extract).mockImplementation(
      () => new Promise(() => {}) as never,
    );

    void useFollowUpActionStore.getState().fetchFor(KEY_A, params('topic-a'));

    expect(slot(KEY_A)?.status).toBe('loading');
    expect(entry(KEY_A)).toBeDefined();
  });

  it('drops the previous identity’s slots when the scope switches', async () => {
    await useFollowUpActionStore.getState().fetchFor(KEY_A, params('topic-a'));
    expect(slot(KEY_A)?.status).toBe('ready');

    useScope('u2:personal');
    // Any write under the new identity first drops the old identity's view.
    await useFollowUpActionStore.getState().fetchFor(KEY_B, params('topic-b'));

    expect(slot(KEY_A)).toBeUndefined();
    expect(slot(KEY_B)?.status).toBe('ready');
    expect(useFollowUpActionStore.getState().slotsReplica.scope).toBe('u2:personal');
  });

  it('reset clears the view and the replica bookkeeping together', async () => {
    await useFollowUpActionStore.getState().fetchFor(KEY_A, params('topic-a'));

    useFollowUpActionStore.getState().reset();

    expect(useFollowUpActionStore.getState().slots).toEqual({});
    expect(useFollowUpActionStore.getState().slotsReplica.entries).toEqual({});
  });
});
