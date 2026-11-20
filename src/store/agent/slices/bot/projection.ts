import { BOT_CREDENTIAL_MASK, isMaskedBotCredential } from '@lobechat/const';

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
 * The persisted shape of a provider row: every credential value is replaced by
 * the mask, and the *key set is kept whole*.
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
 * No cleartext value survives the write — a mask is not a secret. But the keys
 * do have to survive: the server replaces the credential blob wholesale on
 * update, so a persisted row that dropped the values the server left in the
 * clear (WeChat's `botId`/`userId`, Discord's `publicKey`) would submit an
 * incomplete blob on the next save and delete them. Keeping every key — masked —
 * lets the first frame identify what is configured and lets an untouched save
 * round-trip through `resolveMaskedCredentials`, which turns each mask back into
 * the stored value. An empty value stays empty so "not configured" remains
 * readable.
 */
export const withoutBotProviderSecrets = (providers: BotProviderItem[]): BotProviderItem[] =>
  providers.map((provider) => ({
    ...provider,
    credentials: Object.fromEntries(
      Object.entries(provider.credentials ?? {}).map(([key, value]) => [
        key,
        !value || isMaskedBotCredential(value) ? value : BOT_CREDENTIAL_MASK,
      ]),
    ),
  }));

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
