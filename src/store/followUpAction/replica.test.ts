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

  it('does not let a new identity reuse the previous identity’s in-flight slot', async () => {
    // Identity A's extraction never settles.
    vi.mocked(followUpActionService.extract).mockImplementation(
      () => new Promise(() => {}) as never,
    );
    void useFollowUpActionStore.getState().fetchFor(KEY_A, params('topic-a'));
    expect(slot(KEY_A)?.status).toBe('loading');

    // The identity switches while A's extraction is still in flight.
    useScope('u2:personal');
    vi.mocked(followUpActionService.extract).mockResolvedValue({
      chips: [{ label: 'b', message: 'b' }],
      messageId: MSG,
    });

    // Same conversation key: the new identity must run its own extraction
    // instead of reading A's `loading` slot and skipping its fetch.
    await useFollowUpActionStore.getState().fetchFor(KEY_A, params('topic-a'));

    expect(followUpActionService.extract).toHaveBeenCalledTimes(2);
    expect(slot(KEY_A)?.chips).toEqual([{ label: 'b', message: 'b' }]);
    expect(useFollowUpActionStore.getState().slotsReplica.scope).toBe('u2:personal');
  });

  it('aborts the outgoing identity’s in-flight extraction before dropping its slot', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(followUpActionService.extract).mockImplementation(((_input, outgoing) => {
      signal = outgoing as AbortSignal;
      return new Promise(() => {}) as never;
    }) as never);

    void useFollowUpActionStore.getState().fetchFor(KEY_A, params('topic-a'));
    expect(signal?.aborted).toBe(false);

    useScope('u2:personal');
    vi.mocked(followUpActionService.extract).mockResolvedValue({ chips: [], messageId: MSG });
    await useFollowUpActionStore.getState().fetchFor(KEY_B, params('topic-b'));

    // The outgoing request is cancelled instead of running on to completion.
    expect(signal?.aborted).toBe(true);
  });

  it('drops an extraction that lands after the identity switched', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    vi.mocked(followUpActionService.extract).mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)) as never,
    );

    const pending = useFollowUpActionStore.getState().fetchFor(KEY_A, params('topic-a'));
    expect(slot(KEY_A)?.status).toBe('loading');

    // The identity switches mid-flight, then A's ownerless result lands.
    useScope('u2:personal');
    resolvers[0]({ chips: [{ label: 'a', message: 'a' }], messageId: MSG });
    await pending;

    // It must not be committed as the new identity's data (nor left on screen
    // as its own slot).
    expect(slot(KEY_A)).toBeUndefined();
    expect(entry(KEY_A)).toBeUndefined();
  });

  it('reset clears the view and the replica bookkeeping together', async () => {
    await useFollowUpActionStore.getState().fetchFor(KEY_A, params('topic-a'));

    useFollowUpActionStore.getState().reset();

    expect(useFollowUpActionStore.getState().slots).toEqual({});
    expect(useFollowUpActionStore.getState().slotsReplica.entries).toEqual({});
  });
});
