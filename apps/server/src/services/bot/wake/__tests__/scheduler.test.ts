// @vitest-environment node
import {
  handleWakeFlush,
  isWakeSchedulerAvailable,
  recordWakeRunOutcome,
  resolveWakeScheduler,
} from '../scheduler';

const mocks = vi.hoisted(() => ({
  botWake: {
    mutateScheduler: vi.fn(),
    recordBotSpoke: vi.fn(),
    recordSilentWake: vi.fn(),
    recordStandDown: vi.fn(),
    rememberMessages: vi.fn(),
  },
  isLocal: { value: false },
  scheduleMessage: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({ redisService: { botWake: mocks.botWake } }));
vi.mock('@/server/services/queue/impls', () => ({
  LocalQueueServiceImpl: class LocalQueueServiceImpl {},
}));
vi.mock('@/server/services/queue', async () => {
  const { LocalQueueServiceImpl } = await import('@/server/services/queue/impls');

  return {
    QueueService: class {
      getImpl() {
        return mocks.isLocal.value ? new LocalQueueServiceImpl() : {};
      }
      isLocalExecution() {
        return mocks.isLocal.value;
      }
      scheduleMessage = mocks.scheduleMessage;
    },
  };
});
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.test' } }));
vi.mock('@/server/workflows/agentSignal', () => ({
  agentSignalScopeFlowControl: (scopeKey: string) => ({
    key: `agent-signal.run.scope.${scopeKey.replaceAll(/[^\w.-]/g, '_')}`,
    parallelism: 1,
  }),
}));
vi.mock('../../deferredReplay', () => ({ runDeferredReplay: vi.fn() }));

const enabled = { botWake: { enabled: true, scheduler: { mode: 'enforce' } } };

describe('wake scheduler wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLocal.value = false;
  });

  describe('resolveWakeScheduler', () => {
    it.each([
      { expected: false, name: 'no settings', settings: {} },
      {
        expected: false,
        name: 'bot-wake enabled but scheduler off (default)',
        settings: { botWake: { enabled: true } },
      },
      {
        expected: false,
        name: 'scheduler enforce but bot-wake disabled',
        settings: { botWake: { scheduler: { mode: 'enforce' } } },
      },
      {
        expected: false,
        name: 'scheduler enforce but bot-wake mode off',
        settings: { botWake: { enabled: true, mode: 'off', scheduler: { mode: 'enforce' } } },
      },
      { expected: true, name: 'enabled with the scheduler enforcing', settings: enabled },
      {
        expected: true,
        name: 'switched on in the settings form with batching on',
        settings: { botWakeEnabled: true, botWakeSchedulerMode: 'enforce' },
      },
      {
        expected: false,
        name: 'switched on in the settings form, batching left off',
        settings: { botWakeEnabled: true, botWakeSchedulerMode: 'off' },
      },
      {
        expected: false,
        name: 'batching on in the settings form but bot-wake off',
        settings: { botWakeEnabled: false, botWakeSchedulerMode: 'enforce' },
      },
    ])('$name -> available=$expected', ({ expected, settings }) => {
      expect(!!resolveWakeScheduler('discord', 'app', settings)).toBe(expected);
    });

    it('is unavailable on the in-process queue: a lost timer must not hold a message', () => {
      mocks.isLocal.value = true;

      expect(isWakeSchedulerAvailable()).toBe(false);
      expect(resolveWakeScheduler('discord', 'app', enabled)).toBeUndefined();
    });
  });

  it('books its flush through the queue as a delayed message with a dedupe id', async () => {
    mocks.botWake.mutateScheduler.mockImplementation(
      async (_key, mutate) => mutate(undefined).result,
    );
    const scheduler = resolveWakeScheduler('discord', 'app', enabled)!;

    await scheduler.submit({
      channelKey: 'discord:app:g:c',
      messages: [{ id: 'm1', threadId: 'discord:g:c' }],
    });

    const message = mocks.scheduleMessage.mock.calls[0][0];
    expect(message.endpoint).toBe('https://app.test/api/agent/webhooks/bot-wake-flush');
    expect(message.delay).toBeGreaterThan(19_000);
    expect(message.delay).toBeLessThanOrEqual(20_000);
    // Same per-scopeKey serialization Agent Signal runs use.
    expect(message.flowControl).toEqual({
      key: 'agent-signal.run.scope.discord_app_g_c',
      parallelism: 1,
    });
    expect(message.deduplicationId).toMatch(/^bot-wake-flush:discord:app:g:c:\d+$/);
    expect(message.payload).toMatchObject({
      applicationId: 'app',
      channelKey: 'discord:app:g:c',
      platform: 'discord',
    });
  });

  describe('recordWakeRunOutcome', () => {
    const base = {
      applicationId: 'app',
      platform: 'discord',
      platformThreadId: 'discord:g:c:t',
      settings: { botWake: { enabled: true, rules: { windowSeconds: 120 } } },
    };

    it('opens the follow-up window on both the channel and the thread when the bot spoke', async () => {
      await recordWakeRunOutcome({ ...base, spoke: true });

      expect(mocks.botWake.recordBotSpoke).toHaveBeenCalledWith(
        ['discord:app:g:c', 'discord:app:g:c:t'],
        expect.any(Number),
        120_000,
      );
      expect(mocks.botWake.recordSilentWake).not.toHaveBeenCalled();
    });

    it('counts a silent follow-up wake against the budget', async () => {
      await recordWakeRunOutcome({ ...base, spoke: false, wakeKind: 'followup' });

      expect(mocks.botWake.recordSilentWake).toHaveBeenCalledWith([
        'discord:app:g:c',
        'discord:app:g:c:t',
      ]);
      expect(mocks.botWake.recordBotSpoke).not.toHaveBeenCalled();
    });

    it('does not count silence on a run the user asked for', async () => {
      await recordWakeRunOutcome({ ...base, spoke: false, wakeKind: 'mention' });

      expect(mocks.botWake.recordSilentWake).not.toHaveBeenCalled();
    });

    it('steps back from the thread it replied in for 30 minutes when the agent stood down', async () => {
      const before = Date.now();
      await recordWakeRunOutcome({ ...base, spoke: true, standDown: true });

      // The thread only: the rest of the channel is not what the bot was told to leave.
      expect(mocks.botWake.recordStandDown).toHaveBeenCalledWith(
        'discord:app:g:c:t',
        expect.any(Number),
      );
      const until = mocks.botWake.recordStandDown.mock.calls[0][1] as number;
      expect(until - before).toBeGreaterThanOrEqual(30 * 60 * 1000);
      expect(until - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);

      mocks.botWake.recordStandDown.mockClear();
      await recordWakeRunOutcome({ ...base, spoke: false, wakeKind: 'followup' });
      await recordWakeRunOutcome({ ...base, settings: {}, spoke: true, standDown: true });
      expect(mocks.botWake.recordStandDown).not.toHaveBeenCalled();
    });

    describe('what the bot said', () => {
      const spoken = { id: 'op-1', text: 'Shipped it.' };

      it('is kept in the shared log of the channel and the thread, as the bot', async () => {
        await recordWakeRunOutcome({ ...base, spoke: true, spoken });

        expect(mocks.botWake.rememberMessages).toHaveBeenCalledWith(
          ['discord:g:c', 'discord:g:c:t'],
          [
            expect.objectContaining({
              authorId: 'app',
              id: 'bot:op-1',
              isBot: true,
              text: 'Shipped it.',
            }),
          ],
        );
      });

      it.each([
        { name: 'the bot stayed silent', input: { spoke: false, spoken } },
        { name: 'there is no text to keep', input: { spoke: true, spoken: { id: 'op-1' } } },
        {
          name: 'it was a direct message',
          input: { platformThreadId: 'discord:@me:dm1', spoke: true, spoken },
        },
        { name: 'the platform has no log yet', input: { platform: 'slack', spoke: true, spoken } },
      ])('is not kept when $name', async ({ input }) => {
        await recordWakeRunOutcome({ ...base, ...input });

        expect(mocks.botWake.rememberMessages).not.toHaveBeenCalled();
      });

      it('never fails the run bookkeeping when the log write fails', async () => {
        mocks.botWake.rememberMessages.mockRejectedValueOnce(new Error('redis down'));
        mocks.botWake.mutateScheduler.mockResolvedValue({ decisions: [], effects: [] });

        await expect(
          recordWakeRunOutcome({ ...base, settings: enabled, spoke: true, spoken }),
        ).resolves.toBeUndefined();
        expect(mocks.botWake.recordBotSpoke).toHaveBeenCalled();
        expect(mocks.botWake.mutateScheduler).toHaveBeenCalled();
      });

      it('is not kept for a bot without bot-wake', async () => {
        await recordWakeRunOutcome({ ...base, settings: {}, spoke: true, spoken });

        expect(mocks.botWake.rememberMessages).not.toHaveBeenCalled();
      });
    });

    it('does nothing for a bot without bot-wake', async () => {
      await recordWakeRunOutcome({ ...base, settings: {}, spoke: true });

      expect(mocks.botWake.recordBotSpoke).not.toHaveBeenCalled();
    });

    it('frees the scheduler channel when the run is done', async () => {
      mocks.botWake.mutateScheduler.mockResolvedValue({ decisions: [], effects: [] });
      await recordWakeRunOutcome({ ...base, settings: enabled, spoke: true });

      expect(mocks.botWake.mutateScheduler).toHaveBeenCalledWith(
        'discord:app:g:c',
        expect.any(Function),
      );
    });
  });

  describe('handleWakeFlush', () => {
    const payload = {
      applicationId: 'app',
      at: 1,
      channelKey: 'discord:app:g:c',
      platform: 'discord',
    };

    it('flushes with the bot’s current settings', async () => {
      mocks.botWake.mutateScheduler.mockResolvedValue({ decisions: [], effects: [] });
      const load = vi.fn(async () => ({ settings: enabled, userId: 'owner' }));
      await handleWakeFlush(payload, load, { rollout: async () => true });

      expect(load).toHaveBeenCalledWith('discord', 'app');
      expect(mocks.botWake.mutateScheduler).toHaveBeenCalledWith(
        'discord:app:g:c',
        expect.any(Function),
      );
    });

    it('does nothing once the owner switched the scheduler off or deleted the bot', async () => {
      const rollout = async () => true;
      await handleWakeFlush(
        payload,
        async () => ({ settings: { botWake: { enabled: true } }, userId: 'owner' }),
        { rollout },
      );
      await handleWakeFlush(payload, async () => undefined, { rollout });

      expect(mocks.botWake.mutateScheduler).not.toHaveBeenCalled();
    });

    it('drops the parked batch instead of replaying it once the rollout is switched off', async () => {
      const rollout = vi.fn(async () => false);

      await handleWakeFlush(payload, async () => ({ settings: enabled, userId: 'owner' }), {
        rollout,
      });

      expect(rollout).toHaveBeenCalledWith('owner');
      expect(mocks.botWake.mutateScheduler).not.toHaveBeenCalled();
    });
  });
});
