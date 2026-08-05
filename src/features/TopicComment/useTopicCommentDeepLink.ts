import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';

const COMMENT_QUERY = 'comment';
const COMMENT_THREAD_QUERY = 'commentThread';

/** Opens a notification deep link once topic route hydration has completed. */
export const useTopicCommentDeepLink = (topicId?: string) => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const handledRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!topicId) return;

    const searchParams = new URLSearchParams(location.search);
    const rootCommentId = searchParams.get(COMMENT_THREAD_QUERY);
    if (!rootCommentId) return;

    const focusCommentId = searchParams.get(COMMENT_QUERY) ?? rootCommentId;
    const deepLinkKey = `${topicId}:${rootCommentId}:${focusCommentId}`;
    if (handledRef.current === deepLinkKey) return;
    handledRef.current = deepLinkKey;

    const { openTopicComments, openTopicCommentThread } = useChatStore.getState();
    openTopicComments(topicId);
    openTopicCommentThread(topicId, rootCommentId, undefined, undefined, focusCommentId);

    searchParams.delete(COMMENT_QUERY);
    searchParams.delete(COMMENT_THREAD_QUERY);
    const search = searchParams.toString();
    navigate(`${location.pathname}${search ? `?${search}` : ''}${location.hash}`, {
      replace: true,
    });
  }, [location.hash, location.pathname, location.search, navigate, topicId]);
};
