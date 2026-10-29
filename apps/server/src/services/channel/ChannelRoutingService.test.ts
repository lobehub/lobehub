// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHANNEL_ROUTING_TIMEOUT_MS,
  ChannelRoutingService,
  selectChannelResponders,
} from './ChannelRoutingService';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  decide: vi.fn(),
  init: vi.fn(),
  notify: vi.fn(),
  pending: vi.fn(),
  relay: vi.fn(),
  resolve: vi.fn(),
  resolveConfig: vi.fn(),
  wake: vi.fn(),
}));
vi.mock('@/database/repositories/channel', () => ({
  CHANNEL_ROUTING_BATCH_SIZE: 10,
  CHANNEL_ROUTING_LEASE_MS: 60_000,
  ChannelExecutionRepository: class {
    resolveRouting = mocks.resolve;
  },
  ChannelRoutingRepository: class {
    claim = mocks.claim;
    pending = mocks.pending;
  },
}));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: mocks.init }));
vi.mock('@/server/modules/AgentRuntime/llmRelay/resolveLlmExecutionSite', () => ({
  resolveProviderRelay: mocks.relay,
}));
vi.mock('./routingConfig', () => ({ resolveChannelRoutingConfig: mocks.resolveConfig }));
vi.mock('./notify', () => ({ notifyChannel: mocks.notify }));
vi.mock('./queue', () => ({ wakeChannel: mocks.wake }));

const input = {
  attempt: 2,
  candidates: [
    { description: 'Writes code', memberId: 'coder', name: 'Coder' },
    { description: 'Reviews code', memberId: 'reviewer', name: 'Reviewer' },
  ],
  history: [{ author: 'user', content: 'We are fixing the parser' }],
  message: 'Please implement the fix',
  messageId: 'message',
  status: 'claimed',
  userId: 'sender',
  workspaceId: 'workspace',
};
const response = (a: number, b: number) => ({
  answers: {
    coder: { probability: a, type: 'boolean' as const },
    reviewer: { probability: b, type: 'boolean' as const },
  },
  model: 'jev-1.14.0',
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pending.mockResolvedValue([{ id: 'message' }]);
  mocks.claim.mockResolvedValue(input);
  mocks.resolveConfig.mockResolvedValue({ model: 'jev-1.14.0', provider: 'typesafe' });
  mocks.init.mockResolvedValue({ decide: mocks.decide });
  mocks.decide.mockResolvedValue(response(0.95, 0.05));
  mocks.resolve.mockResolvedValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Channel responder decisions', () => {
  it('selects one, multiple, or no responders', () => {
    expect(selectChannelResponders(input.candidates, response(0.9, 0.1))).toMatchObject({
      status: 'assigned',
      memberIds: ['coder'],
    });
    expect(selectChannelResponders(input.candidates, response(0.9, 0.9))).toMatchObject({
      status: 'assigned',
      memberIds: ['coder', 'reviewer'],
    });
    expect(selectChannelResponders(input.candidates, response(0.1, 0.1))).toMatchObject({
      status: 'skipped',
    });
  });

  it('uses inclusive 70% confidence boundaries for responding and staying silent', () => {
    expect(selectChannelResponders(input.candidates, response(0.7, 0.3))).toMatchObject({
      status: 'assigned',
      memberIds: ['coder'],
    });
    expect(selectChannelResponders(input.candidates, response(0.7, 0.7))).toMatchObject({
      status: 'assigned',
      memberIds: ['coder', 'reviewer'],
    });
    expect(selectChannelResponders(input.candidates, response(0.3, 0.3))).toMatchObject({
      status: 'skipped',
    });
  });

  it.each([0.3001, 0.5, 0.6999])(
    'assigns all eligible members when any probability is uncertain (%s)',
    (probability) => {
      for (const other of [0.05, 0.95]) {
        expect(
          selectChannelResponders(input.candidates, response(other, probability)),
        ).toMatchObject({
          status: 'assigned',
          memberIds: ['coder', 'reviewer'],
        });
      }
    },
  );

  it('invites all candidates for the reported open-ended LobeHub question', () => {
    const candidates = ['pi', 'codex', 'jinyan'].map((memberId) => ({
      description: '',
      memberId,
      name: memberId,
    }));
    expect(
      selectChannelResponders(candidates, {
        model: 'jev-1.14.0',
        answers: {
          pi: { probability: 0.51, type: 'boolean' },
          codex: { probability: 0.41, type: 'boolean' },
          jinyan: { probability: 0.35, type: 'boolean' },
        },
      }),
    ).toMatchObject({ status: 'assigned', memberIds: ['pi', 'codex', 'jinyan'] });
  });

  it.each([-1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'fails closed on invalid probability %s, even alongside an uncertain answer',
    (probability) => {
      for (const answers of [response(0.5, probability), response(probability, 0.5)]) {
        expect(selectChannelResponders(input.candidates, answers)).toMatchObject({
          status: 'unassigned',
        });
      }
    },
  );

  it('skips when there are no eligible candidates', () => {
    expect(selectChannelResponders([], { model: 'jev', answers: {} })).toMatchObject({
      status: 'skipped',
    });
  });

  it('does not treat refusal or missing answers as no response needed', () => {
    expect(
      selectChannelResponders(input.candidates, {
        model: 'jev',
        answers: { coder: { type: 'refusal' } },
      }),
    ).toMatchObject({ status: 'unassigned' });
    expect(selectChannelResponders(input.candidates, { model: 'jev', answers: {} })).toMatchObject({
      status: 'unassigned',
    });
    for (const answers of [
      { coder: { probability: 0.5, type: 'boolean' as const } },
      {
        coder: { probability: 0.5, type: 'boolean' as const },
        reviewer: { type: 'refusal' as const },
      },
    ]) {
      expect(selectChannelResponders(input.candidates, { model: 'jev', answers })).toMatchObject({
        status: 'unassigned',
      });
    }
  });
});

describe('routing worker', () => {
  const run = () => new ChannelRoutingService({} as never).advance('channel');

  it('batches candidates in one decide call using the sender credentials and workspace', async () => {
    await run();
    expect(mocks.init).toHaveBeenCalledWith({}, 'sender', 'typesafe', 'workspace');
    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'jev-1.14.0',
        questions: {
          coder: expect.objectContaining({ type: 'boolean' }),
          reviewer: expect.objectContaining({ type: 'boolean' }),
        },
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          channelId: 'channel',
          messageId: 'message',
          routingAttempt: 2,
          trigger: 'channel',
          scenario: 'channel_routing',
          promptVersion: 'v1',
        }),
        user: 'sender',
      }),
    );
    expect(mocks.resolve).toHaveBeenCalledWith(
      'channel',
      'message',
      2,
      expect.objectContaining({
        memberIds: ['coder'],
        status: 'assigned',
        details: expect.objectContaining({ model: 'jev-1.14.0', provider: 'typesafe' }),
      }),
    );
    expect(mocks.wake.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.claim.mock.invocationCallOrder[0],
    );
  });

  it('persists all eligible recipients and the decision audit when probabilities are uncertain', async () => {
    mocks.decide.mockResolvedValue(response(0.51, 0.41));
    await run();
    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledWith(
      'channel',
      'message',
      2,
      expect.objectContaining({
        memberIds: ['coder', 'reviewer'],
        status: 'assigned',
        reason: 'Decision uncertain; selected all eligible Agents',
        details: expect.objectContaining({
          probabilities: JSON.stringify(response(0.51, 0.41).answers),
        }),
      }),
    );
  });

  it('does not call the provider if another worker owns the attempt', async () => {
    mocks.claim.mockResolvedValue(null);
    await run();
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('wakes blocked jobs when claiming settles a message without a model call', async () => {
    mocks.claim.mockResolvedValue({ status: 'settled' });
    await run();
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.wake).toHaveBeenCalledWith('channel');
    expect(mocks.wake.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      mocks.claim.mock.invocationCallOrder[0],
    );
  });

  it('does not hot-loop when a full batch is already leased', async () => {
    mocks.pending.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: String(i) })));
    mocks.claim.mockResolvedValue(null);
    await run();
    expect(mocks.wake).toHaveBeenCalledTimes(1);
    expect(mocks.wake).toHaveBeenCalledWith('channel', 60_000);
  });

  it('revisits deferred thread replies immediately after a root decision', async () => {
    await run();
    expect(mocks.wake).toHaveBeenLastCalledWith('channel');
    expect(mocks.wake.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      mocks.resolve.mock.invocationCallOrder[0],
    );
  });

  it.each([
    { name: 'assigned', decision: response(0.95, 0.05) },
    { name: 'skipped', decision: response(0.05, 0.05) },
    { name: 'unassigned', decision: { model: 'jev', answers: {} } },
  ])(
    'wakes execution after an $name decision without waiting for a slow sibling',
    async ({ decision }) => {
      const slow = Promise.withResolvers<ReturnType<typeof response>>();
      mocks.pending.mockResolvedValue([{ id: 'fast' }, { id: 'slow' }]);
      mocks.claim.mockImplementation(async (_channelId: string, messageId: string) => ({
        ...input,
        messageId,
      }));
      mocks.decide.mockImplementation((_params, options) =>
        options.metadata.messageId === 'slow' ? slow.promise : Promise.resolve(decision),
      );
      const advancing = run();
      try {
        await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(mocks.wake).toHaveBeenCalledWith('channel'));
        expect(mocks.resolve.mock.calls[0][1]).toBe('fast');
      } finally {
        slow.resolve(response(0.95, 0.05));
        await advancing;
      }
      expect(mocks.resolve).toHaveBeenCalledTimes(2);
    },
  );

  it('drains other routing attempts before reporting a wakeup failure', async () => {
    const slow = Promise.withResolvers<ReturnType<typeof response>>();
    mocks.pending.mockResolvedValue([{ id: 'fast' }, { id: 'slow' }]);
    mocks.claim.mockImplementation(async (_channelId: string, messageId: string) => ({
      ...input,
      messageId,
    }));
    mocks.decide.mockImplementation((_params, options) =>
      options.metadata.messageId === 'slow' ? slow.promise : Promise.resolve(response(0.95, 0.05)),
    );
    mocks.wake.mockImplementation(async (_channelId: string, delay?: number) => {
      if (!delay) throw new Error('Queue unavailable');
    });
    const settled = vi.fn();
    const advancing = run().then(settled, settled);
    try {
      await vi.waitFor(() => expect(mocks.wake).toHaveBeenCalledWith('channel'));
      expect(settled).not.toHaveBeenCalled();
    } finally {
      slow.resolve(response(0.95, 0.05));
      await advancing;
    }
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
    expect(settled).toHaveBeenCalledWith(expect.any(Error));
  });

  it('retains fallback delivery for a reply deferred until its root was routed', async () => {
    mocks.claim.mockResolvedValue({ ...input, fallback: true });
    await run();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.resolve.mock.calls[0][3]).toEqual({
      memberIds: ['coder', 'reviewer'],
      reason: 'No decision model configured',
      status: 'assigned',
    });
  });

  it('never broadcasts after a provider error', async () => {
    mocks.decide.mockRejectedValue(new Error('upstream secret'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run();
    expect(mocks.resolve).toHaveBeenCalledWith(
      'channel',
      'message',
      2,
      expect.objectContaining({ status: 'unassigned' }),
    );
    expect(JSON.stringify(mocks.resolve.mock.calls)).not.toContain('upstream secret');
  });

  it('aborts a timed-out call and ignores a late success', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let finish!: (value: ReturnType<typeof response>) => void;
    mocks.decide.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = run();
    await vi.advanceTimersByTimeAsync(CHANNEL_ROUTING_TIMEOUT_MS + 1);
    await pending;
    const signal = mocks.decide.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(true);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve.mock.calls[0][3].status).toBe('unassigned');
    finish(response(0.99, 0.01));
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });

  it('does not retry a stale write-back or create jobs itself', async () => {
    mocks.resolve.mockResolvedValue(false);
    await run();
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(mocks.wake).not.toHaveBeenCalledWith('channel');
  });

  it('settles pending messages without broadcasting when routing was disabled', async () => {
    mocks.resolveConfig.mockResolvedValue(null);
    await run();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.resolve.mock.calls[0][3].status).toBe('unassigned');
  });

  it('does not bypass a client-only provider', async () => {
    mocks.relay.mockResolvedValue({ executionSite: 'client' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.resolve.mock.calls[0][3].status).toBe('unassigned');
  });

  it.each(['', 'x'.repeat(12_001)])(
    'does not guess about an empty or oversized request',
    async (message) => {
      mocks.claim.mockResolvedValue({ ...input, message });
      await run();
      expect(mocks.decide).not.toHaveBeenCalled();
      expect(mocks.resolve.mock.calls[0][3].status).toBe('unassigned');
    },
  );

  it('leaves pending work recoverable if queue publication fails', async () => {
    mocks.wake.mockRejectedValue(new Error('queue down'));
    await expect(run()).rejects.toThrow('queue down');
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});
