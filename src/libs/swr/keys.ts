/**
 * Central SWR key registry
 *
 * Single source of truth for SWR cache keys, organized by business domain and
 * named with one convention: the first array element is `'<domain>:<resource>'`
 * (lowerCamel resource), followed by parameters.
 *
 * Benefits:
 * - Consistent, discoverable naming (`swrKeys.topic.list(...)`).
 * - The `domain:` prefix lets the tiered cache provider route persistence by
 *   domain (see `localStorageProvider.ts`) and lets callers refresh a whole
 *   domain at once via `matchDomain('topic:')`.
 *
 * Each factory also exposes `.root` (the namespace string) for `mutate`
 * matchers that compare `key[0]`.
 *
 * Document / page / notebook / agent-document keys are defined in
 * `@/services/document/swrKeys` (already a factory, widely imported) and
 * re-exported here so the whole set is reachable from one place.
 */
import {
  agentDocumentSWRKeys,
  documentSWRKeys,
  notebookSWRKeys,
} from '@/services/document/swrKeys';

type KeyFactory<A extends unknown[]> = ((...args: A) => readonly unknown[]) & { root: string };

/** Define a key factory carrying its namespace root (for `mutate` matchers). */
const def = <A extends unknown[]>(
  root: string,
  build: (...args: A) => readonly unknown[],
): KeyFactory<A> => Object.assign(build, { root });

// ---- message ------------------------------------------------------------
export const messageKeys = {
  /** Conversation store messages, keyed by request context. */
  list: def('message:list', (context: unknown) => ['message:list', context]),
  /** Legacy chat store messages, keyed by request context. */
  listLegacy: def('message:listLegacy', (context: unknown) => ['message:listLegacy', context]),
};

// ---- topic --------------------------------------------------------------
export const topicKeys = {
  agentView: def('topic:agentView', (containerKey: string, opts: Record<string, unknown>) => [
    'topic:agentView',
    containerKey,
    opts,
  ]),
  list: def('topic:list', (containerKey: string, opts: Record<string, unknown>) => [
    'topic:list',
    containerKey,
    opts,
  ]),
  search: def('topic:search', (keywords: string, agentId?: string, groupId?: string) => [
    'topic:search',
    keywords,
    agentId,
    groupId,
  ]),
};

// ---- agent --------------------------------------------------------------
export const agentKeys = {
  /** Sidebar agent list. */
  list: def('agent:list', (isLogin: boolean) => ['agent:list', isLogin]),
};

// ---- group --------------------------------------------------------------
export const groupKeys = {
  detail: def('group:detail', (groupId: string) => ['group:detail', groupId]),
};

// ---- task ---------------------------------------------------------------
export const taskKeys = {
  detail: def('task:detail', (taskId: string) => ['task:detail', taskId]),
  groupList: def('task:groupList', (agentKey: string | undefined) => ['task:groupList', agentKey]),
  list: def('task:list', (agentKey: string | undefined) => ['task:list', agentKey]),
};

// ---- brief --------------------------------------------------------------
export const briefKeys = {
  list: def('brief:list', (isLogin: boolean) => ['brief:list', isLogin]),
};

/**
 * Build a `mutate` matcher that selects every key in a `domain:` namespace.
 *
 * @example mutate(matchDomain('topic:')) // refresh all topic caches
 */
export const matchDomain =
  (prefix: string) =>
  (key: unknown): boolean =>
    Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith(prefix);

/**
 * Aggregate registry — one entry point for every domain's keys.
 */
export const swrKeys = {
  agent: agentKeys,
  agentDocument: agentDocumentSWRKeys,
  brief: briefKeys,
  document: documentSWRKeys,
  group: groupKeys,
  message: messageKeys,
  notebook: notebookSWRKeys,
  task: taskKeys,
  topic: topicKeys,
};
