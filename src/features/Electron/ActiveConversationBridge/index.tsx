'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useResolvedAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';

import { resolveActiveConversationCoordinate } from './coordinate';
import { subscribeActiveConversationNavigation } from './navigation';
import { projectActiveConversationCoordinate } from './projectCoordinate';

const ActiveConversationBridge = () => {
  const params = useActiveRouteParams<{
    aid?: string;
    gid?: string;
    projectId?: string;
    topicId?: string;
  }>();
  const url = useElectronStore(selectActiveTabUrl) || '/';
  const { agentId } = useResolvedAgentRouteId(params.aid);
  const workspaceSlug = useActiveWorkspaceSlug();
  // Re-project once the inbox id hydrates so Home adopts it after a cold boot.
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const coordinate = useMemo(
    () =>
      resolveActiveConversationCoordinate({
        params,
        resolvedAgentId: agentId,
        url,
        workspaceSlug,
      }),
    [agentId, params, url, workspaceSlug],
  );
  const coordinateRef = useRef(coordinate);
  coordinateRef.current = coordinate;

  useLayoutEffect(() => {
    projectActiveConversationCoordinate(coordinate);
  }, [coordinate, inboxAgentId]);

  useLayoutEffect(() => {
    return subscribeActiveConversationNavigation(() => coordinateRef.current);
  }, []);

  return null;
};

export default ActiveConversationBridge;
