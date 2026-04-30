import type { AgentSignalSource, BaseSource } from '../base/types';

/** AgentSignal source type identifiers shared by browser producers and server executors. */
export const AGENT_SIGNAL_SOURCE_TYPES = {
  agentExecutionCompleted: 'agent.execution.completed',
  agentExecutionFailed: 'agent.execution.failed',
  agentUserMessage: 'agent.user.message',
  botMessageMerged: 'bot.message.merged',
  clientGatewayError: 'client.gateway.error',
  clientGatewayRuntimeEnd: 'client.gateway.runtime_end',
  clientGatewayStepComplete: 'client.gateway.step_complete',
  clientGatewayStreamStart: 'client.gateway.stream_start',
  clientRuntimeComplete: 'client.runtime.complete',
  clientRuntimeStart: 'client.runtime.start',
  runtimeAfterStep: 'runtime.after_step',
  runtimeBeforeStep: 'runtime.before_step',
  toolOutcomeCompleted: 'tool.outcome.completed',
  toolOutcomeFailed: 'tool.outcome.failed',
} as const;

type ValueOf<TValue> = TValue[keyof TValue];

/** AgentSignal source type union derived from {@link AGENT_SIGNAL_SOURCE_TYPES}. */
export type AgentSignalSourceType = ValueOf<typeof AGENT_SIGNAL_SOURCE_TYPES>;

/** AgentSignal source payloads keyed by source type. */
export interface AgentSignalSourcePayloadMap {
  [AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted]: {
    agentId?: string;
    operationId: string;
    serializedContext?: string;
    steps: number;
    topicId?: string;
    turnCount?: number;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.agentExecutionFailed]: {
    agentId?: string;
    errorMessage?: string;
    operationId: string;
    reason?: string;
    serializedContext?: string;
    topicId?: string;
    turnCount?: number;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage]: {
    agentId?: string;
    documentPayload?: Record<string, unknown>;
    intents?: Array<'document' | 'memory' | 'persona' | 'prompt' | 'skill'>;
    memoryPayload?: Record<string, unknown>;
    message: string;
    messageId: string;
    serializedContext?: string;
    threadId?: string;
    topicId?: string;
    trigger?: string;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged]: {
    agentId?: string;
    applicationId?: string;
    message: string;
    platform?: string;
    platformThreadId?: string;
    serializedContext?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.clientGatewayError]: {
    agentId?: string;
    errorMessage?: string;
    operationId: string;
    serializedContext?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.clientGatewayRuntimeEnd]: {
    agentId?: string;
    operationId: string;
    serializedContext?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStepComplete]: {
    agentId?: string;
    operationId: string;
    serializedContext?: string;
    stepIndex: number;
    topicId?: string;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStreamStart]: {
    agentId?: string;
    operationId: string;
    serializedContext?: string;
    stepIndex: number;
    topicId?: string;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete]: {
    agentId?: string;
    operationId: string;
    serializedContext?: string;
    status?: string;
    threadId?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart]: {
    agentId?: string;
    operationId: string;
    parentMessageId?: string;
    parentMessageType?: string;
    serializedContext?: string;
    threadId?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.runtimeAfterStep]: {
    agentId?: string;
    operationId: string;
    serializedContext?: string;
    stepIndex: number;
    topicId?: string;
    turnCount?: number;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.runtimeBeforeStep]: {
    agentId?: string;
    operationId: string;
    serializedContext?: string;
    stepIndex: number;
    topicId?: string;
    turnCount?: number;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted]: {
    agentId?: string;
    domainKey?: string;
    intentClass?: string;
    messageId?: string;
    operationId?: string;
    outcome: {
      action?: string;
      status: 'skipped' | 'succeeded';
      summary?: string;
    };
    relatedObjects?: Array<{ objectId: string; objectType: string; relation?: string }>;
    taskId?: string;
    tool: { apiName?: string; identifier: string };
    toolCallId?: string;
    topicId?: string;
  };
  [AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed]: {
    agentId?: string;
    domainKey?: string;
    intentClass?: string;
    messageId?: string;
    operationId?: string;
    outcome: {
      action?: string;
      errorReason?: string;
      status: 'failed';
      summary?: string;
    };
    relatedObjects?: Array<{ objectId: string; objectType: string; relation?: string }>;
    taskId?: string;
    tool: { apiName?: string; identifier: string };
    toolCallId?: string;
    topicId?: string;
  };
}

/** AgentSignal source variant with source-type-specific payload typing. */
export type AgentSignalSourceVariant<
  TSourceType extends AgentSignalSourceType = AgentSignalSourceType,
> = BaseSource & {
  payload: AgentSignalSourcePayloadMap[TSourceType];
  sourceType: TSourceType;
};

/** Union of every known AgentSignal source variant. */
export type AgentSignalSourceVariants = {
  [TSourceType in AgentSignalSourceType]: AgentSignalSourceVariant<TSourceType>;
}[AgentSignalSourceType];

/** User-message source variant. */
export type SourceAgentUserMessage = AgentSignalSourceVariant<'agent.user.message'>;

/** Agent execution-completed source variant. */
export type SourceAgentExecutionCompleted = AgentSignalSourceVariant<'agent.execution.completed'>;

/** Agent execution-failed source variant. */
export type SourceAgentExecutionFailed = AgentSignalSourceVariant<'agent.execution.failed'>;

/** Runtime before-step source variant. */
export type SourceRuntimeBeforeStep = AgentSignalSourceVariant<'runtime.before_step'>;

/** Runtime after-step source variant. */
export type SourceRuntimeAfterStep = AgentSignalSourceVariant<'runtime.after_step'>;

/** Bot-message merged source variant. */
export type SourceBotMessageMerged = AgentSignalSourceVariant<'bot.message.merged'>;

/** Client gateway stream-start source variant. */
export type SourceClientGatewayStreamStart =
  AgentSignalSourceVariant<'client.gateway.stream_start'>;

/** Client gateway step-complete source variant. */
export type SourceClientGatewayStepComplete =
  AgentSignalSourceVariant<'client.gateway.step_complete'>;

/** Client gateway runtime-end source variant. */
export type SourceClientGatewayRuntimeEnd = AgentSignalSourceVariant<'client.gateway.runtime_end'>;

/** Client gateway error source variant. */
export type SourceClientGatewayError = AgentSignalSourceVariant<'client.gateway.error'>;

/** Client runtime-start source variant. */
export type SourceClientRuntimeStart = AgentSignalSourceVariant<'client.runtime.start'>;

/** Client runtime-complete source variant. */
export type SourceClientRuntimeComplete = AgentSignalSourceVariant<'client.runtime.complete'>;

/** Tool outcome-completed source variant. */
export type SourceToolOutcomeCompleted = AgentSignalSourceVariant<'tool.outcome.completed'>;

/** Tool outcome-failed source variant. */
export type SourceToolOutcomeFailed = AgentSignalSourceVariant<'tool.outcome.failed'>;

/** Source types accepted by browser producers through the authenticated edge. */
export const AGENT_SIGNAL_CLIENT_SOURCE_TYPES = [
  AGENT_SIGNAL_SOURCE_TYPES.clientGatewayError,
  AGENT_SIGNAL_SOURCE_TYPES.clientGatewayRuntimeEnd,
  AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStepComplete,
  AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStreamStart,
  AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
  AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
] as const satisfies readonly Extract<AgentSignalSourceType, `client.${string}`>[];

/**
 * Narrows a generic source node to the shared AgentSignal source catalog.
 *
 * Use when:
 * - Runtime middleware receives generic source nodes
 * - Callers need source-type-specific payload typing after validation
 *
 * Expects:
 * - `source.sourceType` is a string-like type identifier
 *
 * Returns:
 * - Whether the source belongs to the built-in AgentSignal source catalog
 */
export const isAgentSignalKnownSource = (
  source: AgentSignalSource,
): source is AgentSignalSourceVariants => {
  return Object.values(AGENT_SIGNAL_SOURCE_TYPES).includes(
    source.sourceType as AgentSignalSourceType,
  );
};
