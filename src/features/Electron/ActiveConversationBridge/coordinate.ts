export interface ActiveConversationCoordinate {
  agentBasePath?: string;
  agentId?: string;
  hash: string;
  isConversation: boolean;
  pathname: string;
  routeAgentId?: string;
  search: string;
  threadId: string | null;
  topicId: string | null;
}

interface ResolveActiveConversationCoordinateOptions {
  params: { aid?: string; topicId?: string };
  resolvedAgentId?: string;
  url: string;
}

export const resolveActiveConversationCoordinate = ({
  params,
  resolvedAgentId,
  url,
}: ResolveActiveConversationCoordinateOptions): ActiveConversationCoordinate => {
  const location = new URL(url, 'https://desktop.local');
  const segments = location.pathname.split('/').filter(Boolean);
  const agentSegmentIndex = segments.lastIndexOf('agent');
  const suffixLength = agentSegmentIndex < 0 ? -1 : segments.length - agentSegmentIndex - 2;
  const isConversation =
    !!params.aid &&
    agentSegmentIndex >= 0 &&
    (suffixLength === 0 || (suffixLength === 1 && params.topicId !== undefined));
  const agentBasePath =
    agentSegmentIndex >= 0 ? `/${segments.slice(0, agentSegmentIndex + 2).join('/')}` : undefined;

  return {
    agentBasePath,
    agentId: params.aid ? resolvedAgentId || params.aid : undefined,
    hash: location.hash,
    isConversation,
    pathname: location.pathname,
    routeAgentId: params.aid,
    search: location.search,
    threadId: isConversation ? location.searchParams.get('thread') : null,
    topicId: isConversation ? params.topicId || null : null,
  };
};

export const buildActiveConversationUrl = (
  coordinate: ActiveConversationCoordinate,
  topicId: string | null,
  threadId: string | null,
) => {
  if (!coordinate.agentBasePath) {
    return `${coordinate.pathname}${coordinate.search}${coordinate.hash}`;
  }

  const searchParams = new URLSearchParams(coordinate.search);
  searchParams.delete('topic');

  if (threadId) searchParams.set('thread', threadId);
  else searchParams.delete('thread');

  const pathname = topicId ? `${coordinate.agentBasePath}/${topicId}` : coordinate.agentBasePath;
  const search = searchParams.toString();

  return `${pathname}${search ? `?${search}` : ''}${coordinate.hash}`;
};
