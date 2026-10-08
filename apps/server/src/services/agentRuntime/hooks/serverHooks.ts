import { getAgentHookConfig } from '@lobechat/env/agentHook';

import type { AgentHook, SerializedHook } from './types';

const SERVER_HOOK_PREFIX = 'server-env-webhook:';

/** Generate only template-bearing webhook configs; each event has a stable reserved ID. */
export function getServerHooks(): AgentHook[] {
  const env = getAgentHookConfig();
  if (!env.AGENT_HOOK_WEBHOOK_URL) return [];
  const webhook = {
    allowedEnvVars: ['AGENT_HOOK_WEBHOOK_TOKEN'],
    delivery: 'fetch' as const,
    headers: { Authorization: 'Bearer ${AGENT_HOOK_WEBHOOK_TOKEN}' },
    url: env.AGENT_HOOK_WEBHOOK_URL,
  };
  return env.AGENT_HOOK_WEBHOOK_EVENTS!.map((type): AgentHook => {
    const id = `${SERVER_HOOK_PREFIX}${type}`;
    if (type === 'beforeToolCall' && env.AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING === 'toolCall') {
      return {
        id,
        type,
        webhook: {
          ...webhook,
          onError: env.AGENT_HOOK_WEBHOOK_ON_ERROR,
          responseHandling: 'toolCall',
        },
      };
    }
    return { id, type, webhook: { ...webhook, onError: 'continue', responseHandling: 'ignore' } };
  });
}

/** Replace all environment hooks with current configuration, preserving unrelated callbacks. */
export function mergeServerHooks<T extends AgentHook | SerializedHook>(
  hooks: T[],
  configured: T[],
): T[] {
  const reserved = new Map(configured.map((hook) => [hook.id, hook]));
  const retained = hooks.filter((hook) => !hook.id.startsWith(SERVER_HOOK_PREFIX));
  return [...retained, ...reserved.values()];
}
