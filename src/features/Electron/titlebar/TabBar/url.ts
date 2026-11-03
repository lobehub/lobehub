// Tab identity ignores the fragment: `/settings/agent#llm` and `/settings/agent`
// are the same tab, so an anchor jump keeps the tab's cached meta instead of
// looking like a navigation to a different page.
export const normalizeTabUrl = (url: string): string => {
  const [withoutHash = ''] = url.split('#');
  const [rawPath = '', rawQuery = ''] = withoutHash.split('?');

  let pathname = rawPath || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.replace(/\/+$/, '') || '/';
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;

  const queryString = rawQuery;
  if (!queryString) return pathname;

  const params = new URLSearchParams(queryString);
  const entries = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return pathname;

  const sorted = new URLSearchParams();
  for (const [key, value] of entries) sorted.append(key, value);

  return `${pathname}?${sorted.toString()}`;
};

export interface AgentTabContext {
  agentId: string;
  topicId: string | null;
  workspaceSlug?: string;
}

const WORKSPACE_AGENT_TOPIC_PATH = /^\/([^/]+)\/agent\/([^/]+)\/(tpc_[^/]+)(?:\/|$)/;
const WORKSPACE_AGENT_PATH = /^\/([^/]+)\/agent\/([^/]+)(?:\/|$)/;
const AGENT_TOPIC_PATH = /^\/agent\/([^/]+)\/(tpc_[^/]+)(?:\/|$)/;
const AGENT_PATH = /^\/agent\/([^/]+)(?:\/|$)/;

export const parseAgentTabContext = (url: string): AgentTabContext | null => {
  const [withoutHash = ''] = url.split('#');
  const [rawPath = '', rawQuery = ''] = withoutHash.split('?');

  const workspaceTopicMatch = rawPath.match(WORKSPACE_AGENT_TOPIC_PATH);
  if (workspaceTopicMatch) {
    return {
      agentId: workspaceTopicMatch[2],
      topicId: workspaceTopicMatch[3],
      workspaceSlug: workspaceTopicMatch[1],
    };
  }

  const topicMatch = rawPath.match(AGENT_TOPIC_PATH);
  if (topicMatch) return { agentId: topicMatch[1], topicId: topicMatch[2] };

  const workspaceAgentMatch = rawPath.match(WORKSPACE_AGENT_PATH);
  if (workspaceAgentMatch) {
    const queryTopic = new URLSearchParams(rawQuery).get('topic');
    return {
      agentId: workspaceAgentMatch[2],
      topicId: queryTopic || null,
      workspaceSlug: workspaceAgentMatch[1],
    };
  }

  const agentMatch = rawPath.match(AGENT_PATH);
  if (!agentMatch) return null;

  const queryTopic = new URLSearchParams(rawQuery).get('topic');
  return { agentId: agentMatch[1], topicId: queryTopic || null };
};
