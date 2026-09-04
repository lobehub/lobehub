'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';

import { useResolvedAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { useParams } from '@/libs/router/navigation';
import { useElectronStore } from '@/store/electron';

import { resolveActiveConversationCoordinate } from './coordinate';
import { subscribeActiveConversationNavigation } from './navigation';
import { projectActiveConversationCoordinate } from './projectCoordinate';

const ActiveConversationBridge = () => {
  const params = useParams<{ aid?: string; gid?: string; topicId?: string }>(
    'aid',
    'gid',
    'topicId',
  );
  const url = useElectronStore(selectActiveTabUrl) || '/';
  const { agentId } = useResolvedAgentRouteId(params.aid);
  const coordinate = useMemo(
    () =>
      resolveActiveConversationCoordinate({
        params,
        resolvedAgentId: agentId,
        url,
      }),
    [agentId, params, url],
  );
  const coordinateRef = useRef(coordinate);
  coordinateRef.current = coordinate;

  useLayoutEffect(() => {
    projectActiveConversationCoordinate(coordinate);
  }, [coordinate]);

  useLayoutEffect(() => {
    return subscribeActiveConversationNavigation(() => coordinateRef.current);
  }, []);

  return null;
};

export default ActiveConversationBridge;
