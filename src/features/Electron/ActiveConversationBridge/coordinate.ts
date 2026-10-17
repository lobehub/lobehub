export interface ActiveConversationCoordinate {
  agentBasePath?: string;
  agentId?: string;
  groupBasePath?: string;
  groupId?: string;
  hash: string;
  isConversation: boolean;
  pathname: string;
  projectBasePath?: string;
  projectId?: string;
  routeAgentId?: string;
  search: string;
  threadId: string | null;
  topicId: string | null;
}

interface ResolveActiveConversationCoordinateOptions {
  params: { aid?: string; gid?: string; projectId?: string; topicId?: string };
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
  const groupSegmentIndex = params.gid ? segments.lastIndexOf('group') : -1;
  const suffixLength = agentSegmentIndex < 0 ? -1 : segments.length - agentSegmentIndex - 2;
  const agentConversation =
    !!params.aid &&
    agentSegmentIndex >= 0 &&
    (suffixLength === 0 || (suffixLength === 1 && params.topicId !== undefined));
  const groupSuffixLength = groupSegmentIndex < 0 ? -1 : segments.length - groupSegmentIndex - 2;
  const groupConversation =
    !!params.gid &&
    groupSegmentIndex >= 0 &&
    (groupSuffixLength === 0 || (groupSuffixLength === 1 && params.topicId !== undefined));
  // Locate the route root structurally: a project slug may itself be named
  // "project", so a plain lastIndexOf could land on the slug segment instead.
  const projectSegmentIndex = params.projectId
    ? segments.findIndex(
        (segment, index) =>
          segment === 'project' &&
          segments[index + 1] === params.projectId &&
          segments[index + 2] === 'conversation',
      )
    : -1;
  const projectSuffixLength =
    projectSegmentIndex < 0 || segments[projectSegmentIndex + 2] !== 'conversation'
      ? -1
      : segments.length - projectSegmentIndex - 3;
  const projectConversation =
    !!params.projectId &&
    projectSegmentIndex >= 0 &&
    segments[projectSegmentIndex + 1] === params.projectId &&
    segments[projectSegmentIndex + 2] === 'conversation' &&
    (projectSuffixLength === 0 || (projectSuffixLength === 1 && params.topicId !== undefined));
  const isConversation = agentConversation || groupConversation || projectConversation;
  const agentBasePath =
    agentSegmentIndex >= 0 ? `/${segments.slice(0, agentSegmentIndex + 2).join('/')}` : undefined;
  const groupBasePath =
    groupSegmentIndex >= 0 ? `/${segments.slice(0, groupSegmentIndex + 2).join('/')}` : undefined;
  const projectBasePath = projectConversation
    ? `/${segments.slice(0, projectSegmentIndex + 3).join('/')}`
    : undefined;

  return {
    agentBasePath,
    agentId: params.aid ? resolvedAgentId || params.aid : undefined,
    groupBasePath,
    groupId: groupSegmentIndex >= 0 ? params.gid : undefined,
    hash: location.hash,
    isConversation,
    pathname: location.pathname,
    projectBasePath,
    projectId: projectConversation ? params.projectId : undefined,
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
  const basePath =
    coordinate.groupBasePath || coordinate.agentBasePath || coordinate.projectBasePath;
  if (!basePath) {
    return `${coordinate.pathname}${coordinate.search}${coordinate.hash}`;
  }

  const searchParams = new URLSearchParams(coordinate.search);
  searchParams.delete('topic');

  if (threadId) searchParams.set('thread', threadId);
  else searchParams.delete('thread');

  const pathname = topicId ? `${basePath}/${topicId}` : basePath;
  const search = searchParams.toString();

  return `${pathname}${search ? `?${search}` : ''}${coordinate.hash}`;
};
