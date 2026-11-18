import { createReplicaSlice, recordLens } from '@/libs/replica';
import { messengerService } from '@/services/messenger';
import type { StoreSetter } from '@/store/types';

import type { MessengerState } from './initialState';
import {
  type MessengerBindingAgent,
  messengerBindingAgentsResource,
  type MessengerBindingScope,
  messengerBindingScopesResource,
  type MessengerInstallationItem,
  messengerInstallationsResource,
  type MessengerLinkItem,
  messengerLinksResource,
  type MessengerPlatformItem,
  messengerPlatformsResource,
  type MessengerPushWindow,
  messengerPushWindowResource,
  toPersistedMessengerInstallations,
} from './projection';

type Setter = StoreSetter<MessengerState>;

export class MessengerPrivateAction {
  readonly bindingAgents;
  readonly bindingScopes;
  readonly installations;
  readonly links;
  readonly platforms;
  readonly pushWindow;

  constructor(set: Setter, get: () => MessengerState) {
    this.platforms = createReplicaSlice(messengerPlatformsResource, {
      actionPrefix: 'messenger/platforms',
      fetcher: () => messengerService.availablePlatforms(),
      get,
      set,
      stateKey: 'platformsReplica',
      view: recordLens<MessengerState, MessengerPlatformItem[]>('platformsMap'),
    });
    this.links = createReplicaSlice(messengerLinksResource, {
      actionPrefix: 'messenger/links',
      fetcher: () => messengerService.listMyLinks(),
      get,
      set,
      stateKey: 'linksReplica',
      view: recordLens<MessengerState, MessengerLinkItem[]>('linksMap'),
    });
    this.installations = createReplicaSlice(messengerInstallationsResource, {
      actionPrefix: 'messenger/installations',
      fetcher: () => messengerService.listMyInstallations(),
      get,
      set,
      stateKey: 'installationsReplica',
      toPersisted: toPersistedMessengerInstallations,
      view: recordLens<MessengerState, MessengerInstallationItem[]>('installationsMap'),
    });
    this.bindingScopes = createReplicaSlice(messengerBindingScopesResource, {
      actionPrefix: 'messenger/bindingScopes',
      fetcher: () => messengerService.listBindingScopes(),
      get,
      set,
      stateKey: 'bindingScopesReplica',
      view: recordLens<MessengerState, MessengerBindingScope[]>('bindingScopesMap'),
    });
    this.bindingAgents = createReplicaSlice(messengerBindingAgentsResource, {
      actionPrefix: 'messenger/bindingAgents',
      fetcher: ({ workspaceId }) => messengerService.listAgentsForBinding(workspaceId),
      get,
      set,
      stateKey: 'bindingAgentsReplica',
      view: recordLens<MessengerState, MessengerBindingAgent[]>('bindingAgentsMap'),
    });
    this.pushWindow = createReplicaSlice(messengerPushWindowResource, {
      actionPrefix: 'messenger/pushWindow',
      fetcher: ({ platform, tenantId }) =>
        messengerService.getMessengerPushWindow(platform, tenantId),
      get,
      set,
      stateKey: 'pushWindowReplica',
      view: recordLens<MessengerState, MessengerPushWindow>('pushWindowMap'),
    });
  }
}
