import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

import { useChatStore } from '@/store/chat';

import { openBoardPanel } from './Conversation/openBoardPanel';
import { ARTBOARD_TOOL } from './Conversation/tool';
import { loadArtboardTool } from './loadArtboardTool';

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
  const [params, setParams] = useSearchParams();
  const artboardId = params.get(ARTBOARD_SEARCH_PARAM);
  const messageId = useChatStore(artboardId ? findBoardToolMessage(artboardId) : () => undefined);

  useEffect(() => {
    if (!artboardId || !messageId) return;
    void loadArtboardTool().then(() => openBoardPanel(messageId));
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(ARTBOARD_SEARCH_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [artboardId, messageId, setParams]);
};
