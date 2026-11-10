import type { ReplicaState } from '@/libs/replica';

import type { MessengerState } from './initialState';
import {
  MESSENGER_LIST_KEY,
  messengerBindingAgentsKey,
  messengerPushWindowKey,
  type MessengerPushWindowParams,
} from './projection';

/**
 * The server answered in this session. A value restored from the local copy is
 * not confirmed: it may be stale, so an empty restore must read as loading,
 * never as "nothing connected".
 */
const isConfirmed = <T>(replica: ReplicaState<T>, key: string) =>
  replica.entries[key]?.source === 'server';

/** Something to paint: a non-empty local copy, or whatever the server answered. */
const isSettled = (list: unknown[] | undefined, confirmed: boolean) =>
  list !== undefined && (list.length > 0 || confirmed);

const platforms = (s: MessengerState) => s.platformsMap[MESSENGER_LIST_KEY];
const links = (s: MessengerState) => s.linksMap[MESSENGER_LIST_KEY];
const installations = (s: MessengerState) => s.installationsMap[MESSENGER_LIST_KEY];
const bindingScopes = (s: MessengerState) => s.bindingScopesMap[MESSENGER_LIST_KEY];

const isPlatformsConfirmed = (s: MessengerState) =>
  isConfirmed(s.platformsReplica, MESSENGER_LIST_KEY);

const isPlatformsSettled = (s: MessengerState) =>
  isSettled(platforms(s), isConfirmed(s.platformsReplica, MESSENGER_LIST_KEY));

const isLinksConfirmed = (s: MessengerState) => isConfirmed(s.linksReplica, MESSENGER_LIST_KEY);

const isLinksSettled = (s: MessengerState) =>
  isSettled(links(s), isConfirmed(s.linksReplica, MESSENGER_LIST_KEY));

const linksByPlatform = (platform: string) => (s: MessengerState) =>
  links(s)?.filter((link) => link.platform === platform);

const installationsByPlatform = (platform: string) => (s: MessengerState) =>
  installations(s)?.filter((installation) => installation.platform === platform);

/**
 * One platform's detail can render: both lists are known, and either the local
 * copy already shows a connection for this platform or the server confirmed
 * both lists — a restored copy without one may predate a new connection.
 */
const isPlatformDataSettled = (platform: string) => (s: MessengerState) => {
  const platformLinks = linksByPlatform(platform)(s);
  const platformInstallations = installationsByPlatform(platform)(s);
  if (!platformLinks || !platformInstallations) return false;
  if (platformLinks.length > 0 || platformInstallations.length > 0) return true;
  return (
    isConfirmed(s.linksReplica, MESSENGER_LIST_KEY) &&
    isConfirmed(s.installationsReplica, MESSENGER_LIST_KEY)
  );
};

const bindingAgents = (workspaceId: string | null) => (s: MessengerState) =>
  s.bindingAgentsMap[messengerBindingAgentsKey({ workspaceId })];

const isBindingAgentsSettled = (workspaceId: string | null) => (s: MessengerState) =>
  isSettled(
    bindingAgents(workspaceId)(s),
    isConfirmed(s.bindingAgentsReplica, messengerBindingAgentsKey({ workspaceId })),
  );

const isBindingAgentsConfirmed = (workspaceId: string | null) => (s: MessengerState) =>
  isConfirmed(s.bindingAgentsReplica, messengerBindingAgentsKey({ workspaceId }));

const pushWindow = (params: MessengerPushWindowParams) => (s: MessengerState) =>
  s.pushWindowMap[messengerPushWindowKey(params)];

export const messengerSelectors = {
  bindingAgents,
  bindingScopes,
  installations,
  installationsByPlatform,
  isBindingAgentsConfirmed,
  isBindingAgentsSettled,
  isLinksConfirmed,
  isLinksSettled,
  isPlatformDataSettled,
  isPlatformsConfirmed,
  isPlatformsSettled,
  links,
  linksByPlatform,
  platforms,
  pushWindow,
};
