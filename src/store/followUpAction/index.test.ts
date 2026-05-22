import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followUpActionService } from '@/services/followUpAction';

import { followUpActionSelectors } from './selectors';
import { useFollowUpActionStore } from './store';

const KEY_A = 'main_agent-a_topic-a';
const KEY_B = 'main_agent-b_topic-b';
const TOPIC_A = 'topic-a';
const TOPIC_B = 'topic-b';
const MSG = 'msg-real';
const MODEL_CONFIG = { model: 'scene-model', provider: 'scene-provider' };
const FETCH_PARAMS_A = { modelConfig: MODEL_CONFIG, topicId: TOPIC_A };
const FETCH_PARAMS_B = { modelConfig: MODEL_CONFIG, topicId: TOPIC_B };

const slotA = () => useFollowUpActionStore.getState().slots[KEY_A];
const slotB = () => useFollowUpActionStore.getState().slots[KEY_B];

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

    const promise = useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    expect(slotA().status).toBe('loading');
    await promise;
    expect(spy).toHaveBeenCalledOnce();
    expect(slotA().status).toBe('ready');
    expect(slotA().chips).toHaveLength(1);
    expect(slotA().messageId).toBe(MSG);
  });

  it('fetchFor forwards modelConfig, topicId, and threadId to the service', async () => {
    const spy = vi.spyOn(followUpActionService, 'extract').mockResolvedValue({
      messageId: MSG,
      chips: [{ label: 'a', message: 'a' }],
    });
    await useFollowUpActionStore.getState().fetchFor(KEY_A, {
      hint: { kind: 'onboarding', phase: 'discovery' },
      modelConfig: MODEL_CONFIG,
      threadId: 'thd-1',
      topicId: TOPIC_A,
    });

    expect(spy).toHaveBeenCalledWith(
      {
        hint: { kind: 'onboarding', phase: 'discovery' },
        modelConfig: MODEL_CONFIG,
        threadId: 'thd-1',
        topicId: TOPIC_A,
      },
      expect.any(AbortSignal),
    );
  });

  it('fetchFor leaves slot idle when service returns null', async () => {
    vi.spyOn(followUpActionService, 'extract').mockResolvedValue(null);
    await useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    expect(slotA().status).toBe('idle');
    expect(slotA().chips).toHaveLength(0);
    expect(slotA().messageId).toBeUndefined();
  });

  it('fetchFor leaves slot idle when service returns empty messageId', async () => {
    vi.spyOn(followUpActionService, 'extract').mockResolvedValue({ chips: [], messageId: '' });
    await useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    expect(slotA().status).toBe('idle');
    expect(slotA().messageId).toBeUndefined();
  });

  it('fetchFor dedupes while the slot is loading', async () => {
    const spy = vi
      .spyOn(followUpActionService, 'extract')
      .mockImplementation(() => new Promise(() => {}));
    void useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    void useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fetchFor on a different key does not abort an in-flight fetch on another key', async () => {
    let signalA: AbortSignal | undefined;
    let signalB: AbortSignal | undefined;
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (input, signal) => {
      if (input.topicId === TOPIC_A) signalA = signal;
      else signalB = signal;
      return new Promise(() => {});
    });
    void useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    await Promise.resolve();
    await Promise.resolve();
    void useFollowUpActionStore.getState().fetchFor(KEY_B, FETCH_PARAMS_B);
    await Promise.resolve();
    expect(signalA?.aborted).toBe(false);
    expect(signalB?.aborted).toBe(false);
    expect(slotA().status).toBe('loading');
    expect(slotB().status).toBe('loading');
  });

  it('clear(keyA) does not touch slots[keyB]', async () => {
    vi.spyOn(followUpActionService, 'extract').mockImplementation(() => new Promise(() => {}));
    void useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    void useFollowUpActionStore.getState().fetchFor(KEY_B, FETCH_PARAMS_B);
    useFollowUpActionStore.getState().clear(KEY_A);
    expect(slotA()).toBeUndefined();
    expect(slotB()?.status).toBe('loading');
  });

  it('abort(keyA) does not affect keyB controller', async () => {
    let signalA: AbortSignal | undefined;
    let signalB: AbortSignal | undefined;
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (input, signal) => {
      if (input.topicId === TOPIC_A) signalA = signal;
      else signalB = signal;
      return new Promise(() => {});
    });
    void useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    void useFollowUpActionStore.getState().fetchFor(KEY_B, FETCH_PARAMS_B);
    await Promise.resolve();
    useFollowUpActionStore.getState().abort(KEY_A);
    expect(signalA?.aborted).toBe(true);
    expect(signalB?.aborted).toBe(false);
    expect(slotA().status).toBe('idle');
    expect(slotB()?.status).toBe('loading');
  });

  it('20s timeout aborts the in-flight call', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (_, s) => {
      signal = s;
      return new Promise(() => {});
    });
    void useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    await Promise.resolve();
    vi.advanceTimersByTime(20_000);
    expect(signal?.aborted).toBe(true);
  });

  it('consume(key, chip) clears the slot for that key only', () => {
    useFollowUpActionStore.setState({
      slots: {
        [KEY_A]: {
          chips: [{ label: 'x', message: 'hello' }],
          messageId: MSG,
          status: 'ready',
        },
        [KEY_B]: {
          chips: [{ label: 'y', message: 'hello' }],
          messageId: MSG,
          status: 'ready',
        },
      },
    });
    useFollowUpActionStore.getState().consume(KEY_A, { label: 'x', message: 'hello' });
    expect(slotA()).toBeUndefined();
    expect(slotB()?.status).toBe('ready');
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

    const p1 = useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    void p1;
    await Promise.resolve();

    useFollowUpActionStore.getState().clear(KEY_A);
    expect(slotA()).toBeUndefined();

    const p2 = useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);

    resolveFirst!({ chips: [{ label: 'a', message: 'a' }], messageId: 'msg-old' });
    await p1;

    expect(slotA()?.messageId).not.toBe('msg-old');

    await p2;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(slotA()?.status).toBe('ready');
    expect(slotA()?.messageId).toBe('msg-new');
  });

  it('reset aborts all in-flight requests and clears every slot', async () => {
    const signals: AbortSignal[] = [];
    vi.spyOn(followUpActionService, 'extract').mockImplementation(async (_, s) => {
      if (s) signals.push(s);
      return new Promise(() => {});
    });
    void useFollowUpActionStore.getState().fetchFor(KEY_A, FETCH_PARAMS_A);
    void useFollowUpActionStore.getState().fetchFor(KEY_B, FETCH_PARAMS_B);
    await Promise.resolve();
    useFollowUpActionStore.getState().reset();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(useFollowUpActionStore.getState().slots).toEqual({});
  });
});

describe('followUpActionSelectors.chipsFor', () => {
  beforeEach(() => {
    useFollowUpActionStore.getState().reset?.();
  });

  it('returns chips when the slot matches messageId', () => {
    useFollowUpActionStore.setState({
      slots: {
        [KEY_A]: {
          chips: [{ label: 'a', message: 'a' }],
          messageId: MSG,
          status: 'ready',
        },
      },
    });
    const chips = followUpActionSelectors.chipsFor({
      conversationKey: KEY_A,
      messageId: MSG,
    })(useFollowUpActionStore.getState());
    expect(chips).toHaveLength(1);
  });

  it('returns empty when slot is missing', () => {
    const chips = followUpActionSelectors.chipsFor({
      conversationKey: KEY_A,
      messageId: MSG,
    })(useFollowUpActionStore.getState());
    expect(chips).toHaveLength(0);
  });

  it('returns empty when slot is not ready', () => {
    useFollowUpActionStore.setState({
      slots: {
        [KEY_A]: {
          chips: [{ label: 'a', message: 'a' }],
          messageId: MSG,
          status: 'loading',
        },
      },
    });
    const chips = followUpActionSelectors.chipsFor({
      conversationKey: KEY_A,
      messageId: MSG,
    })(useFollowUpActionStore.getState());
    expect(chips).toHaveLength(0);
  });

  it('matches a child id via childIdsKey (assistantGroup case)', () => {
    const CHILD = 'msg-child';
    useFollowUpActionStore.setState({
      slots: {
        [KEY_A]: {
          chips: [{ label: 'a', message: 'a' }],
          messageId: CHILD,
          status: 'ready',
        },
      },
    });
    const chips = followUpActionSelectors.chipsFor({
      childIdsKey: `${CHILD}|other`,
      conversationKey: KEY_A,
      messageId: 'group-id',
    })(useFollowUpActionStore.getState());
    expect(chips).toHaveLength(1);
  });

  it('does not leak across conversation keys', () => {
    useFollowUpActionStore.setState({
      slots: {
        [KEY_A]: {
          chips: [{ label: 'a', message: 'a' }],
          messageId: MSG,
          status: 'ready',
        },
      },
    });
    const chips = followUpActionSelectors.chipsFor({
      conversationKey: KEY_B,
      messageId: MSG,
    })(useFollowUpActionStore.getState());
    expect(chips).toHaveLength(0);
  });
});
