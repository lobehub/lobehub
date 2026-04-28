import type { AgentSignalSource, BaseSource } from '@lobechat/agent-signal';

/** Server-owned AgentSignal source type identifiers. */
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
} as const;

type ValueOf<TValue> = TValue[keyof TValue];

/** Server-owned AgentSignal source type union. */
export type AgentSignalSourceType = ValueOf<typeof AGENT_SIGNAL_SOURCE_TYPES>;

/** Server-owned AgentSignal source payloads keyed by source type. */
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
    intents?: Array<'document' | 'memory' | 'persona' | 'prompt'>;
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
}

/** Server-owned AgentSignal source variant. */
export type AgentSignalSourceVariant<
  TSourceType extends AgentSignalSourceType = AgentSignalSourceType,
> = BaseSource & {
  payload: AgentSignalSourcePayloadMap[TSourceType];
  sourceType: TSourceType;
};

/** Server-owned AgentSignal source union. */
export type AgentSignalSourceVariants = {
  [TSourceType in AgentSignalSourceType]: AgentSignalSourceVariant<TSourceType>;
}[AgentSignalSourceType];

/** Server-owned alias retained for user-message sources. */
export type SourceAgentUserMessage = AgentSignalSourceVariant<'agent.user.message'>;

/** Server-owned alias retained for execution-completed sources. */
export type SourceAgentExecutionCompleted = AgentSignalSourceVariant<'agent.execution.completed'>;

/** Server-owned alias retained for execution-failed sources. */
export type SourceAgentExecutionFailed = AgentSignalSourceVariant<'agent.execution.failed'>;

/** Server-owned alias retained for before-step runtime sources. */
export type SourceRuntimeBeforeStep = AgentSignalSourceVariant<'runtime.before_step'>;

/** Server-owned alias retained for after-step runtime sources. */
export type SourceRuntimeAfterStep = AgentSignalSourceVariant<'runtime.after_step'>;

/** Server-owned alias retained for merged bot-message sources. */
export type SourceBotMessageMerged = AgentSignalSourceVariant<'bot.message.merged'>;

/** Server-owned alias retained for client gateway stream-start sources. */
export type SourceClientGatewayStreamStart =
  AgentSignalSourceVariant<'client.gateway.stream_start'>;

/** Server-owned alias retained for client gateway step-complete sources. */
export type SourceClientGatewayStepComplete =
  AgentSignalSourceVariant<'client.gateway.step_complete'>;

/** Server-owned alias retained for client gateway runtime-end sources. */
export type SourceClientGatewayRuntimeEnd = AgentSignalSourceVariant<'client.gateway.runtime_end'>;

/** Server-owned alias retained for client gateway error sources. */
export type SourceClientGatewayError = AgentSignalSourceVariant<'client.gateway.error'>;

/** Server-owned alias retained for client runtime-start sources. */
export type SourceClientRuntimeStart = AgentSignalSourceVariant<'client.runtime.start'>;

/** Server-owned alias retained for client runtime-complete sources. */
export type SourceClientRuntimeComplete = AgentSignalSourceVariant<'client.runtime.complete'>;

/** Client-originated source types accepted by the authenticated browser edge. */
export const AGENT_SIGNAL_CLIENT_SOURCE_TYPES = [
  AGENT_SIGNAL_SOURCE_TYPES.clientGatewayError,
  AGENT_SIGNAL_SOURCE_TYPES.clientGatewayRuntimeEnd,
  AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStepComplete,
  AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStreamStart,
  AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
  AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
] as const satisfies readonly Extract<AgentSignalSourceType, `client.${string}`>[];

/** Narrows one generic source node to the server-owned source catalog. */
export const isAgentSignalKnownSource = (
  source: AgentSignalSource,
): source is AgentSignalSourceVariants => {
  return Object.values(AGENT_SIGNAL_SOURCE_TYPES).includes(
    source.sourceType as AgentSignalSourceType,
  );
};
