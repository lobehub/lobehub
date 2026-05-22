export const normalizeTabUrl = (url: string): string => {
  const [rawPath = '', rawQuery = ''] = url.split('?');

  let pathname = rawPath || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.replace(/\/+$/, '') || '/';
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;

  const queryString = rawQuery.split('#')[0] ?? '';
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
}

const AGENT_TOPIC_PATH = /^\/agent\/([^/]+)\/(tpc_[^/]+)(?:\/|$)/;
const AGENT_PATH = /^\/agent\/([^/]+)(?:\/|$)/;

export const parseAgentTabContext = (url: string): AgentTabContext | null => {
  const [rawPath = '', rawQuery = ''] = url.split('?');

  const topicMatch = rawPath.match(AGENT_TOPIC_PATH);
  if (topicMatch) return { agentId: topicMatch[1], topicId: topicMatch[2] };

  const agentMatch = rawPath.match(AGENT_PATH);
  if (!agentMatch) return null;

  const queryTopic = new URLSearchParams(rawQuery.split('#')[0] ?? '').get('topic');
  return { agentId: agentMatch[1], topicId: queryTopic || null };
};
