import type { AgentSignalScope } from '@lobechat/agent-signal';

export interface AgentSignalBotScopeKeyInput {
  applicationId: string;
  platform: string;
  platformThreadId: string;
}

export interface AgentSignalProducerScopeInput {
  applicationId?: string;
  platform?: string;
  platformThreadId?: string;
  topicId?: string;
}

export interface AgentSignalTaskScopeKeyInput {
  taskId: string;
}

export interface AgentSignalTopicScopeKeyInput {
  topicId: string;
}

export interface AgentSignalUserAgentScopeKeyInput {
  agentId: string;
  userId: string;
}

export interface AgentSignalUserScopeKeyInput {
  userId: string;
}

const joinScopeKey = (prefix: string, ...parts: string[]) => `${prefix}:${parts.join(':')}`;

/** Server-owned scope-key builders for the current AgentSignal routing model. */
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
