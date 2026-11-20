import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';

import { type LobehubSkillServer, type LobehubSkillTool } from './types';

/** The user's connected LobeHub Skill providers are one list entry per scope. */
export const LOBEHUB_SKILL_SERVERS_KEY = 'all';

/**
 * The user's connected LobeHub Skill providers (`connectListConnections`): a
 * local-first replica, so the settings / skill-store / chat-input surfaces paint
 * the persisted list on the first frame and the network only confirms it.
 *
 * The list is not partitioned per container, so every sync shares one key.
 */
export const lobehubSkillServersResource = defineReplica<
  Record<string, never>,
  LobehubSkillServer[]
>({
  key: () => LOBEHUB_SKILL_SERVERS_KEY,
  name: 'lobehubSkillServers',
  storage: 'indexedDB',
  version: 1,
});

/** A provider is addressed by its `identifier` across the tool store. */
export const lobehubSkillServersEntity: ReplicaEntityAdapter<
  LobehubSkillServer[],
  LobehubSkillServer
> = arrayEntity<LobehubSkillServer>((server) => server.identifier);

/**
 * One provider's tool catalog (`connectListTools`), keyed by provider id.
 * Read-only and shared by the skill detail surfaces, so a persisted copy paints
 * the tools before the network answers.
 */
export const lobehubSkillProviderToolsResource = defineReplica<string, LobehubSkillTool[]>({
  key: (provider) => provider,
  name: 'lobehubSkillProviderTools',
  storage: 'indexedDB',
  version: 1,
});

/**
 * The value a tool catalog is normalized to before it enters the replica: the
 * market response carries fields the UI never reads, so only the shape the
 * detail surfaces render is kept.
 */
export const mapProviderTools = (tools: unknown): LobehubSkillTool[] =>
  ((tools as any[]) || []).map((tool) => ({
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
  }));

/**
 * Local intent of the connections replica that the server has not echoed yet:
 * rows this client wrote, and rows it revoked. Kept only until a response
 * reflects them.
 */
export interface LobehubSkillLocalIntent {
  /** Written rows, by `identifier` — re-appended until the server echoes them. */
  added: Map<string, LobehubSkillServer>;
  /** Revoked `identifier`s — hidden until a response confirms they are gone. */
  removed: Set<string>;
}

export const createLobehubSkillLocalIntent = (): LobehubSkillLocalIntent => ({
  added: new Map(),
  removed: new Set(),
});

/**
 * Folds a connections response into the replica without discarding local intent
 * the response predates.
 *
 * An OAuth completion writes a row (and a disconnect drops one), but a
 * `connectListConnections` response that was already in flight when the write
 * happened still arrives afterwards and `replace`s the whole value: the
 * just-connected row would vanish, or the just-revoked one would come back.
 * `replace` carries no request ordering, so the response is merged instead of
 * trusted blindly: a pending add is re-appended until the server echoes it, a
 * pending removal stays hidden until a response confirms it is gone. Each
 * settles the moment a response reflects it, after which the server is
 * authoritative again.
 *
 * The list response also carries no tool catalog, so a confirmed row's tools
 * are carried over whenever the response omits them — the agent tool list keeps
 * resolving a connected provider even if the follow-up `connectListTools` call
 * fails.
 */
export const mergeLobehubSkillServers = (
  incoming: LobehubSkillServer[],
  intent: LobehubSkillLocalIntent,
  confirmed?: LobehubSkillServer[],
): LobehubSkillServer[] => {
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

  // `connectListConnections` carries no tool catalog, so the response alone
  // would drop the tools a confirmed row already holds. Keep them until a
  // `connectListTools` success replaces them: a transient tool-fetch failure
  // must not remove a connected provider from the agent tool list while a
  // usable persisted catalog still exists.
  const cachedTools = new Map<string, LobehubSkillTool[]>();
  for (const server of confirmed ?? []) {
    if (server.tools?.length) cachedTools.set(server.identifier, server.tools);
  }
  const keepTools = (server: LobehubSkillServer): LobehubSkillServer => {
    if (server.tools?.length) return server;
    const tools = cachedTools.get(server.identifier);
    return tools ? { ...server, tools } : server;
  };
  const withCachedTools = (list: LobehubSkillServer[]): LobehubSkillServer[] => {
    if (cachedTools.size === 0) return list;
    const next = list.map(keepTools);
    // Return the original list when nothing gained tools, so an unchanged
    // response keeps its reference (no needless write).
    return next.some((server, index) => server !== list[index]) ? next : list;
  };

  const keptWithTools = withCachedTools(kept);
  const carriedWithTools = withCachedTools(carried);

  if (carriedWithTools.length === 0 && keptWithTools === incoming) return incoming;

  return [...keptWithTools, ...carriedWithTools];
};
