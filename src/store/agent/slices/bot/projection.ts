import { defineReplica } from '@/libs/replica';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

/**
 * One channel (bot) provider row of an agent — the shape the channel settings
 * surface reads, keyed by agent id in {@link botProvidersResource}.
 */
export interface BotProviderItem {
  applicationId: string;
  credentials: Record<string, string>;
  enabled: boolean;
  id: string;
  platform: string;
  settings?: Record<string, unknown> | null;
}

export interface BotProvidersParams {
  agentId: string;
}

/**
 * One agent's channel providers, one entry per agent. Persisted so a revisit
 * to the channel page paints the last known providers on the first frame and
 * reconciles with the server in the background.
 */
export const botProvidersResource = defineReplica<BotProvidersParams, BotProviderItem[]>({
  key: ({ agentId }) => agentId,
  name: 'botProviders',
  storage: 'indexedDB',
  version: 1,
});

/** Entry key of the single, account-wide channel platform catalog. */
export const PLATFORM_DEFINITIONS_KEY = 'all';

/** The platform catalog has no identity of its own — one entry per scope. */
export type PlatformDefinitionsParams = Record<string, never>;

/**
 * The server's channel platform catalog. One entry per scope: it is the same
 * for every agent, so it never needs a per-agent key.
 */
export const platformDefinitionsResource = defineReplica<
  PlatformDefinitionsParams,
  SerializedPlatformDefinition[]
>({
  key: () => PLATFORM_DEFINITIONS_KEY,
  name: 'botPlatformDefinitions',
  storage: 'indexedDB',
  version: 1,
});
