import type {
  AgentSignalSource,
  BaseAction,
  ExecutorResult,
  RuntimeProcessorResult,
  SignalAttempt,
} from '@lobechat/agent-signal';
import { createAction, createSignal } from '@lobechat/agent-signal';
import type {
  SourceQuickNoteAnalyzeRequested,
  SourceQuickNoteContentChanged,
  SourceQuickNoteProposalDecided,
} from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import type { QuickNoteRunDecision } from '@lobechat/types';

import type { AgentSignalProcedureReceipt, AgentSignalProcedureRecord } from '../procedure/types';
import type { RuntimeProcessorContext } from '../runtime/context';
import {
  defineActionHandler,
  defineAgentSignalHandlers,
  defineSignalHandler,
  defineSourceHandler,
} from '../runtime/middleware';
import type { AgentSignalPolicyActionVariant, AgentSignalQuickNoteActionPlan } from './types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES, AGENT_SIGNAL_POLICY_SIGNAL_TYPES } from './types';

/** Procedure domain of Quick Note Proposal reactions. */
export const QUICK_NOTE_PROPOSAL_DOMAIN_KEY = 'quick_note:proposal';

/**
 * Quick Note processing operations the policy drives, bound to one user/workspace scope.
 *
 * Agent Signal only owns this contract. The implementation lives in the Quick Note domain and is
 * injected by the composition root (the Agent Signal workflow runner), so `agentSignal` never
 * imports `quickNote`: Quick Note itself enqueues Agent Signal sources, and a static import in the
 * other direction closes an import cycle.
 */
export interface QuickNoteSignalProcessor {
  /** Completes a Run whose plan needs no follow-up Agent run. */
  completeWithoutGeneration: (runId: string) => Promise<unknown>;
  /** Starts the follow-up Agent run; returns its operation identity. */
  dispatchGeneration: (runId: string) => Promise<{ operationId?: string | null } | undefined>;
  /**
   * Asks whether the note's current text changed meaning since the baseline Run (the latest
   * completed Analyze Run unless `baselineRunId` is given).
   */
  judgeContentChange: (params: {
    baselineRunId?: string;
    quickNoteId: string;
  }) => Promise<
    | { baselineRunId: string; probability: number; status: 'changed' | 'unchanged' }
    | { baselineRunId: string; status: 'equivalent' }
    | { status: 'unavailable' }
  >;
  /** Step 1: judges intent for a claimed Run and records the decision on it. */
  judgeRun: (runId: string) => Promise<
    | {
        decision: QuickNoteRunDecision;
        plan: AgentSignalQuickNoteActionPlan;
        quickNoteId: string;
        runId: string;
      }
    | undefined
  >;
  /** Marks the note's current pending Proposals stale. */
  markProposalsStale: (quickNoteId: string) => Promise<unknown>;
}

/** Dependencies of the Quick Note policy, bound to one user/workspace scope. */
export interface QuickNotePolicyOptions extends QuickNoteSignalProcessor {
  /** Procedure stores for reaction receipts; reactions are only traced when omitted. */
  procedure?: {
    now: () => number;
    receiptStore: { append: (receipt: AgentSignalProcedureReceipt) => Promise<void> };
    recordStore: { write: (record: AgentSignalProcedureRecord) => Promise<void> };
  };
}

/** @deprecated Use {@link QuickNotePolicyOptions}. */
export type QuickNoteAnalyzeSourceHandlerOptions = QuickNotePolicyOptions;

const attempt = (
  startedAt: number,
  completedAt: number,
  status: SignalAttempt['status'],
): SignalAttempt => ({ completedAt, current: 1, startedAt, status });

const conclude = (concluded: Record<string, unknown>) => ({
  concluded,
  status: 'conclude' as const,
});

/**
 * `quick_note.analyze.requested` → step-1 intent judgement → `quick_note.intent.decided`.
 *
 * Interpretation only: the decision call is a model judgement, the Run update records it. The
 * follow-up work is planned by {@link createQuickNoteIntentRouter}.
 */
export const createQuickNoteAnalyzeSourceHandler = (options: QuickNotePolicyOptions) => ({
  handle: async (source: SourceQuickNoteAnalyzeRequested): Promise<RuntimeProcessorResult> => {
    const payload = source.payload;
    if (
      source.sourceType !== AGENT_SIGNAL_SOURCE_TYPES.quickNoteAnalyzeRequested ||
      !payload.runId ||
      !payload.quickNoteId ||
      !payload.sourceHistoryId ||
      !payload.userId
    ) {
      return conclude({ reason: 'invalid_payload' });
    }

    const judged = await options.judgeRun(payload.runId);
    if (!judged) {
      return conclude({
        quickNoteId: payload.quickNoteId,
        reason: 'run_unavailable',
        runId: payload.runId,
        sourceHistoryId: payload.sourceHistoryId,
        trigger: payload.trigger,
      });
    }

    return {
      signals: [
        createSignal({
          payload: {
            decision: judged.decision,
            plan: judged.plan,
            quickNoteId: judged.quickNoteId,
            runId: judged.runId,
          },
          signalId: `${source.sourceId}:signal:intent-decided`,
          signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteIntentDecided,
          source: source as AgentSignalSource,
          timestamp: source.timestamp,
        }),
      ],
      status: 'dispatch',
    };
  },
  id: 'quick-note-analyze-source',
});

/**
 * `quick_note.intent.decided` → one action: complete a keep-only Run, or generate.
 *
 * The score gates were applied when the plan was built; this router only picks the lane. One
 * generation run covers enrich, link, and delegate together.
 */
export const createQuickNoteIntentRouter = () =>
  defineSignalHandler(
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteIntentDecided,
    'quick-note-intent-router',
    async (signal): Promise<RuntimeProcessorResult> => {
      const { plan, quickNoteId, runId } = signal.payload;
      const generate = plan.enrich || plan.link || Boolean(plan.delegate);

      return {
        actions: [
          generate
            ? createAction({
                actionId: `${signal.signalId}:action:generate`,
                actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteGenerate,
                payload: { plan, quickNoteId, runId },
                signal,
              })
            : createAction({
                actionId: `${signal.signalId}:action:complete`,
                actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteComplete,
                payload: { quickNoteId, runId },
                signal,
              }),
        ],
        status: 'dispatch',
      };
    },
  );

const runAction = async (
  action: BaseAction,
  context: RuntimeProcessorContext,
  work: () => Promise<{ detail?: string; output?: Record<string, unknown>; skipped?: boolean }>,
): Promise<ExecutorResult> => {
  const startedAt = context.now();
  try {
    const result = await work();
    return {
      actionId: action.actionId,
      attempt: attempt(startedAt, context.now(), result.skipped ? 'skipped' : 'succeeded'),
      detail: result.detail,
      output: result.output,
      status: result.skipped ? 'skipped' : 'applied',
    };
  } catch (error) {
    return {
      actionId: action.actionId,
      attempt: attempt(startedAt, context.now(), 'failed'),
      error: {
        cause: error,
        code: 'QUICK_NOTE_ACTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
      status: 'failed',
    };
  }
};

const createQuickNoteActionHandlers = (options: QuickNotePolicyOptions) => [
  defineActionHandler(
    AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteComplete,
    'quick-note-complete-action',
    async (action, context) =>
      runAction(action, context, async () => {
        const { runId } = (action as AgentSignalPolicyActionVariant<'action.quick-note.complete'>)
          .payload;
        const completed = await options.completeWithoutGeneration(runId);
        return completed
          ? { output: { runId, status: 'completed' } }
          : { detail: 'Run no longer pending.', skipped: true };
      }),
  ),
  defineActionHandler(
    AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteGenerate,
    'quick-note-generate-action',
    async (action, context) =>
      runAction(action, context, async () => {
        const { runId } = (action as AgentSignalPolicyActionVariant<'action.quick-note.generate'>)
          .payload;
        const run = await options.dispatchGeneration(runId);
        return run?.operationId
          ? { output: { operationId: run.operationId, runId, status: 'dispatched' } }
          : { detail: 'Run no longer pending.', skipped: true };
      }),
  ),
  defineActionHandler(
    AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteMarkProposalsStale,
    'quick-note-mark-stale-action',
    async (action, context) =>
      runAction(action, context, async () => {
        const { quickNoteId } = (
          action as AgentSignalPolicyActionVariant<'action.quick-note.mark-proposals-stale'>
        ).payload;
        await options.markProposalsStale(quickNoteId);
        return { output: { quickNoteId } };
      }),
  ),
];

/**
 * `quick_note.content.changed` → `meaningChanged` boolean → stale marking.
 *
 * Rate limit: the producer debounces. Every real edit pushes the note's
 * `content_check_due_at` back by the idle delay, and the minute sweep emits one source once the
 * edits go quiet. The check compares the note's current text, so no edit inside the window is
 * missed. Without current pending Proposals the check stops before calling the model.
 */
export const createQuickNoteContentChangedSourceHandler = (options: QuickNotePolicyOptions) =>
  defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.quickNoteContentChanged,
    'quick-note-content-changed-source',
    async (source): Promise<RuntimeProcessorResult> => {
      const { baselineRunId, quickNoteId } = (source as SourceQuickNoteContentChanged).payload;
      if (!quickNoteId) return conclude({ reason: 'invalid_payload' });

      const result = await options.judgeContentChange({ baselineRunId, quickNoteId });
      if (result.status !== 'changed') {
        return conclude({
          ...('baselineRunId' in result ? { baselineRunId: result.baselineRunId } : {}),
          quickNoteId,
          status: result.status,
        });
      }

      return {
        signals: [
          createSignal({
            payload: {
              baselineRunId: result.baselineRunId,
              probability: result.probability,
              quickNoteId,
            },
            signalId: `${source.sourceId}:signal:meaning-changed`,
            signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteContentMeaningChanged,
            source,
            timestamp: source.timestamp,
          }),
        ],
        status: 'dispatch',
      };
    },
  );

/** `quick_note.content.meaning_changed` → mark the note's pending Proposals stale. */
export const createQuickNoteMeaningChangedRouter = () =>
  defineSignalHandler(
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteContentMeaningChanged,
    'quick-note-meaning-changed-router',
    async (signal): Promise<RuntimeProcessorResult> => ({
      actions: [
        createAction({
          actionId: `${signal.signalId}:action:mark-stale`,
          actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.quickNoteMarkProposalsStale,
          payload: {
            baselineRunId: signal.payload.baselineRunId,
            quickNoteId: signal.payload.quickNoteId,
          },
          signal,
        }),
      ],
      status: 'dispatch',
    }),
  );

/**
 * `quick_note.proposal.decided` → procedure record + receipt, and a feedback signal.
 *
 * Reactions are only accumulated (future few-shot and threshold tuning data); nothing here calls
 * an Agent.
 */
export const createQuickNoteProposalDecidedSourceHandler = (options: QuickNotePolicyOptions) =>
  defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.quickNoteProposalDecided,
    'quick-note-proposal-decided-source',
    async (source, context): Promise<RuntimeProcessorResult> => {
      const payload = (source as SourceQuickNoteProposalDecided).payload;
      if (!payload.proposalId || !payload.quickNoteId) {
        return conclude({ reason: 'invalid_payload' });
      }

      const signal = createSignal({
        payload,
        signalId: `${source.sourceId}:signal:proposal-feedback`,
        signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.quickNoteProposalFeedback,
        source,
        timestamp: source.timestamp,
      });

      if (options.procedure) {
        const now = options.procedure.now();
        const intentClass = `${payload.kind}:${payload.decision}`;
        const relatedObjects = [
          { objectId: payload.proposalId, objectType: 'quick_note_proposal', relation: 'decided' },
          { objectId: payload.quickNoteId, objectType: 'quick_note', relation: 'source' },
          ...(payload.resultId && payload.resultType
            ? [{ objectId: payload.resultId, objectType: payload.resultType, relation: 'created' }]
            : []),
        ];
        const summary =
          payload.decision === 'accepted'
            ? `Quick Note ${payload.kind} proposal applied${payload.via === 'auto' ? ' automatically' : ''}${payload.edited ? ' after edits' : ''}.`
            : `Quick Note ${payload.kind} proposal dismissed${payload.reason ? `: ${payload.reason}` : '.'}`;
        const record: AgentSignalProcedureRecord = {
          accumulatorRole: 'candidate',
          createdAt: now,
          domainKey: QUICK_NOTE_PROPOSAL_DOMAIN_KEY,
          id: `procedure-record:${source.sourceId}`,
          intentClass,
          refs: { signalIds: [signal.signalId], sourceIds: [source.sourceId] },
          relatedObjects,
          scopeKey: context.scopeKey,
          status: 'handled',
          summary,
        };
        await options.procedure.recordStore.write(record);
        await options.procedure.receiptStore.append({
          createdAt: now,
          domainKey: QUICK_NOTE_PROPOSAL_DOMAIN_KEY,
          id: `procedure-receipt:${record.id}`,
          intentClass,
          recordIds: [record.id],
          relatedObjects,
          scopeKey: context.scopeKey,
          sourceId: source.sourceId,
          status: 'handled',
          summary,
          updatedAt: now,
        });
      }

      return { signals: [signal], status: 'dispatch' };
    },
  );

/**
 * Registers the Quick Note policy: analyze (source → signal → action), content change, and
 * Proposal reactions.
 *
 * Expects:
 * - Dependencies are owner/workspace scoped.
 * - Every source uses `quick-note:<id>` as scope key, so one note's work runs serially.
 */
export const createQuickNoteAnalyzePolicy = (options: QuickNotePolicyOptions) => {
  const analyze = createQuickNoteAnalyzeSourceHandler(options);

  return defineAgentSignalHandlers([
    defineSourceHandler(
      AGENT_SIGNAL_SOURCE_TYPES.quickNoteAnalyzeRequested,
      analyze.id,
      analyze.handle,
    ),
    createQuickNoteIntentRouter(),
    ...createQuickNoteActionHandlers(options),
    createQuickNoteContentChangedSourceHandler(options),
    createQuickNoteMeaningChangedRouter(),
    createQuickNoteProposalDecidedSourceHandler(options),
  ]);
};
