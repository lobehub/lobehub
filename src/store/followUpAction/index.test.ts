import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followUpActionService } from '@/services/followUpAction';

import { useFollowUpActionStore } from './store';

const MSG = 'msg-1';
const NEW_MSG = 'msg-2';

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

    const promise = useFollowUpActionStore.getState().fetchFor(MSG);
    expect(useFollowUpActionStore.getState().status).toBe('loading');
    await promise;
    expect(spy).toHaveBeenCalledOnce();
    expect(useFollowUpActionStore.getState().status).toBe('ready');
    expect(useFollowUpActionStore.getState().chips).toHaveLength(1);
  });

  it('fetchFor returns idle when service returns null', async () => {
    vi.spyOn(followUpActionService, 'extract').mockResolvedValue(null);
    await useFollowUpActionStore.getState().fetchFor(MSG);
    expect(useFollowUpActionStore.getState().status).toBe('idle');
    expect(useFollowUpActionStore.getState().chips).toHaveLength(0);
    expect(useFollowUpActionStore.getState().messageId).toBeUndefined();
  });

  it('fetchFor dedupes same messageId while still loading', async () => {
    const spy = vi
      .spyOn(followUpActionService, 'extract')
      .mockImplementation(() => new Promise(() => {}));
    const p1 = useFollowUpActionStore.getState().fetchFor(MSG);
    const p2 = useFollowUpActionStore.getState().fetchFor(MSG);
    void p1;
    void p2;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fetchFor with new messageId aborts the old controller', async () => {
    let firstSignal: AbortSignal | undefined;
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (_, signal) => {
      // Only capture the first call's signal
      if (!firstSignal) firstSignal = signal;
      return new Promise(() => {});
    });
    const p1 = useFollowUpActionStore.getState().fetchFor(MSG);
    void p1;
    await Promise.resolve();
    await Promise.resolve();
    void useFollowUpActionStore.getState().fetchFor(NEW_MSG);
    expect(firstSignal?.aborted).toBe(true);
  });

  it('clear() aborts and resets state', async () => {
    vi.spyOn(followUpActionService, 'extract').mockImplementation(() => new Promise(() => {}));
    const p = useFollowUpActionStore.getState().fetchFor(MSG);
    void p;
    useFollowUpActionStore.getState().clear();
    expect(useFollowUpActionStore.getState().status).toBe('idle');
    expect(useFollowUpActionStore.getState().messageId).toBeUndefined();
  });

  it('3s timeout aborts the in-flight call', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (_, s) => {
      signal = s;
      return new Promise(() => {});
    });
    const p = useFollowUpActionStore.getState().fetchFor(MSG);
    void p;
    await Promise.resolve();
    vi.advanceTimersByTime(3000);
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

  it('reset aborts in-flight request and resets state', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (_, s) => {
      signal = s;
      return new Promise(() => {});
    });
    const p = useFollowUpActionStore.getState().fetchFor(MSG);
    void p;
    await Promise.resolve();
    useFollowUpActionStore.getState().reset();
    expect(signal?.aborted).toBe(true);
    expect(useFollowUpActionStore.getState().status).toBe('idle');
    expect(useFollowUpActionStore.getState().messageId).toBeUndefined();
  });
});
