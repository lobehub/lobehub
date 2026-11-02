import type { AgentSignalSource, BaseSignal, ExecutorResult } from '@lobechat/agent-signal';
import { createSignal } from '@lobechat/agent-signal';
import type { QuickNoteRunDecision } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeProcessorContext } from '../runtime/context';
import type { AgentSignalMiddlewareInstallContext } from '../runtime/middleware';
import type { QuickNotePolicyOptions } from './quickNoteAnalyze';
import {
  createQuickNoteAnalyzePolicy,
  createQuickNoteAnalyzeSourceHandler,
  QUICK_NOTE_PROPOSAL_DOMAIN_KEY,
} from './quickNoteAnalyze';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES, AGENT_SIGNAL_POLICY_SIGNAL_TYPES } from './types';

const runId = '11111111-1111-1111-1111-111111111111';

const decision: QuickNoteRunDecision = {
  decisionMode: 'emulated',
  evidence: '"调研一下"',
  preset: 'research',
  presetScores: { research: 4 },
  primary: 'delegate',
  scores: { delegate: 4, enrich: 2, keep: 0, link: 0 },
};

const createOptions = (
  overrides: Partial<QuickNotePolicyOptions> = {},
): QuickNotePolicyOptions => ({
  completeWithoutGeneration: vi.fn().mockResolvedValue({ run: { id: runId } }),
  dispatchGeneration: vi.fn().mockResolvedValue({ operationId: 'op-1' }),
  judgeContentChange: vi
    .fn()
    .mockResolvedValue({ baselineRunId: runId, probability: 1, status: 'changed' }),
  judgeRun: vi.fn().mockResolvedValue({
    decision,
    plan: {
      delegate: { autoApply: true, preset: 'research', score: 4 },
      enrich: true,
      link: false,
    },
    quickNoteId: 'qn_1',
    runId,
  }),
  markProposalsStale: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

/** Installs the policy and exposes its handlers by node type. */
const install = (options: QuickNotePolicyOptions) => {
  const handlers = new Map<string, { handle: (...args: any[]) => any; id: string }>();
  const context: AgentSignalMiddlewareInstallContext = {
    handleAction: (handler) => handlers.set(handler.listen as string, handler),
    handleSignal: (handler) => handlers.set(handler.listen as string, handler),
    handleSource: (handler) => handlers.set(handler.listen as string, handler),
  };
  void createQuickNoteAnalyzePolicy(options).install(context);
  return handlers;
};

const createContext = (guard: { lastEventAt?: number } = {}): RuntimeProcessorContext => ({
  now: () => 1_000_000,
  runtimeState: {
    getGuardState: vi.fn().mockResolvedValue(guard),
    touchGuardState: vi.fn().mockResolvedValue({}),
  },
  scopeKey: 'quick-note:qn_1',
});

const source = (sourceType: string, payload: Record<string, unknown>): AgentSignalSource => ({
  chain: { chainId: `chain:${runId}`, rootSourceId: runId },
  payload,
  scope: { userId: 'user-1' },
  scopeKey: 'quick-note:qn_1',
  sourceId: `${sourceType}:1`,
  sourceType,
  timestamp: 1,
});

const intentSignal = (plan: Record<string, unknown>): BaseSignal =>
  createSignal({
    payload: { decision, plan, quickNoteId: 'qn_1', runId },
    signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteIntentDecided,
    source: source('quick_note.analyze.requested', {}),
  });

describe('Quick Note analyze source', () => {
  it('judges the claimed Run and emits quick_note.intent.decided', async () => {
    const options = createOptions();
    const handler = createQuickNoteAnalyzeSourceHandler(options);

    const result = await handler.handle({
      ...source('quick_note.analyze.requested', {
        quickNoteId: 'qn_1',
        runId,
        sourceHistoryId: 'history-1',
        trigger: 'manual',
        userId: 'user-1',
      }),
      sourceType: 'quick_note.analyze.requested',
    } as any);

    expect(options.judgeRun).toHaveBeenCalledWith(runId);
    expect(result).toMatchObject({
      signals: [
        {
          payload: { decision, quickNoteId: 'qn_1', runId },
          signalType: 'quick_note.intent.decided',
        },
      ],
      status: 'dispatch',
    });
  });

  it('concludes with source linkage when the Run is unavailable', async () => {
    const handler = createQuickNoteAnalyzeSourceHandler(
      createOptions({ judgeRun: vi.fn().mockResolvedValue(undefined) }),
    );

    const result = await handler.handle({
      ...source('quick_note.analyze.requested', {
        quickNoteId: 'qn_1',
        runId,
        sourceHistoryId: 'history-1',
        trigger: 'automatic',
        userId: 'user-1',
      }),
      sourceType: 'quick_note.analyze.requested',
    } as any);

    expect(result).toEqual({
      concluded: {
        quickNoteId: 'qn_1',
        reason: 'run_unavailable',
        runId,
        sourceHistoryId: 'history-1',
        trigger: 'automatic',
      },
      status: 'conclude',
    });
  });
});

describe('Quick Note intent router', () => {
  it('completes a keep-only Run without the follow-up Agent', async () => {
    const handlers = install(createOptions());
    const router = handlers.get(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteIntentDecided)!;

    const result = await router.handle(
      intentSignal({ enrich: false, link: false }),
      createContext(),
    );

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteComplete,
      payload: { quickNoteId: 'qn_1', runId },
    });
  });

  it.each([
    [{ enrich: true, link: false }],
    [{ enrich: false, link: true }],
    [{ delegate: { autoApply: false, preset: 'research', score: 3 }, enrich: false, link: false }],
  ])('generates once for planned output %o', async (plan) => {
    const handlers = install(createOptions());
    const router = handlers.get(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteIntentDecided)!;

    const result = await router.handle(intentSignal(plan), createContext());

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteGenerate,
      payload: { plan, runId },
    });
  });

  it('runs the planned action through the service', async () => {
    const options = createOptions();
    const handlers = install(options);
    const router = handlers.get(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteIntentDecided)!;
    const { actions } = await router.handle(
      intentSignal({ enrich: true, link: false }),
      createContext(),
    );

    const result: ExecutorResult = await handlers
      .get(AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteGenerate)!
      .handle(actions[0], createContext());

    expect(options.dispatchGeneration).toHaveBeenCalledWith(runId);
    expect(result).toMatchObject({ output: { operationId: 'op-1' }, status: 'applied' });
  });

  it('reports a failed action without throwing', async () => {
    const options = createOptions({
      completeWithoutGeneration: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const handlers = install(options);
    const router = handlers.get(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteIntentDecided)!;
    const { actions } = await router.handle(
      intentSignal({ enrich: false, link: false }),
      createContext(),
    );

    const result: ExecutorResult = await handlers
      .get(AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteComplete)!
      .handle(actions[0], createContext());

    expect(result).toMatchObject({ error: { message: 'db down' }, status: 'failed' });
  });
});

describe('Quick Note content change', () => {
  // The sweep emits the debounced check without a baseline; the service resolves it.
  const contentChanged = () =>
    source('quick_note.content.changed', { quickNoteId: 'qn_1', userId: 'user-1' });

  it('marks Proposals stale only after the meaning changed', async () => {
    const options = createOptions();
    const handlers = install(options);
    const context = createContext();

    const result = await handlers
      .get('quick_note.content.changed')!
      .handle(contentChanged(), context);
    const signal = result.signals[0];
    const routed = await handlers
      .get(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteContentMeaningChanged)!
      .handle(signal, context);
    await handlers
      .get(AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteMarkProposalsStale)!
      .handle(routed.actions[0], context);

    expect(options.judgeContentChange).toHaveBeenCalledWith({
      baselineRunId: undefined,
      quickNoteId: 'qn_1',
    });
    expect(signal.payload).toMatchObject({ baselineRunId: runId, quickNoteId: 'qn_1' });
    expect(options.markProposalsStale).toHaveBeenCalledWith('qn_1');
  });

  it.each(['unchanged', 'equivalent'] as const)(
    'leaves Proposals alone when %s',
    async (status) => {
      const options = createOptions({
        judgeContentChange: vi
          .fn()
          .mockResolvedValue(
            status === 'unchanged'
              ? { baselineRunId: runId, probability: 0.1, status }
              : { baselineRunId: runId, status },
          ),
      });
      const handlers = install(options);

      const result = await handlers
        .get('quick_note.content.changed')!
        .handle(contentChanged(), createContext());

      expect(result).toMatchObject({ concluded: { status }, status: 'conclude' });
      expect(options.markProposalsStale).not.toHaveBeenCalled();
    },
  );

  /** @example The debounce lives in the producer; every delivered check runs. */
  it('runs every delivered check instead of throttling it', async () => {
    const options = createOptions();
    const handlers = install(options);
    const context = createContext({ lastEventAt: 1_000_000 - 1 });

    await handlers.get('quick_note.content.changed')!.handle(contentChanged(), context);
    await handlers.get('quick_note.content.changed')!.handle(contentChanged(), context);

    expect(options.judgeContentChange).toHaveBeenCalledTimes(2);
  });

  it('concludes without a model call when there is nothing to protect', async () => {
    const options = createOptions({
      judgeContentChange: vi.fn().mockResolvedValue({ status: 'unavailable' }),
    });
    const handlers = install(options);

    const result = await handlers
      .get('quick_note.content.changed')!
      .handle(contentChanged(), createContext());

    expect(result).toMatchObject({ concluded: { status: 'unavailable' }, status: 'conclude' });
    expect(options.markProposalsStale).not.toHaveBeenCalled();
  });
});

describe('Quick Note proposal decided', () => {
  it('records a receipt without calling any Agent', async () => {
    const append = vi.fn();
    const write = vi.fn();
    const options = createOptions({
      procedure: { now: () => 42, receiptStore: { append }, recordStore: { write } },
    });
    const handlers = install(options);

    const result = await handlers.get('quick_note.proposal.decided')!.handle(
      source('quick_note.proposal.decided', {
        decision: 'dismissed',
        edited: false,
        kind: 'task',
        preset: 'research',
        proposalId: 'p1',
        quickNoteId: 'qn_1',
        reason: 'not now',
        runId,
        userId: 'user-1',
        via: 'user',
      }),
      createContext(),
    );

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        domainKey: QUICK_NOTE_PROPOSAL_DOMAIN_KEY,
        intentClass: 'task:dismissed',
        status: 'handled',
      }),
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        domainKey: QUICK_NOTE_PROPOSAL_DOMAIN_KEY,
        scopeKey: 'quick-note:qn_1',
        summary: 'Quick Note task proposal dismissed: not now',
      }),
    );
    expect(result).toMatchObject({
      signals: [{ signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteProposalFeedback }],
      status: 'dispatch',
    });
    expect(options.judgeRun).not.toHaveBeenCalled();
    expect(options.dispatchGeneration).not.toHaveBeenCalled();
  });
});
