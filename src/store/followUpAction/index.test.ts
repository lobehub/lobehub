import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followUpActionService } from '@/services/followUpAction';

import { useFollowUpActionStore } from './store';

const TOPIC = 'topic-1';
const NEW_TOPIC = 'topic-2';
const MSG = 'msg-real';

describe('useFollowUpActionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFollowUpActionStore.getState().reset?.();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fetchFor sets loading then ready on success', async () => {
    const spy = vi.spyOn(followUpActionService, 'extract').mockResolvedValue({
      messageId: MSG,
      chips: [{ label: 'a', message: 'a' }],
    });

    const promise = useFollowUpActionStore.getState().fetchFor(TOPIC);
    expect(useFollowUpActionStore.getState().status).toBe('loading');
    await promise;
    expect(spy).toHaveBeenCalledOnce();
    expect(useFollowUpActionStore.getState().status).toBe('ready');
    expect(useFollowUpActionStore.getState().chips).toHaveLength(1);
    expect(useFollowUpActionStore.getState().messageId).toBe(MSG);
    expect(useFollowUpActionStore.getState().topicId).toBe(TOPIC);
  });

  it('fetchFor returns idle when service returns null', async () => {
    vi.spyOn(followUpActionService, 'extract').mockResolvedValue(null);
    await useFollowUpActionStore.getState().fetchFor(TOPIC);
    expect(useFollowUpActionStore.getState().status).toBe('idle');
    expect(useFollowUpActionStore.getState().chips).toHaveLength(0);
    expect(useFollowUpActionStore.getState().messageId).toBeUndefined();
  });

  it('fetchFor returns idle when service returns empty messageId', async () => {
    vi.spyOn(followUpActionService, 'extract').mockResolvedValue({ chips: [], messageId: '' });
    await useFollowUpActionStore.getState().fetchFor(TOPIC);
    expect(useFollowUpActionStore.getState().status).toBe('idle');
    expect(useFollowUpActionStore.getState().messageId).toBeUndefined();
  });

  it('fetchFor dedupes same topicId while still loading', async () => {
    const spy = vi
      .spyOn(followUpActionService, 'extract')
      .mockImplementation(() => new Promise(() => {}));
    const p1 = useFollowUpActionStore.getState().fetchFor(TOPIC);
    const p2 = useFollowUpActionStore.getState().fetchFor(TOPIC);
    void p1;
    void p2;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fetchFor with new topicId aborts the old controller', async () => {
    let firstSignal: AbortSignal | undefined;
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (_, signal) => {
      if (!firstSignal) firstSignal = signal;
      return new Promise(() => {});
    });
    const p1 = useFollowUpActionStore.getState().fetchFor(TOPIC);
    void p1;
    await Promise.resolve();
    await Promise.resolve();
    void useFollowUpActionStore.getState().fetchFor(NEW_TOPIC);
    expect(firstSignal?.aborted).toBe(true);
  });

  it('clear() aborts and resets state', async () => {
    vi.spyOn(followUpActionService, 'extract').mockImplementation(() => new Promise(() => {}));
    const p = useFollowUpActionStore.getState().fetchFor(TOPIC);
    void p;
    useFollowUpActionStore.getState().clear();
    expect(useFollowUpActionStore.getState().status).toBe('idle');
    expect(useFollowUpActionStore.getState().messageId).toBeUndefined();
    expect(useFollowUpActionStore.getState().pendingTopicId).toBeUndefined();
  });

  it('20s timeout aborts the in-flight call', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (_, s) => {
      signal = s;
      return new Promise(() => {});
    });
    const p = useFollowUpActionStore.getState().fetchFor(TOPIC);
    void p;
    await Promise.resolve();
    vi.advanceTimersByTime(20_000);
    expect(signal?.aborted).toBe(true);
  });

  it('consume(chip) clears state', () => {
    useFollowUpActionStore.setState({
      chips: [{ label: 'x', message: 'hello' }],
      messageId: MSG,
      status: 'ready',
    });
    useFollowUpActionStore.getState().consume({ label: 'x', message: 'hello' });
    expect(useFollowUpActionStore.getState().status).toBe('idle');
    expect(useFollowUpActionStore.getState().messageId).toBeUndefined();
    expect(useFollowUpActionStore.getState().chips).toHaveLength(0);
  });

  it('discards stale results when controller is replaced (race protection)', async () => {
    let resolveFirst: ((value: any) => void) | undefined;
    const firstResult = new Promise<any>((r) => {
      resolveFirst = r;
    });

    const spy = vi
      .spyOn(followUpActionService, 'extract')
      .mockImplementationOnce(() => firstResult)
      .mockResolvedValue({
        chips: [{ label: 'b', message: 'b' }],
        messageId: 'msg-new',
      });

    // First fetchFor is in flight (does not yet resolve).
    const p1 = useFollowUpActionStore.getState().fetchFor(TOPIC);
    void p1;
    await Promise.resolve();

    // User sends a new message → clear() aborts and resets.
    useFollowUpActionStore.getState().clear();
    expect(useFollowUpActionStore.getState().status).toBe('idle');

    // Next turn starts another fetchFor for the SAME topic.
    const p2 = useFollowUpActionStore.getState().fetchFor(TOPIC);

    // The first call now resolves with a stale result. It must be discarded
    // because its controller is no longer the active one — even though the
    // topicId still matches.
    resolveFirst!({ chips: [{ label: 'a', message: 'a' }], messageId: 'msg-old' });
    await p1;

    expect(useFollowUpActionStore.getState().messageId).not.toBe('msg-old');

    // Second call still writes through normally.
    await p2;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(useFollowUpActionStore.getState().status).toBe('ready');
    expect(useFollowUpActionStore.getState().messageId).toBe('msg-new');
  });

  it('reset aborts in-flight request and resets state', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (_, s) => {
      signal = s;
      return new Promise(() => {});
    });
    const p = useFollowUpActionStore.getState().fetchFor(TOPIC);
    void p;
    await Promise.resolve();
    useFollowUpActionStore.getState().reset();
    expect(signal?.aborted).toBe(true);
    expect(useFollowUpActionStore.getState().status).toBe('idle');
    expect(useFollowUpActionStore.getState().messageId).toBeUndefined();
    expect(useFollowUpActionStore.getState().pendingTopicId).toBeUndefined();
  });
});
