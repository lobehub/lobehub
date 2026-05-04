import type {
  RuntimeDispatchProcessorResult,
  RuntimeProcessorResult,
} from '@lobechat/agent-signal';

import type {
  AgentSignalProcedureMarker,
  AgentSignalProcedureRecord,
  ProcedureAccumulatorScoreResult,
} from '../../procedure';
import { createProcedureKey, createProcedureMarker } from '../../procedure';
import type {
  FeedbackDomainSignal,
  ProcedureProcessorStateService,
  SatisfiedSkillFeedbackDomainSignal,
} from '../../processors/procedure';
import {
  accumulateSignal,
  scoreIncrease,
  suppressHandled,
  transitionScoredProcedure,
  transitionSuppressedProcedure,
} from '../../processors/procedure';
import type { RuntimeProcessorContext } from '../../runtime/context';
import { defineSignalHandler } from '../../runtime/middleware';
import type {
  AgentSignalActionServices,
  NonSatisfiedSkillActionServiceSignal,
} from '../../services/actionServices';
import { createDefaultActionServices } from '../../services/actionServices';
import type { ProcedureMarkerSuppressInput, ProcedureStateService } from '../../services/types';
import type { SignalFeedbackDomainMemory } from '../types';
import { AGENT_SIGNAL_POLICY_SIGNAL_TYPES } from '../types';

/**
 * Weak positive skill feedback needs repeated observations before the accumulator emits.
 */
const SATISFIED_SKILL_CHEAP_SCORE_DELTA = 0.6;

/**
 * Marker reader dependency used by both legacy and procedure-state planner options.
 */
interface FeedbackActionMarkerReader {
  /** Checks whether an active handled marker suppresses the current feedback signal. */
  shouldSuppress: (input: ProcedureMarkerSuppressInput) => Promise<boolean>;
}

/**
 * Procedure dependencies used by the feedback action planner.
 */
export interface FeedbackActionProcedureDeps {
  /** Appends candidate records and optionally scores accumulated buckets. */
  accumulator?: {
    appendAndScore?: (
      record: AgentSignalProcedureRecord,
    ) => Promise<ProcedureAccumulatorScoreResult | undefined>;
    appendRecord: (record: AgentSignalProcedureRecord) => Promise<void>;
  };
  /** Reads handled markers for suppression when a full procedure state service is not supplied. */
  markerReader?: FeedbackActionMarkerReader;
  /** Writes accumulated markers after a bucket score is emitted. */
  markerStore?: { write: (marker: AgentSignalProcedureMarker) => Promise<void> };
  /** Provides a consistent millisecond timestamp for procedure writes. */
  now?: () => number;
  /** Facade used by the migrated procedure processors. */
  procedureState?: ProcedureStateService;
  /** Writes candidate procedure records. */
  recordStore?: { write: (record: AgentSignalProcedureRecord) => Promise<void> };
  /** TTL used for marker expiration. */
  ttlSeconds?: number;
}

/**
 * Options for feedback action planning.
 */
export interface FeedbackActionPlannerOptions {
  /** Optional action services used to prepare runtime action plans. */
  actionServices?: AgentSignalActionServices;
  /** Optional procedure marker reader used to suppress same-source duplicate actions. */
  markerReader?: FeedbackActionMarkerReader;
  /** Optional procedure dependencies used for suppression and weak-signal accumulation. */
  procedure?: FeedbackActionProcedureDeps;
}

const isMemorySignal = (signal: FeedbackDomainSignal): signal is SignalFeedbackDomainMemory => {
  return signal.payload.target === 'memory';
};

const isDirectSkillDecisionSignal = (
  signal: FeedbackDomainSignal,
): signal is NonSatisfiedSkillActionServiceSignal => {
  if (signal.payload.target !== 'skill') return false;
  if (signal.payload.skillRoute === 'direct_decision') return true;

  return (
    signal.payload.satisfactionResult !== 'satisfied' && signal.payload.skillRoute !== 'non_skill'
  );
};

const isAccumulatingSkillSignal = (
  signal: FeedbackDomainSignal,
): signal is SatisfiedSkillFeedbackDomainSignal => {
  return (
    signal.payload.target === 'skill' &&
    signal.payload.satisfactionResult === 'satisfied' &&
    signal.payload.skillRoute !== 'direct_decision' &&
    signal.payload.skillRoute !== 'non_skill'
  );
};

const createPlannerProcedureState = (
  options: FeedbackActionPlannerOptions,
): ProcedureProcessorStateService | undefined => {
  const markerReader = options.markerReader ?? options.procedure?.markerReader;
  const procedureState = options.procedure?.procedureState;

  if (procedureState) {
    if (!markerReader) return procedureState;

    return {
      ...procedureState,
      markers: {
        ...procedureState.markers,
        shouldSuppress: markerReader.shouldSuppress,
      },
    };
  }

  if (!markerReader && (!options.procedure?.recordStore || !options.procedure.accumulator)) {
    return undefined;
  }

  return {
    accumulators:
      options.procedure?.accumulator && options.procedure.recordStore
        ? {
            appendAndScore: async (record) => {
              if (options.procedure?.accumulator?.appendAndScore) {
                return options.procedure.accumulator.appendAndScore(record);
              }

              await options.procedure?.accumulator?.appendRecord(record);
              return undefined;
            },
          }
        : undefined,
    markers: markerReader
      ? {
          shouldSuppress: markerReader.shouldSuppress,
          write: options.procedure?.markerStore?.write,
        }
      : undefined,
    records: options.procedure?.recordStore,
  };
};

const createProcedureContext = (
  context: RuntimeProcessorContext,
  options: FeedbackActionPlannerOptions,
): RuntimeProcessorContext => {
  if (!options.procedure?.now) return context;

  return { ...context, now: options.procedure.now };
};

const writeAccumulatedMarker = async (
  signal: SatisfiedSkillFeedbackDomainSignal,
  context: RuntimeProcessorContext,
  options: FeedbackActionPlannerOptions,
  scoredSignalId: string,
  recordId: string,
) => {
  const procedureStateAccumulatedMarkerWriter =
    options.procedure?.procedureState?.markers.writeAccumulated;

  if (procedureStateAccumulatedMarkerWriter) {
    await procedureStateAccumulatedMarkerWriter({
      domainKey: 'skill',
      intentClass: 'implicit_positive',
      procedureKey: createProcedureKey({
        messageId: signal.payload.messageId,
        rootSourceId: signal.chain.rootSourceId,
      }),
      recordId,
      scopeKey: context.scopeKey,
      signalId: scoredSignalId,
      sourceId: signal.source?.sourceId,
    });

    return;
  }

  const markerWriter = options.procedure?.markerStore?.write;
  const ttlSeconds = options.procedure?.ttlSeconds;

  if (!markerWriter || !ttlSeconds) return;

  const now = context.now();

  await markerWriter(
    createProcedureMarker({
      createdAt: now,
      domainKey: 'skill',
      expiresAt: now + ttlSeconds * 1000,
      intentClass: 'implicit_positive',
      markerType: 'accumulated',
      procedureKey: createProcedureKey({
        messageId: signal.payload.messageId,
        rootSourceId: signal.chain.rootSourceId,
      }),
      recordId,
      scopeKey: context.scopeKey,
      signalId: scoredSignalId,
      sourceId: signal.source?.sourceId,
    }),
  );
};

const handleSatisfiedSkillFeedback = async (
  signal: SatisfiedSkillFeedbackDomainSignal,
  context: RuntimeProcessorContext,
  options: FeedbackActionPlannerOptions,
  procedureState: ProcedureProcessorStateService | undefined,
): Promise<RuntimeProcessorResult | undefined> => {
  const accumulated = await accumulateSignal(
    signal,
    context,
    { procedureState },
    {
      domain: 'skill',
      scoreDelta: SATISFIED_SKILL_CHEAP_SCORE_DELTA,
    },
  );

  // Legacy feedbackAction behavior treats procedure-unavailable and score-gate stops as no work.
  if (accumulated.type !== 'continue') return;
  if (!('value' in accumulated)) return;

  const scored = scoreIncrease(accumulated.value.scored, {
    minRecords: 2,
    threshold: 1,
  });

  if (scored.type !== 'continue') return;
  if (!('value' in scored)) return;

  const transitioned = transitionScoredProcedure(signal, scored.value);

  if (transitioned.type !== 'transition') return;
  if (transitioned.result.status !== 'dispatch') return;

  const scoredSignal = transitioned.result.signals?.[0];
  await writeAccumulatedMarker(
    signal,
    context,
    options,
    scoredSignal?.signalId ?? '',
    accumulated.value.record.id,
  );

  return {
    ...transitioned.result,
    actions: transitioned.result.actions ?? [],
  } satisfies RuntimeDispatchProcessorResult;
};

/**
 * Creates the signal handler that turns domain signals into action lists.
 *
 * Triggering workflow:
 *
 * {@link createFeedbackDomainJudgeSignalHandler}
 *   -> `signal.feedback.domain.*`
 *     -> {@link createFeedbackActionPlannerSignalHandler}
 *
 * Upstream:
 * - {@link createFeedbackDomainJudgeSignalHandler}
 *
 * Downstream:
 * - `action.user-memory.handle`
 * - `action.skill-management.handle`
 * - `signal.procedure.bucket.scored`
 */
export const createFeedbackActionPlannerSignalHandler = (
  options: FeedbackActionPlannerOptions = {},
) => {
  const defaultActionServices = createDefaultActionServices();
  const actionServices = {
    memoryActions: options.actionServices?.memoryActions ?? defaultActionServices.memoryActions,
    skillActions: options.actionServices?.skillActions ?? defaultActionServices.skillActions,
  };
  const listenedSignalTypes = [
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainMemory,
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainNone,
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainPrompt,
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainSkill,
  ] as const;

  return defineSignalHandler(
    listenedSignalTypes,
    'signal.feedback-action-planner',
    async (signal, context): Promise<RuntimeProcessorResult | void> => {
      const procedureContext = createProcedureContext(context, options);
      const procedureState = createPlannerProcedureState(options);
      const suppression = await suppressHandled(
        signal,
        procedureContext,
        { procedureState },
        { onSuppress: () => transitionSuppressedProcedure(signal, procedureContext) },
      );

      if (suppression.type === 'transition' || suppression.type === 'stop') {
        return suppression.result;
      }

      if (isMemorySignal(signal)) {
        const plan = actionServices.memoryActions.prepare(signal);

        return {
          actions: [plan.action],
          status: 'dispatch',
        };
      }

      if (isDirectSkillDecisionSignal(signal)) {
        const plan = actionServices.skillActions.prepare(signal);

        return {
          actions: [plan.action],
          status: 'dispatch',
        };
      }

      if (isAccumulatingSkillSignal(signal)) {
        return handleSatisfiedSkillFeedback(signal, procedureContext, options, procedureState);
      }
    },
  );
};
