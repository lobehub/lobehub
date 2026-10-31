// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); the models are mocked, so the
// handle it returns is never dereferenced.
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));

const mockFindBot = vi.fn();
const botModelCtor = vi.fn();
vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: vi.fn(function (...args: unknown[]) {
    botModelCtor(...args);
    return { findById: mockFindBot };
  }),
}));

const mockListByScope = vi.fn();
const mockSummaryByScope = vi.fn();
const mockFindDecision = vi.fn();
const mockAddLabel = vi.fn();
const mockListLabels = vi.fn();
const decisionModelCtor = vi.fn();
vi.mock('@/database/models/signalDecision', () => ({
  SCOPE_READ_DEFAULT_DAYS: 30,
  SCOPE_READ_MAX_LIMIT: 50,
  SignalDecisionModel: vi.fn(function (...args: unknown[]) {
    decisionModelCtor(...args);
    return {
      addLabel: mockAddLabel,
      findById: mockFindDecision,
      listLabels: mockListLabels,
      listByScope: mockListByScope,
      summaryByScope: mockSummaryByScope,
    };
  }),
}));

vi.mock('@/server/services/bot/BotMessageRouter/wakeDecision', () => ({
  BOT_WAKE_FOLLOWUP_REASONS: ['watch-keyword', 'in-duty'],
}));

vi.mock('@/server/services/bot/noReplyLabel', () => ({
  NO_REPLY_LABEL_SOURCE: 'agent:no_reply',
}));

const { agentBotWakeRouter } = await import('./agentBotWake');

const BOT_ID = 'bot-1';
const DECISION_ID = '7f1c2a40-5b7e-4d8a-9f61-0c2b3d4e5f60';
/** A teammate's bot in the caller's workspace: decisions live under its owner and that workspace. */
const bot = {
  applicationId: 'app-1',
  id: BOT_ID,
  platform: 'discord',
  userId: 'owner-1',
  workspaceId: 'ws-1',
};
const ctx: any = { serverDB: {}, userId: 'caller-1', workspaceId: 'ws-1' };

const decision = (overrides = {}) => ({
  id: DECISION_ID,
  outcome: 'wake',
  scopeKey: 'discord:app-1',
  userId: 'owner-1',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFindBot.mockResolvedValue(bot);
  mockFindDecision.mockResolvedValue(decision());
  mockAddLabel.mockImplementation(async (_id, input) => ({
    createdAt: new Date('2026-10-30T00:00:00Z'),
    label: input.label,
    metadata: input.metadata,
  }));
  mockListByScope.mockResolvedValue({ items: [] });
  mockSummaryByScope.mockResolvedValue({
    defer: 0,
    followupWakes: 0,
    labels: {},
    skip: 0,
    total: 0,
    wake: 0,
  });
});

describe('agentBotWakeRouter', () => {
  describe('bot scope', () => {
    it('looks the bot up in the caller’s scope and reads under the bot owner’s channel', async () => {
      const caller = agentBotWakeRouter.createCaller(ctx);

      await caller.listWakeDecisions({ botId: BOT_ID });

      expect(botModelCtor).toHaveBeenCalledWith({}, 'caller-1', {}, 'ws-1');
      expect(mockFindBot).toHaveBeenCalledWith(BOT_ID);
      // The record's own scope, not the caller's: the read must match the `workspace_id` the wake
      // pipeline wrote, so a bot recreated elsewhere cannot read the earlier scope's history.
      expect(decisionModelCtor).toHaveBeenCalledWith({}, 'owner-1', 'ws-1');
      expect(mockListByScope).toHaveBeenCalledWith(
        expect.objectContaining({ scopeKey: 'discord:app-1' }),
      );
    });

    it.each([
      ['listWakeDecisions', (c: any) => c.listWakeDecisions({ botId: BOT_ID })],
      ['getWakeSummary', (c: any) => c.getWakeSummary({ botId: BOT_ID })],
      [
        'labelWakeDecision',
        (c: any) =>
          c.labelWakeDecision({ botId: BOT_ID, decisionId: DECISION_ID, label: 'correct' }),
      ],
    ])('%s refuses a bot outside the caller’s scope', async (_name, call) => {
      mockFindBot.mockResolvedValue(undefined);

      await expect(call(agentBotWakeRouter.createCaller(ctx))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(decisionModelCtor).not.toHaveBeenCalled();
    });
  });

  describe('listWakeDecisions', () => {
    it('maps filters onto the scope read', async () => {
      await agentBotWakeRouter.createCaller(ctx).listWakeDecisions({
        botId: BOT_ID,
        followupOnly: true,
        outcome: 'skip',
        unmarkedOnly: true,
      });

      expect(mockListByScope).toHaveBeenCalledWith(
        expect.objectContaining({
          finalReasons: ['watch-keyword', 'in-duty'],
          labeled: { by: 'user', has: false },
          outcome: 'skip',
        }),
      );
    });

    it('splits current labels into the agent’s silence and the owner’s mark', async () => {
      mockListByScope.mockResolvedValue({
        items: [
          {
            finalReason: 'watch-keyword',
            id: DECISION_ID,
            labels: [
              { label: 'false_wake', metadata: { reason: 'off_topic' }, source: 'agent:no_reply' },
              { label: 'correct', metadata: { rationale: 'fine' }, source: 'user' },
              { label: 'correct', metadata: {}, source: 'llm_judge' },
            ],
            outcome: 'wake',
            verdicts: [
              {
                confidence: 0.83,
                latencyMs: 400,
                mode: 'enforce',
                policyId: 'bot-wake:classifier',
                reason: 'score 0.83',
                verdict: 'allow',
                version: 1,
              },
            ],
          },
        ],
      });

      const { items } = await agentBotWakeRouter
        .createCaller(ctx)
        .listWakeDecisions({ botId: BOT_ID });

      expect(items[0]).toMatchObject({
        agentLabel: { label: 'false_wake', reason: 'off_topic' },
        followup: true,
        judge: { kind: 'addressed', score: 0.83, verdict: 'allow' },
        userLabel: { label: 'correct', note: 'fine' },
      });
      expect(items[0]).not.toHaveProperty('labels');
      expect(items[0]).not.toHaveProperty('verdicts');
    });
  });

  describe('getWakeSummary', () => {
    it('folds label counts into silenced and marked totals', async () => {
      mockSummaryByScope.mockResolvedValue({
        defer: 1,
        followupWakes: 2,
        labels: {
          'agent:no_reply': { correct: 1, dup_wake: 1, false_wake: 2 },
          'user': { correct: 3, missed_wake: 1 },
        },
        skip: 4,
        total: 10,
        wake: 5,
      });

      const summary = await agentBotWakeRouter.createCaller(ctx).getWakeSummary({ botId: BOT_ID });

      expect(summary).toMatchObject({
        followupWakes: 2,
        marked: 4,
        markedByLabel: { correct: 3, missed_wake: 1 },
        silenced: 3,
        wake: 5,
      });
    });
  });

  describe('labelWakeDecision', () => {
    it('appends the owner’s mark with who set it and where', async () => {
      await agentBotWakeRouter.createCaller(ctx).labelWakeDecision({
        botId: BOT_ID,
        decisionId: DECISION_ID,
        label: 'false_wake',
        note: '  not for the bot ',
      });

      expect(mockAddLabel).toHaveBeenCalledWith(DECISION_ID, {
        actor: 'caller-1',
        label: 'false_wake',
        metadata: { rationale: 'not for the bot', surface: 'bot_settings' },
        source: 'user',
      });
    });

    it('refuses a decision from another channel of the same owner', async () => {
      mockFindDecision.mockResolvedValue(decision({ scopeKey: 'discord:app-2' }));

      await expect(
        agentBotWakeRouter
          .createCaller(ctx)
          .labelWakeDecision({ botId: BOT_ID, decisionId: DECISION_ID, label: 'correct' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockAddLabel).not.toHaveBeenCalled();
    });

    it('refuses a decision the bot owner does not own', async () => {
      // The model is scoped to the owner, so another user's decision is not found.
      mockFindDecision.mockResolvedValue(undefined);

      await expect(
        agentBotWakeRouter
          .createCaller(ctx)
          .labelWakeDecision({ botId: BOT_ID, decisionId: DECISION_ID, label: 'correct' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockAddLabel).not.toHaveBeenCalled();
    });

    it.each([
      ['wake', 'missed_wake'],
      ['skip', 'false_wake'],
    ])('refuses to mark a %s as %s', async (outcome, label) => {
      mockFindDecision.mockResolvedValue(decision({ outcome }));

      await expect(
        agentBotWakeRouter
          .createCaller(ctx)
          .labelWakeDecision({ botId: BOT_ID, decisionId: DECISION_ID, label: label as any }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockAddLabel).not.toHaveBeenCalled();
    });

    it('accepts every mark on a deferred message', async () => {
      mockFindDecision.mockResolvedValue(decision({ outcome: 'defer' }));
      const caller = agentBotWakeRouter.createCaller(ctx);

      for (const label of ['correct', 'false_wake', 'missed_wake'] as const) {
        await caller.labelWakeDecision({ botId: BOT_ID, decisionId: DECISION_ID, label });
      }

      expect(mockAddLabel).toHaveBeenCalledTimes(3);
    });
    it('takes the mark back by appending `cleared`', async () => {
      mockListLabels.mockResolvedValue([
        { label: 'false_wake', source: 'user' },
        { label: 'correct', source: 'llm_judge' },
      ]);

      const result = await agentBotWakeRouter
        .createCaller(ctx)
        .labelWakeDecision({ botId: BOT_ID, decisionId: DECISION_ID, label: null });

      expect(result).toBeNull();
      expect(mockAddLabel).toHaveBeenCalledWith(DECISION_ID, {
        actor: 'caller-1',
        label: 'cleared',
        metadata: { surface: 'bot_settings' },
        source: 'user',
      });
    });

    it.each([
      ['never marked', [{ label: 'correct', source: 'llm_judge' }]],
      ['already taken back', [{ label: 'cleared', source: 'user' }]],
    ])('writes nothing to take back a mark when %s', async (_case, labels) => {
      mockListLabels.mockResolvedValue(labels);

      await expect(
        agentBotWakeRouter
          .createCaller(ctx)
          .labelWakeDecision({ botId: BOT_ID, decisionId: DECISION_ID, label: null }),
      ).resolves.toBeNull();
      expect(mockAddLabel).not.toHaveBeenCalled();
    });
  });
});
