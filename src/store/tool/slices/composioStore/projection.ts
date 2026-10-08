import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';

import { type ComposioServer, type ComposioTool } from './types';

/** The user's Composio connections are one list entry per scope. */
export const COMPOSIO_SERVERS_KEY = 'all';

/**
 * The user's Composio connections (`getComposioPlugins`): a local-first replica
 * so the settings / skills surfaces paint the persisted list on the first frame
 * and let the network confirm it, and a connect / delete shows on the row at once.
 */
export const composioServersResource = defineReplica<Record<string, never>, ComposioServer[]>({
  key: () => COMPOSIO_SERVERS_KEY,
  name: 'composioServers',
  storage: 'indexedDB',
  version: 1,
});

/** A connection is addressed by its `identifier` across the tool store. */
export const composioServersEntity: ReplicaEntityAdapter<ComposioServer[], ComposioServer> =
  arrayEntity<ComposioServer>((server) => server.identifier);

/**
 * One Composio app's tool catalog (`getActions`), keyed by `appSlug`. Read-only
 * and shared across the skill detail surfaces, so a persisted copy paints the
 * tools before the network answers.
 */
export const composioAppToolsResource = defineReplica<string, ComposioTool[]>({
  key: (appSlug) => appSlug,
  name: 'composioAppTools',
  storage: 'indexedDB',
  version: 1,
});
