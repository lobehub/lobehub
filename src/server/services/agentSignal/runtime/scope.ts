import type { AgentSignalScope } from '@lobechat/agent-signal';

import { type AgentSignalProducerScopeInput, AgentSignalScopeKey } from '../scopeKey';

/** Resolves the canonical runtime scope key for one source scope. */
export const resolveRuntimeScopeKey = (scope: AgentSignalScope) => {
  return AgentSignalScopeKey.fromRuntimeScope(scope);
};

/**
 * Resolves one stable scope key for producers that emit raw source envelopes.
 *
 * Before:
 * - `{ topicId: 'topic-1' }`
 * - `{ platform: 'wechat', applicationId: 'app', platformThreadId: 'thread-1' }`
 *
 * After:
 * - `topic:topic-1`
 * - `bot:wechat:app:thread-1`
 */
export const resolveProducerScopeKey = (input: AgentSignalProducerScopeInput) => {
  return AgentSignalScopeKey.fromProducerInput(input);
};
