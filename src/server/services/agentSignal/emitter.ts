import type { DedupedSourceEventResult } from '@lobechat/agent-signal';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import type { LobeChatDatabase } from '@/database/type';
import { AgentSignalWorkflow } from '@/server/workflows/agentSignal';

import { isAgentSignalEnabledForUser } from './featureGate';
import type { GeneratedAgentSignalEmissionResult } from './orchestrator';
import type { CreateDefaultAgentSignalPoliciesOptions } from './policies';
import { AgentSignalScopeKey } from './scopeKey';
import type { EmitSourceEventInput } from './sources';
import type {
  AgentSignalSourcePayloadMap,
  AgentSignalSourceType,
  SourceAgentExecutionCompleted,
  SourceAgentExecutionFailed,
  SourceAgentUserMessage,
  SourceBotMessageMerged,
  SourceRuntimeAfterStep,
  SourceRuntimeBeforeStep,
} from './sourceTypes';

const log = debug('lobe-server:agent-signal:service');

export interface AgentSignalExecutionContext {
  agentId?: string;
  db: LobeChatDatabase;
  userId: string;
}

type RuntimeProducerSourceType =
  | SourceAgentExecutionCompleted['sourceType']
  | SourceAgentExecutionFailed['sourceType']
  | SourceRuntimeAfterStep['sourceType']
  | SourceRuntimeBeforeStep['sourceType'];

type AgentSignalSourcePayload<TSourceType extends AgentSignalSourceType> =
  AgentSignalSourcePayloadMap[TSourceType];

/** One producer-side source emission input. */
export interface AgentSignalSourceEventInput<
  TSourceType extends AgentSignalSourceType,
> extends Omit<EmitSourceEventInput, 'payload' | 'scopeKey' | 'sourceType' | 'timestamp'> {
  payload: AgentSignalSourcePayload<TSourceType>;
  scopeKey?: string;
  sourceType: TSourceType;
  timestamp?: number;
}

/** One AgentSignal emission execution option set. */
export interface AgentSignalPolicyOptionOverrides extends Omit<
  Partial<CreateDefaultAgentSignalPoliciesOptions>,
  'skillManagement'
> {
  skillManagement?: Partial<
    NonNullable<CreateDefaultAgentSignalPoliciesOptions['skillManagement']>
  >;
}

export interface AgentSignalEmitOptions {
  ignoreError?: boolean;
  policyOptions?: AgentSignalPolicyOptionOverrides;
}

/** One AgentSignal async handoff result. */
export interface QueuedAgentSignalEmissionResult {
  accepted: boolean;
  scopeKey: string;
  workflowRunId: string;
}

export type RuntimeAgentSignalSourceInput<TSourceType extends RuntimeProducerSourceType> =
  AgentSignalSourceEventInput<TSourceType>;

export type BotAgentSignalSourceInput = AgentSignalSourceEventInput<
  SourceBotMessageMerged['sourceType']
>;

export type UserMessageAgentSignalSourceInput = AgentSignalSourceEventInput<
  SourceAgentUserMessage['sourceType']
>;

export interface AgentSignalSourceEnvelope extends Omit<
  AgentSignalSourceEventInput<AgentSignalSourceType>,
  'scopeKey' | 'timestamp'
> {
  scopeKey: string;
  timestamp: number;
}

export const resolveSourceScopeKey = (payload: Record<string, unknown>) => {
  return AgentSignalScopeKey.fromProducerInput({
    applicationId: typeof payload.applicationId === 'string' ? payload.applicationId : undefined,
    platform: typeof payload.platform === 'string' ? payload.platform : undefined,
    platformThreadId:
      typeof payload.platformThreadId === 'string' ? payload.platformThreadId : undefined,
    topicId: typeof payload.topicId === 'string' ? payload.topicId : undefined,
  });
};

const withSelfIterationPolicy = (
  options: AgentSignalEmitOptions,
  selfIterationEnabled: boolean,
): AgentSignalEmitOptions => ({
  ...options,
  policyOptions: {
    ...options.policyOptions,
    skillManagement: {
      ...options.policyOptions?.skillManagement,
      selfIterationEnabled,
    },
  },
});

/**
 * Emits one source event into the AgentSignal pipeline and executes matching policies.
 *
 * Use when:
 * - Server-owned event producers need the normal AgentSignal boundary
 * - The caller should not control dedupe storage
 *
 * Expects:
 * - `context` points at the same database/user pair used by downstream policy execution
 *
 * Returns:
 * - A deduped result or a generated signal with orchestration details
 */
export const emitAgentSignalSourceEvent = async <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: AgentSignalExecutionContext,
  options: AgentSignalEmitOptions = {},
): Promise<DedupedSourceEventResult | GeneratedAgentSignalEmissionResult | undefined> => {
  const selfIterationEnabled = await isAgentSignalEnabledForUser(context.db, context.userId);

  if (!selfIterationEnabled) {
    return undefined;
  }

  const { executeAgentSignalSourceEvent } = await import('./orchestrator');

  return executeAgentSignalSourceEvent(input, context, withSelfIterationPolicy(options, true));
};

/**
 * Enqueues one source event for async AgentSignal execution through Upstash Workflow.
 *
 * Use when:
 * - The caller should return quickly and let async policy execution happen out-of-band
 * - The source event should still reuse the normal AgentSignal normalization boundary
 *
 * Expects:
 * - Payload contains enough routing context to derive a stable scope key
 *
 * Returns:
 * - The accepted workflow run identifier and normalized scope key
 */
export const enqueueAgentSignalSourceEvent = async <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: Pick<AgentSignalExecutionContext, 'agentId' | 'userId'>,
): Promise<QueuedAgentSignalEmissionResult> => {
  const db = await getServerDB();

  if (!(await isAgentSignalEnabledForUser(db, context.userId))) {
    return {
      accepted: false,
      scopeKey: input.scopeKey ?? resolveSourceScopeKey(input.payload),
      workflowRunId: '',
    };
  }

  const sourceEvent = {
    payload: input.payload,
    scopeKey: input.scopeKey ?? resolveSourceScopeKey(input.payload),
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    timestamp: input.timestamp ?? Date.now(),
  };

  log('Enqueueing source event payload=%O', {
    agentId: context.agentId,
    payload: sourceEvent.payload,
    scopeKey: sourceEvent.scopeKey,
    sourceId: sourceEvent.sourceId,
    sourceType: sourceEvent.sourceType,
    timestamp: sourceEvent.timestamp,
    userId: context.userId,
  });

  const trigger = await AgentSignalWorkflow.triggerRun({
    agentId: context.agentId,
    sourceEvent,
    userId: context.userId,
  });

  return {
    accepted: true,
    scopeKey: sourceEvent.scopeKey,
    workflowRunId: trigger.workflowRunId,
  };
};
