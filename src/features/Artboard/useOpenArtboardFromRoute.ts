import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

import { useChatStore } from '@/store/chat';

import { openBoardPanel } from './Conversation/openBoardPanel';
import { ARTBOARD_TOOL } from './Conversation/tool';
import { useArtboard } from './data/useArtboard';
import { loadArtboardTool } from './loadArtboardTool';
import { artboardActions } from './store';
import { useArtboardFeature } from './useArtboardFeature';

export const ARTBOARD_SEARCH_PARAM = 'artboard';

const findBoardToolMessage =
  (artboardId: string) => (s: ReturnType<typeof useChatStore.getState>) =>
    Object.values(s.dbMessagesMap)
      .flat()
      .find(
        (m) =>
          m.plugin?.identifier === ARTBOARD_TOOL &&
          (m.pluginState as { artboardId?: string } | undefined)?.artboardId === artboardId,
      )?.id;

export const useOpenArtboardFromRoute = () => {
  const { enabled } = useArtboardFeature();
  const [params, setParams] = useSearchParams();
  const artboardId = params.get(ARTBOARD_SEARCH_PARAM);
  const messageId = useChatStore(artboardId ? findBoardToolMessage(artboardId) : () => undefined);
  const topicId = useChatStore((s) => s.activeTopicId);
  const { data } = useArtboard(artboardId && !messageId ? artboardId : undefined);
  const boardTopicId = data?.artboard.topicId;

  useEffect(() => {
    if (!enabled || !artboardId || (!messageId && (!topicId || boardTopicId !== topicId))) return;
    let cancelled = false;
    void loadArtboardTool().then(() => {
      if (cancelled) return;
      artboardActions.forgetPage(artboardId);
      if (messageId) openBoardPanel(messageId);
      else openBoardPanel(undefined, artboardId);
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
  }, [artboardId, boardTopicId, enabled, messageId, setParams, topicId]);
};
