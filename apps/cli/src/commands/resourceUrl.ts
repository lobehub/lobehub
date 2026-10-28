import type { TrpcClient } from '../api/client';
import { resolveServerUrl } from '../settings';
import { buildAppUrl, resolveAppUrlBuilder, taskPath } from './task/url';

/**
 * Web paths of the entities `lh` prints, matching the SPA routes (and the
 * command menu's navigation). Each returns `undefined` when the entity lacks
 * the ids its page needs, so JSON output simply omits the `url` field.
 */
type Id = string | null | undefined;

const seg = (value: string) => encodeURIComponent(value);

const libraryItemPath = (id: string, knowledgeBaseId: Id) =>
  `/resource/library/${seg(knowledgeBaseId!)}?file=${seg(id)}`;

export const resourcePath = {
  acceptance: (id: Id) => (id ? `/acceptance/${seg(id)}` : undefined),
  agent: (id: Id) => (id ? `/agent/${seg(id)}` : undefined),
  dashboard: (dashboard: { id?: Id; projectId?: Id }) => {
    if (!dashboard.id) return undefined;
    return dashboard.projectId
      ? `/project/${seg(dashboard.projectId)}/dashboard/${seg(dashboard.id)}`
      : `/dashboard/${seg(dashboard.id)}`;
  },
  /** A document opens inside its library when it has one, else as a standalone page. */
  document: (doc: { id?: Id; knowledgeBaseId?: Id }) => {
    if (!doc.id) return undefined;
    return doc.knowledgeBaseId
      ? libraryItemPath(doc.id, doc.knowledgeBaseId)
      : `/page/${seg(doc.id)}`;
  },
  file: (file: { id?: Id; knowledgeBaseId?: Id }) => {
    if (!file.id) return undefined;
    return file.knowledgeBaseId
      ? libraryItemPath(file.id, file.knowledgeBaseId)
      : `/resource?file=${seg(file.id)}`;
  },
  goal: (id: Id) => (id ? `/goal/${seg(id)}` : undefined),
  group: (id: Id) => (id ? `/group/${seg(id)}` : undefined),
  knowledgeBase: (id: Id) => (id ? `/resource/library/${seg(id)}` : undefined),
  /** A message anchors inside its topic, or its agent/group chat when it has no topic. */
  message: (message: { agentId?: Id; groupId?: Id; id?: Id; topicId?: Id }) => {
    if (!message.id) return undefined;
    const base = message.topicId
      ? resourcePath.topic({
          agentId: message.agentId,
          groupId: message.groupId,
          id: message.topicId,
        })
      : (resourcePath.agent(message.agentId) ?? resourcePath.group(message.groupId));
    return base ? `${base}#${seg(message.id)}` : undefined;
  },
  project: (id: Id) => (id ? `/project/${seg(id)}` : undefined),
  provider: (id: Id) => (id ? `/settings/provider/${seg(id)}` : undefined),
  task: (task: { id?: Id; identifier?: Id; name?: Id }) =>
    task.identifier || task.id ? taskPath((task.identifier ?? task.id)!, task.name) : undefined,
  topic: (topic: { agentId?: Id; groupId?: Id; id?: Id }) => {
    if (!topic.id) return undefined;
    if (topic.groupId) return `/group/${seg(topic.groupId)}/${seg(topic.id)}`;
    if (topic.agentId) return `/agent/${seg(topic.agentId)}/${seg(topic.id)}`;
    return undefined;
  },
};

/** Mirrors the command menu's navigation for a unified `lh search` hit. */
export const searchResultPath = (item: Record<string, any>): string | undefined => {
  switch (item.type) {
    case 'agent': {
      return resourcePath.agent(item.id);
    }
    case 'chatGroup': {
      return resourcePath.group(item.id);
    }
    case 'topic': {
      return resourcePath.topic(item);
    }
    case 'message': {
      return resourcePath.message(item);
    }
    case 'file': {
      return resourcePath.file(item);
    }
    case 'page': {
      return item.id ? `/page/${seg(item.id)}` : undefined;
    }
    case 'knowledgeBase': {
      return resourcePath.knowledgeBase(item.id);
    }
    case 'task': {
      return resourcePath.task({ id: item.id, identifier: item.identifier, name: item.title });
    }
    case 'mcp':
    case 'plugin': {
      return item.identifier ? `/community/mcp/${seg(item.identifier)}` : undefined;
    }
    case 'communityAgent': {
      return item.identifier ? `/community/agent/${seg(item.identifier)}` : undefined;
    }
    case 'memory': {
      return item.id ? `/memory/preferences?preferenceId=${seg(item.id)}` : undefined;
    }
    default: {
      return undefined;
    }
  }
};

/** A workspace's home, built from its own slug rather than the active scope. */
export const workspaceUrl = (workspace: { slug?: Id }) =>
  workspace.slug
    ? buildAppUrl({
        pathname: '/',
        serverUrl: resolveServerUrl(),
        workspaceSlug: workspace.slug,
      }).replace(/\/$/, '')
    : undefined;

export type UrlBuilder = (pathname: string | undefined) => string | undefined;

/**
 * Best-effort link builder for JSON output: a read must not fail over a link,
 * and an operation-token run may be refused the workspace lookup behind it.
 */
export const resolveUrlBuilder = async (client: TrpcClient): Promise<UrlBuilder> => {
  try {
    const buildUrl = await resolveAppUrlBuilder(client);
    return (pathname) => (pathname ? buildUrl(pathname) : undefined);
  } catch {
    return () => undefined;
  }
};

/**
 * Appends the web link as `url`; items whose page can't be resolved are left
 * as-is. Entities that already own a `url` (a file's storage address) keep it
 * and get the link as `appUrl` instead.
 */
export const withUrls = <T extends object>(
  items: T[],
  toUrl: UrlBuilder,
  toPath: (item: T) => string | undefined,
): T[] => items.map((item) => withUrl(item, toUrl, toPath(item)));

export const withUrl = <T extends object>(
  item: T,
  toUrl: UrlBuilder,
  pathname: string | undefined,
): T => {
  const url = toUrl(pathname);
  // A not-found read can come back as `null`; pass it through untouched.
  if (!url || !item || typeof item !== 'object') return item;
  return 'url' in item ? { ...item, appUrl: url } : { ...item, url };
};
