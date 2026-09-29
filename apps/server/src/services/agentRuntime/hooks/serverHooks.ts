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

/** Server configuration wins ID collisions; unrelated callbacks retain their original objects. */
export function mergeServerHooks<T extends AgentHook | SerializedHook>(
  hooks: T[],
  configured: T[],
): T[] {
  const reserved = new Map(configured.map((hook) => [hook.id, hook]));
  const seen = new Set<string>();
  const retained = hooks.filter((hook) => {
    if (reserved.has(hook.id)) return false;
    if (!hook.id.startsWith(SERVER_HOOK_PREFIX)) return true;
    if (seen.has(hook.id)) return false;
    seen.add(hook.id);
    return true;
  });
  return [...retained, ...reserved.values()];
}
