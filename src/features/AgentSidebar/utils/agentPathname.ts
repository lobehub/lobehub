export interface AgentPathnameInfo {
  agentId: string;
  prefix: string;
  segmentsAfterAgent: string[];
}

// TODO(agent-route): migrate Header/Nav and useThreadNavigation to this parser
// after this scoped bugfix lands, then remove the remaining substring checks.
export const parseAgentPathname = (pathname: string): AgentPathnameInfo | undefined => {
  const [pathOnly] = pathname.split(/[?#]/);
  const segments = pathOnly.split('/').filter(Boolean);
  const agentSegmentIndex = segments.indexOf('agent');

  if (agentSegmentIndex < 0) return;

  const agentId = segments[agentSegmentIndex + 1];
  if (!agentId) return;

  return {
    agentId,
    prefix: agentSegmentIndex > 0 ? `/${segments.slice(0, agentSegmentIndex).join('/')}` : '',
    segmentsAfterAgent: segments.slice(agentSegmentIndex + 2),
  };
};

export const buildPrefixedAgentRoutePath = (
  targetPath: string,
  route: AgentPathnameInfo | undefined,
  activeWorkspaceSlug: string | null,
) => {
  if (!route?.prefix || activeWorkspaceSlug) return targetPath;

  return `${route.prefix}${targetPath}`;
};
