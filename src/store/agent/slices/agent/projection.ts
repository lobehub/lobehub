import type { PartialDeep } from 'type-fest';

import { defineReplica } from '@/libs/replica';
import type { AvailableAgentItem } from '@/services/agent';
import type { aiAgentService } from '@/services/aiAgent';
import type { AgentItem, LobeAgentConfig } from '@/types/agent';

export interface AgentConfigParams {
  agentId: string;
}

/**
 * One agent's config per entry, keyed by agent id. The fetch resolves `null`
 * when the agent is gone or no longer visible to the viewer.
 */
export const agentConfigResource = defineReplica<
  AgentConfigParams,
  PartialDeep<AgentItem>,
  LobeAgentConfig | null
>({
  key: ({ agentId }) => agentId,
  name: 'agentConfig',
  version: 1,
});

/** Custom agent slugs whose `slug → id` lookup survives a reload, most recently used first. */
const MAX_PERSISTED_AGENT_SLUGS = 50;

export interface AgentSlugParams {
  /** A user-chosen agent slug (`/agent/<slug>`); builtin slugs resolve elsewhere. */
  slug: string;
}

/**
 * `slug → agent id` for user-chosen slugs, keyed by the slug. The fetch
 * resolves `null` when no agent visible to the viewer owns the slug, which
 * drops the entry. Persisted so a `/agent/<slug>` route paints the agent from
 * the local copy instead of waiting on the lookup; the network still confirms
 * before the route redirects to the id.
 */
export const agentSlugIdResource = defineReplica<AgentSlugParams, string, string | null>({
  key: ({ slug }) => slug,
  name: 'agentSlugId',
  persist: { maxEntries: MAX_PERSISTED_AGENT_SLUGS },
  version: 1,
});

/** The available-agents list is one entry per scope. */
export const AVAILABLE_AGENTS_KEY = 'recent';

/**
 * The most recently updated agents, which the chat context lists as delegation
 * targets. One entry per scope (`availableAgents` is its view).
 */
export const availableAgentsResource = defineReplica<Record<string, never>, AvailableAgentItem[]>({
  key: () => AVAILABLE_AGENTS_KEY,
  name: 'availableAgents',
  version: 1,
});

/** The server-default heterogeneous capability is one entry per scope. */
export const HETERO_SERVER_DEFAULT_CAPABILITY_KEY = 'default';

export type ServerDefaultHeterogeneousCapability = Awaited<
  ReturnType<typeof aiAgentService.getServerDefaultHeterogeneousCapability>
>;

/**
 * Whether the server offers its own models to external agents (and which).
 * Small and slow-changing, so the profile editor and the API-mode model bar
 * paint the last answer while the network confirms.
 */
export const heteroServerDefaultCapabilityResource = defineReplica<
  Record<string, never>,
  ServerDefaultHeterogeneousCapability
>({
  key: () => HETERO_SERVER_DEFAULT_CAPABILITY_KEY,
  name: 'heteroServerDefaultCapability',
  storage: 'localStorage',
  version: 1,
});
