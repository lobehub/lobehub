import { agentIdentityEnv } from '@/envs/agentIdentity';
import { redisService } from '@/server/services/redis';

import { AgentAccountProviderRegistry } from '../registry';
import type { AgentMailProviderConfig } from './agentMail';
import { createAgentMailProvider } from './agentMail';

export type { AgentMailProviderConfig } from './agentMail';
export { createAgentMailProvider } from './agentMail';

/** Which providers a deployment has wired up. Omitted = not registered. */
export interface AgentIdentityProviderConfig {
  agentMail?: AgentMailProviderConfig;
}

/**
 * Build a registry from an explicit config. Pure and injectable, so tests and
 * offline acceptance can register providers with fixture keys and a mock fetch
 * instead of reading deployment env.
 */
export const createAgentAccountRegistry = (
  config: AgentIdentityProviderConfig,
): AgentAccountProviderRegistry => {
  const registry = new AgentAccountProviderRegistry();

  if (config.agentMail) registry.register(createAgentMailProvider(config.agentMail));

  return registry;
};

/**
 * The deployment registry: register each provider whose credentials are
 * present. A missing key omits the provider entirely rather than registering a
 * broken one, so `registry.get('agent-mail')` fails with the real reason.
 */
export const createDefaultAgentAccountRegistry = (): AgentAccountProviderRegistry =>
  createAgentAccountRegistry({
    agentMail:
      agentIdentityEnv.ENABLED_AGENT_MAIL && agentIdentityEnv.AGENT_MAIL_API_KEY
        ? {
            apiBaseUrl: agentIdentityEnv.AGENT_MAIL_API_BASE_URL,
            apiKey: agentIdentityEnv.AGENT_MAIL_API_KEY,
            // Shared across instances: a retry or replay can land on any worker.
            dedupeStore: {
              claim: (eventId, ttlSeconds) =>
                redisService.agentIdentity.claimWebhookEvent(
                  { eventId, provider: 'agent-mail' },
                  ttlSeconds,
                ),
              release: (eventId) =>
                redisService.agentIdentity.releaseWebhookEvent({ eventId, provider: 'agent-mail' }),
            },
            webhookSecret: agentIdentityEnv.AGENT_MAIL_WEBHOOK_SECRET,
            webhookUrl: agentIdentityEnv.AGENT_MAIL_WEBHOOK_URL,
          }
        : undefined,
  });
