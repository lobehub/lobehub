import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';

import { type ComposioServer, type ComposioTool } from './types';

/** The user's Composio connections are one list entry per scope. */
export const COMPOSIO_SERVERS_KEY = 'all';

/**
 * One `getComposioPlugins` response, stamped with the local-write sequence that
 * was current when the request was issued.
 *
 * A list response replaces the whole value and carries no ordering of its own,
 * so the stamp is what lets the slice tell a response the server produced
 * *before* a local write (which must not be applied) from one produced after it.
 */
export interface ComposioServersResponse {
  servers: ComposioServer[];
  /** `writeSeq` at the moment the request was issued. */
  since: number;
}

/**
 * The user's Composio connections (`getComposioPlugins`): a local-first replica
 * so the settings / skills surfaces paint the persisted list on the first frame
 * and let the network confirm it, and a connect / delete shows on the row at once.
 */
export const composioServersResource = defineReplica<
  Record<string, never>,
  ComposioServer[],
  ComposioServersResponse
>({
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
 * Folds a connections response into the replica.
 *
 * Returns `undefined` — the engine's "keep the current value" — when the
 * response was issued before the latest confirmed local write. Such a response
 * is the reported race: `getComposioPlugins` was already in flight when the
 * connect / delete / status refresh wrote the list, so its snapshot predates the
 * write and applying it wholesale would roll the row back — drop the
 * just-created row (the OAuth polling then early-returns on `Server not found`),
 * resurrect a just-deleted row, or revert a row just marked `active`. Dropping
 * the response makes the server authoritative again only once a request issued
 * after the write answers.
 *
 * A response issued after the write is still merged, not trusted blindly,
 * because the write is local-first and the server may not have adopted it yet:
 * a pending add (created, not yet echoed) is re-appended, and a pending removal
 * stays hidden until a response confirms it is gone. Each settles the moment a
 * response reflects it, after which the server is authoritative again.
 */
export const mergeComposioServers = (
  response: ComposioServersResponse,
  intent: ComposioLocalIntent,
  latestLocalWrite: number,
): ComposioServer[] | undefined => {
  if (response.since < latestLocalWrite) return undefined;

  const incoming = response.servers;
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
