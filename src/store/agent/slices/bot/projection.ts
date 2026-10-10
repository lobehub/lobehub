import { isMaskedBotCredential } from '@lobechat/const';

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
 * The persisted shape of a provider row: every credential value that is not
 * already a mask is dropped.
 *
 * `getByAgentId` masks the credentials it classifies as secret, but a platform
 * may publish a credential as an *identifier* and still have it authenticate
 * something — iMessage declares `webhookSecret` public because the user's own
 * desktop bridge reads it back and has no way to ask for it again, yet that same
 * value is the bearer secret inbound webhook requests are checked against. So
 * "what the server is willing to render in a live UI" is not the same question
 * as "what may sit in IndexedDB after the tab closes", and the frontend cannot
 * answer the second one from the masked payload alone.
 *
 * Only masks survive the write. A mask is not a secret — the server's
 * `resolveMaskedCredentials` turns it back into the stored value on save, so a
 * hydrated first frame can still show which credentials are configured, and an
 * untouched save still round-trips. Everything else stays in the in-memory row
 * for the session, exactly as the memory-only `agentBot` SWR cache this resource
 * replaces did. The persisted row is read for the channel *list* first frame
 * (platform grid, connected state), which needs no credential value at all.
 */
export const withoutBotProviderSecrets = (providers: BotProviderItem[]): BotProviderItem[] =>
  providers.map((provider) => {
    const entries = Object.entries(provider.credentials ?? {});
    const kept = entries.filter(([, value]) => isMaskedBotCredential(value));
    if (kept.length === entries.length) return provider;

    return { ...provider, credentials: Object.fromEntries(kept) };
  });

/**
 * One agent's channel providers, one entry per agent. Persisted so a revisit
 * to the channel page paints the last known providers on the first frame and
 * reconciles with the server in the background. The persisted copy carries no
 * cleartext credential — see {@link withoutBotProviderSecrets}.
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
