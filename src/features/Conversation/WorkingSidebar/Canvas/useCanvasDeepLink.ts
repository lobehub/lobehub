import { CANVAS_OPEN_QUERY } from '@lobechat/builtin-tool-canvas';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';

const CANVAS_ID_PATTERN = /^cvs_[\w-]+$/;

/** Opens the Canvas named by a tool-result link once the topic route has hydrated. */
export const useCanvasDeepLink = (topicId?: string) => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const handledRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!topicId) return;

    const searchParams = new URLSearchParams(location.search);
    const canvasId = searchParams.get(CANVAS_OPEN_QUERY);
    if (!canvasId || !CANVAS_ID_PATTERN.test(canvasId)) return;

    const deepLinkKey = `${topicId}:${canvasId}`;
    if (handledRef.current === deepLinkKey) return;
    handledRef.current = deepLinkKey;

    useChatStore.getState().openCanvas(canvasId);

    searchParams.delete(CANVAS_OPEN_QUERY);
    const search = searchParams.toString();
    navigate(`${location.pathname}${search ? `?${search}` : ''}${location.hash}`, {
      replace: true,
    });
  }, [location.hash, location.pathname, location.search, navigate, topicId]);
};
