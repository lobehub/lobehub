import { defineReplica } from '@/libs/replica';
import type { messengerService } from '@/services/messenger';

type Resolved<T extends (...args: any[]) => Promise<unknown>> = Awaited<ReturnType<T>>;

export type MessengerPlatformItem = Resolved<typeof messengerService.availablePlatforms>[number];
export type MessengerLinkItem = Resolved<typeof messengerService.listMyLinks>[number];
export type MessengerInstallationItem = Resolved<
  typeof messengerService.listMyInstallations
>[number];
export type MessengerBindingScope = Resolved<typeof messengerService.listBindingScopes>[number];
export type MessengerBindingAgent = Resolved<typeof messengerService.listAgentsForBinding>[number];
export type MessengerPushWindow = Resolved<typeof messengerService.getMessengerPushWindow>;

/** The caller-wide lists have a single entry; the scope partitions them per user + workspace. */
export type MessengerListParams = Record<string, never>;
export const MESSENGER_LIST_PARAMS: MessengerListParams = {};
export const MESSENGER_LIST_KEY = 'all';

/** Platforms this deployment enables, with each one's plan-gated access meta. */
export const messengerPlatformsResource = defineReplica<
  MessengerListParams,
  MessengerPlatformItem[]
>({
  key: () => MESSENGER_LIST_KEY,
  name: 'messengerPlatforms',
  storage: 'indexedDB',
  version: 1,
});

/** The caller's account links across platforms and tenants (served without credentials). */
export const messengerLinksResource = defineReplica<MessengerListParams, MessengerLinkItem[]>({
  key: () => MESSENGER_LIST_KEY,
  name: 'messengerLinks',
  storage: 'indexedDB',
  version: 1,
});

/**
 * The caller's System Bot installations (served without credentials). WeChat
 * rows carry the bot's live `runtime` status, which is stripped before
 * persisting: a reload must not replay an old failure, so it stays unknown
 * until the server answers.
 */
export const messengerInstallationsResource = defineReplica<
  MessengerListParams,
  MessengerInstallationItem[]
>({
  key: () => MESSENGER_LIST_KEY,
  name: 'messengerInstallations',
  storage: 'indexedDB',
  version: 1,
});

export const toPersistedMessengerInstallations = (
  items: MessengerInstallationItem[],
): MessengerInstallationItem[] =>
  items.map((item) => (item.runtime === undefined ? item : { ...item, runtime: undefined }));

/** Workspaces the System Bot can route to; personal is implicit. */
export const messengerBindingScopesResource = defineReplica<
  MessengerListParams,
  MessengerBindingScope[]
>({
  key: () => MESSENGER_LIST_KEY,
  name: 'messengerBindingScopes',
  storage: 'indexedDB',
  version: 1,
});

export interface MessengerBindingAgentsParams {
  /** `null` is the personal scope. */
  workspaceId: string | null;
}

export const messengerBindingAgentsKey = ({ workspaceId }: MessengerBindingAgentsParams) =>
  workspaceId ?? '~personal';

/** Agents the System Bot can route to, per picked binding scope. */
export const messengerBindingAgentsResource = defineReplica<
  MessengerBindingAgentsParams,
  MessengerBindingAgent[]
>({
  key: messengerBindingAgentsKey,
  name: 'messengerBindingAgents',
  persist: { maxEntries: 10 },
  storage: 'indexedDB',
  version: 1,
});

export interface MessengerPushWindowParams {
  platform: Parameters<typeof messengerService.getMessengerPushWindow>[0];
  tenantId?: string;
}

export const messengerPushWindowKey = ({ platform, tenantId }: MessengerPushWindowParams) =>
  `${platform}:${tenantId ?? ''}`;

/**
 * Whether the bot can message the caller right now (WeChat's send window and
 * quota move with every inbound message and with time). Live status: shared
 * between the settings card and the push modal in memory, never persisted, so
 * a reload cannot enable Send from an expired window.
 */
export const messengerPushWindowResource = defineReplica<
  MessengerPushWindowParams,
  MessengerPushWindow
>({
  key: messengerPushWindowKey,
  name: 'messengerPushWindow',
  persistKey: () => false,
  storage: 'indexedDB',
  version: 1,
});
