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

/**
 * Local intent of the connections replica that the server has not echoed yet:
 * rows this client created, and rows it removed. Kept only until a response
 * reflects them.
 */
export interface ComposioLocalIntent {
  /** Created rows, by `identifier` — re-appended until the server echoes them. */
  added: Map<string, ComposioServer>;
  /** Removed `identifier`s — hidden until a response confirms they are gone. */
  removed: Set<string>;
}

export const createComposioLocalIntent = (): ComposioLocalIntent => ({
  added: new Map(),
  removed: new Set(),
});

/**
 * Folds a server list into the connections replica without discarding local
 * intent the response predates.
 *
 * A connect / disconnect writes the list, but a `getComposioPlugins` response
 * that was already in flight when the write happened still arrives afterwards
 * and `replace`s the whole value: the just-created row would vanish (and the
 * OAuth completion then early-returns because the server is "missing"), or the
 * just-deleted row would come back. `replace` carries no request ordering, so
 * the response is merged instead of trusted blindly: a pending add is
 * re-appended until the server echoes it, a pending removal stays hidden until
 * a response confirms it is gone. Each settles the moment a response reflects
 * it, after which the server is authoritative again.
 */
export const mergeComposioServers = (
  incoming: ComposioServer[],
  intent: ComposioLocalIntent,
): ComposioServer[] => {
  const echoed = new Set(incoming.map((server) => server.identifier));

  // A response confirms a pending add (echoed) or drop (gone): settle it.
  for (const identifier of intent.added.keys()) {
    if (echoed.has(identifier)) intent.added.delete(identifier);
  }
  for (const identifier of intent.removed) {
    if (!echoed.has(identifier)) intent.removed.delete(identifier);
  }

  const kept = intent.removed.size
    ? incoming.filter((server) => !intent.removed.has(server.identifier))
    : incoming;
  const carried = [...intent.added.values()];

  if (carried.length === 0 && kept === incoming) return incoming;

  return [...kept, ...carried];
};
