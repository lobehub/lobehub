// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHANNEL_ROUTING_TIMEOUT_MS,
  ChannelRoutingService,
  selectChannelResponders,
} from './ChannelRoutingService';

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  classify: vi.fn(),
  countCall: vi.fn(),
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
vi.mock('@/server/services/conversationWake/classify', () => ({
  createWakeClassify: () => mocks.classify,
}));
vi.mock('@/server/services/conversationWake/dutyJudge', () => ({
  createWakeDutyJudge: () => vi.fn(),
}));
vi.mock('@/server/services/redis', () => ({
  redisService: { botWake: { countClassifierCall: mocks.countCall } },
}));
vi.mock('./notify', () => ({ notifyChannel: mocks.notify }));
vi.mock('./wakeRecords', () => ({ recordChannelWakeDecisions: mocks.record }));
vi.mock('./queue', () => ({ wakeChannel: mocks.wake }));

const input = {
  attempt: 2,
  author: { id: 'sender', name: 'Mia' },
  candidates: [
    {
      agentId: 'agt-coder',
      description: 'Writes code',
      memberId: 'coder',
      name: 'Coder',
      silentWakes: 0,
    },
    {
      agentId: 'agt-reviewer',
      description: 'Reviews code',
      memberId: 'reviewer',
      name: 'Reviewer',
      silentWakes: 0,
    } as Record<string, unknown>,
  ],
  hasAttachments: false,
  history: [
    {
      at: 1,
      author: 'Mia',
      authorId: 'sender',
      content: 'We are fixing the parser',
      id: 'm1',
      isAgent: false,
    },
  ],
  threadId: null,
  message: 'Please implement the fix',
  messageId: 'message',
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
  mocks.resolve.mockResolvedValue({ recipients: ['coder'], status: 'assigned' });
  mocks.countCall.mockResolvedValue(1);
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
    'wakes only the uncertain members as follow-ups that may stay silent (%s)',
    (probability) => {
      const uncertain = { reviewer: { kind: 'followup', reason: 'routing-uncertain' } };
      expect(selectChannelResponders(input.candidates, response(0.05, probability))).toEqual(
        expect.objectContaining({ memberIds: ['reviewer'], status: 'assigned', wakes: uncertain }),
      );
      // A confident pick still owes an answer; only the uncertain one may stay silent.
      expect(selectChannelResponders(input.candidates, response(0.95, probability))).toEqual(
        expect.objectContaining({
          memberIds: ['coder', 'reviewer'],
          status: 'assigned',
          wakes: uncertain,
        }),
      );
    },
  );

  it('does not wake an uncertain member whose silent-wake budget is spent', () => {
    expect(
      selectChannelResponders(input.candidates, response(0.5, 0.5), new Set(['reviewer'])),
    ).toMatchObject({ memberIds: ['coder'], status: 'assigned' });
    expect(
      selectChannelResponders(input.candidates, response(0.05, 0.5), new Set(['reviewer'])),
    ).toMatchObject({ status: 'skipped' });
  });

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

  it('persists uncertain recipients as follow-ups with the decision audit', async () => {
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
        reason: 'Selected by the Channel decision model; uncertain members may stay silent',
        wakes: {
          coder: { kind: 'followup', reason: 'routing-uncertain' },
          reviewer: { kind: 'followup', reason: 'routing-uncertain' },
        },
        details: expect.objectContaining({
          probabilities: JSON.stringify(response(0.51, 0.41).answers),
        }),
      }),
    );
  });

  it('records the members’ decisions once the routing result is applied, and only then', async () => {
    await run();
    expect(mocks.record).toHaveBeenCalledWith(
      {},
      'channel',
      expect.objectContaining({ messageId: 'message' }),
      expect.objectContaining({ memberIds: ['coder'], status: 'assigned' }),
      expect.objectContaining({
        answers: response(0.95, 0.05).answers,
        judgements: expect.any(Array),
      }),
      { recipients: ['coder'], status: 'assigned' },
    );

    mocks.record.mockClear();
    mocks.resolve.mockResolvedValue(null);
    await run();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('records an unassigned applied result after proposing a member', async () => {
    mocks.resolve.mockResolvedValue({ recipients: [], status: 'unassigned' });
    await run();
    expect(mocks.record).toHaveBeenCalledWith(
      {},
      'channel',
      expect.anything(),
      expect.objectContaining({ memberIds: ['coder'], status: 'assigned' }),
      expect.anything(),
      { recipients: [], status: 'unassigned' },
    );
  });

  it('does not call the provider if another worker owns the attempt', async () => {
    mocks.claim.mockResolvedValue(null);
    await run();
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
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
    mocks.resolve.mockResolvedValue(null);
    await run();
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.decide).toHaveBeenCalledTimes(1);
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

describe('members’ own wake rules', () => {
  const run = () => new ChannelRoutingService({} as never).advance('channel');
  const withCandidates = (
    coder: Record<string, unknown>,
    reviewer: Record<string, unknown> = {},
    message = input.message,
  ) =>
    mocks.claim.mockResolvedValue({
      ...input,
      candidates: [
        { ...input.candidates[0], ...coder },
        { ...input.candidates[1], ...reviewer },
      ],
      message,
    });
  // Coder answered Mia a minute ago: her next message is inside its follow-up window.
  const answeredMia = { lastReplyAt: Date.now() - 60_000, lastReplyToUserId: 'sender' };

  it('wakes a member named in the message without asking the decision model', async () => {
    withCandidates({}, {}, 'Reviewer, can you take a look at this?');
    await run();

    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith(
      'channel',
      'message',
      2,
      expect.objectContaining({
        memberIds: ['reviewer'],
        status: 'assigned',
        wakes: { reviewer: { kind: 'followup', named: true, reason: 'named-in-text' } },
      }),
    );
  });

  it('follows up with the member the sender was just talking to', async () => {
    withCandidates(answeredMia);
    mocks.classify.mockResolvedValue({ addressedToBot: 0.9, kind: 'question', reason: 'p=0.9' });
    await run();

    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith(
      'channel',
      'message',
      2,
      expect.objectContaining({
        memberIds: ['coder'],
        wakes: {
          coder: expect.objectContaining({
            followup: expect.objectContaining({ score: 0.9 }),
            kind: 'followup',
            reason: 'followup-window',
          }),
        },
      }),
    );
  });

  it('routes as before when the classifier says the follow-up is not for the member', async () => {
    withCandidates(answeredMia);
    mocks.classify.mockResolvedValue({ addressedToBot: 0.1, kind: 'other', reason: 'p=0.1' });
    await run();

    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledWith(
      'channel',
      'message',
      2,
      expect.objectContaining({ memberIds: ['coder'], status: 'assigned' }),
    );
  });

  it('never routes to a member whose scope keeps it out of unaddressed messages', async () => {
    withCandidates({ wake: { rules: { scope: 'none' } } });
    mocks.decide.mockResolvedValue({
      answers: { reviewer: { probability: 0.9, type: 'boolean' } },
      model: 'jev-1.14.0',
    });
    await run();

    const [request] = mocks.decide.mock.calls[0];
    expect(Object.keys(request.questions)).toEqual(['reviewer']);
    expect(mocks.resolve).toHaveBeenCalledWith(
      'channel',
      'message',
      2,
      expect.objectContaining({ memberIds: ['reviewer'] }),
    );
  });

  it('reads the channel’s defaults under each member’s own settings', async () => {
    mocks.claim.mockResolvedValue({
      ...input,
      candidates: [
        { ...input.candidates[0], wake: { rules: { scope: 'all' } } },
        input.candidates[1],
      ],
      channelWake: { rules: { scope: 'none' } },
    });
    mocks.decide.mockResolvedValue({
      answers: { coder: { probability: 0.9, type: 'boolean' } },
      model: 'jev-1.14.0',
    });
    await run();

    const [request] = mocks.decide.mock.calls[0];
    expect(Object.keys(request.questions)).toEqual(['coder']);
  });

  it('keeps every claim when the arbitration answer is unusable', async () => {
    withCandidates(answeredMia, answeredMia);
    mocks.classify.mockResolvedValue({ addressedToBot: 0.9, kind: 'question', reason: 'p=0.9' });
    mocks.decide.mockResolvedValue({
      answers: { coder: { probability: 0.9, type: 'boolean' } },
      model: 'jev-1.14.0',
    });
    await run();

    expect(mocks.resolve).toHaveBeenCalledWith(
      'channel',
      'message',
      2,
      expect.objectContaining({ memberIds: ['coder', 'reviewer'], status: 'assigned' }),
    );
  });

  it('lets a bot-threads member be chosen in a Thread it follows, not in the main channel', async () => {
    const botThreads = { wake: { rules: { scope: 'bot-threads' } } };
    const questions = async (threadId: string | null) => {
      mocks.decide.mockClear();
      mocks.claim.mockResolvedValue({
        ...input,
        candidates: [{ ...input.candidates[0], ...botThreads }, input.candidates[1]],
        threadId,
      });
      await run();
      return Object.keys(mocks.decide.mock.calls[0][0].questions);
    };

    expect(await questions('thread')).toEqual(['coder', 'reviewer']);
    expect(await questions(null)).toEqual(['reviewer']);
  });

  it('does not read the generic label of an unnamed member as its name', async () => {
    withCandidates({ name: 'Agent' }, {}, 'The agent broke the build again');
    await run();

    expect(mocks.decide).toHaveBeenCalledTimes(1);
  });

  it('keeps the members its own rules woke when arbitration fails', async () => {
    withCandidates(answeredMia, answeredMia);
    mocks.classify.mockResolvedValue({ addressedToBot: 0.9, kind: 'question', reason: 'p=0.9' });
    mocks.decide.mockRejectedValue(new Error('provider down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run();

    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledWith(
      'channel',
      'message',
      2,
      expect.objectContaining({ memberIds: ['coder', 'reviewer'], status: 'assigned' }),
    );
  });
});
