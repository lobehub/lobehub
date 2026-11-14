import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type {
  MessengerBindingAgent,
  MessengerBindingScope,
  MessengerInstallationItem,
  MessengerLinkItem,
  MessengerPlatformItem,
  MessengerPushWindow,
} from './projection';

export interface MessengerState {
  /** Bindable agents, by `messengerBindingAgentsKey`. */
  bindingAgentsMap: Record<string, MessengerBindingAgent[]>;
  bindingAgentsReplica: ReplicaState<MessengerBindingAgent[]>;
  bindingScopesMap: Record<string, MessengerBindingScope[]>;
  bindingScopesReplica: ReplicaState<MessengerBindingScope[]>;
  installationsMap: Record<string, MessengerInstallationItem[]>;
  installationsReplica: ReplicaState<MessengerInstallationItem[]>;
  linksMap: Record<string, MessengerLinkItem[]>;
  linksReplica: ReplicaState<MessengerLinkItem[]>;
  platformsMap: Record<string, MessengerPlatformItem[]>;
  platformsReplica: ReplicaState<MessengerPlatformItem[]>;
  /** Send-window status, by `messengerPushWindowKey`; memory only. */
  pushWindowMap: Record<string, MessengerPushWindow>;
  pushWindowReplica: ReplicaState<MessengerPushWindow>;
}

export const initialMessengerState: MessengerState = {
  bindingAgentsMap: {},
  bindingAgentsReplica: createReplicaState(),
  bindingScopesMap: {},
  bindingScopesReplica: createReplicaState(),
  installationsMap: {},
  installationsReplica: createReplicaState(),
  linksMap: {},
  linksReplica: createReplicaState(),
  platformsMap: {},
  platformsReplica: createReplicaState(),
  pushWindowMap: {},
  pushWindowReplica: createReplicaState(),
};
