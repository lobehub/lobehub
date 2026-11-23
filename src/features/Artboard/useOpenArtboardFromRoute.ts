import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

import { useChatStore } from '@/store/chat';

import { openBoardPanel } from './Conversation/openBoardPanel';
import { useArtboard } from './data/useArtboard';
import { loadArtboardTool } from './loadArtboardTool';
import { artboardActions } from './store';
import { useArtboardFeature } from './useArtboardFeature';

export const ARTBOARD_SEARCH_PARAM = 'artboard';

export const useOpenArtboardFromRoute = () => {
  const { enabled } = useArtboardFeature();
  const [params, setParams] = useSearchParams();
  const artboardId = params.get(ARTBOARD_SEARCH_PARAM);
  const topicId = useChatStore((s) => s.activeTopicId);
  const { data } = useArtboard(artboardId ?? undefined);
  const boardTopicId = data?.artboard.topicId;

  useEffect(() => {
    if (!enabled || !artboardId || !topicId || boardTopicId !== topicId) return;
    let cancelled = false;
    void loadArtboardTool().then(() => {
      if (cancelled) return;
      artboardActions.forgetPage(artboardId);
      openBoardPanel(artboardId);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(ARTBOARD_SEARCH_PARAM);
          return next;
        },
        { replace: true },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [artboardId, boardTopicId, enabled, setParams, topicId]);
};
