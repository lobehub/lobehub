import type { AgentSignalScope } from '../base/types';

/**
 * Bot-thread identity used to route source events that originate outside a LobeChat topic.
 */
export interface AgentSignalBotScopeKeyInput {
  /** Application identifier from the external bot platform. */
  applicationId: string;
  /** Platform identifier, such as `discord` or `slack`. */
  platform: string;
  /** Thread or channel conversation identifier from the external platform. */
  platformThreadId: string;
}

/**
 * Producer metadata used to derive a stable source-event scope key.
 */
export interface AgentSignalProducerScopeInput {
  /** Optional external application identifier for bot-originated events. */
  applicationId?: string;
  /** Optional external platform identifier for bot-originated events. */
  platform?: string;
  /** Optional external thread identifier for bot-originated events. */
  platformThreadId?: string;
  /** Optional LobeChat topic identifier. Takes precedence over bot-thread metadata. */
  topicId?: string;
}

/**
 * Task identity used when an AgentSignal chain is scoped to async task execution.
 */
export interface AgentSignalTaskScopeKeyInput {
  /** Stable task identifier. */
  taskId: string;
}

/**
 * Topic identity used when an AgentSignal chain is scoped to one LobeChat topic.
 */
export interface AgentSignalTopicScopeKeyInput {
  /** Stable LobeChat topic identifier. */
  topicId: string;
}

/**
 * Agent/user identity used when no narrower topic or task scope is available.
 */
export interface AgentSignalUserAgentScopeKeyInput {
  /** Stable assistant or agent identifier. */
  agentId: string;
  /** Stable user identifier. */
  userId: string;
}

/**
 * User identity used as the broadest authenticated AgentSignal scope.
 */
export interface AgentSignalUserScopeKeyInput {
  /** Stable user identifier. */
  userId: string;
}

const joinScopeKey = (prefix: string, ...parts: string[]) => `${prefix}:${parts.join(':')}`;

const pickString = (input: Record<string, unknown>, key: string) => {
  const value = input[key];

  return typeof value === 'string' ? value : undefined;
};

/**
 * Builds stable scope keys for AgentSignal source events and runtime chains.
 *
 * Use when:
 * - Normalizing source events before dedupe or workflow handoff
 * - Routing runtime chains into topic, bot-thread, task, or user lanes
 *
 * Expects:
 * - Input identifiers are already trusted by the caller
 *
 * Returns:
 * - A deterministic scope key string
 */
export const AgentSignalScopeKey = {
  forAgentUser: (input: AgentSignalUserAgentScopeKeyInput) =>
    joinScopeKey('agent', input.agentId, 'user', input.userId),
  forBotThread: (input: AgentSignalBotScopeKeyInput) =>
    joinScopeKey('bot', input.platform, input.applicationId, input.platformThreadId),
  forTask: (input: AgentSignalTaskScopeKeyInput) => joinScopeKey('task', input.taskId),
  forTopic: (input: AgentSignalTopicScopeKeyInput) => joinScopeKey('topic', input.topicId),
  forUser: (input: AgentSignalUserScopeKeyInput) => joinScopeKey('user', input.userId),
  fromProducerInput: (input: AgentSignalProducerScopeInput) => {
    if (input.topicId) return AgentSignalScopeKey.forTopic({ topicId: input.topicId });

    if (input.platform && input.applicationId && input.platformThreadId) {
      return AgentSignalScopeKey.forBotThread({
        applicationId: input.applicationId,
        platform: input.platform,
        platformThreadId: input.platformThreadId,
      });
    }

    return 'fallback:global';
  },
  fromRuntimeScope: (scope: AgentSignalScope) => {
    if (scope.topicId) return AgentSignalScopeKey.forTopic({ topicId: scope.topicId });
    if (scope.botScopeKey) return scope.botScopeKey;
    if (scope.taskId) return AgentSignalScopeKey.forTask({ taskId: scope.taskId });
    if (scope.agentId) {
      return AgentSignalScopeKey.forAgentUser({ agentId: scope.agentId, userId: scope.userId });
    }

    return AgentSignalScopeKey.forUser({ userId: scope.userId });
  },
} as const;

/**
 * Resolves the default scope key for a source-event payload.
 *
 * Before:
 * - `{ topicId: "topic-1", platform: "discord" }`
 *
 * After:
 * - `"topic:topic-1"`
 */
export const getSourceEventScopeKey = (input: Record<string, unknown>) => {
  return AgentSignalScopeKey.fromProducerInput({
    applicationId: pickString(input, 'applicationId'),
    platform: pickString(input, 'platform'),
    platformThreadId: pickString(input, 'platformThreadId'),
    topicId: pickString(input, 'topicId'),
  });
};
