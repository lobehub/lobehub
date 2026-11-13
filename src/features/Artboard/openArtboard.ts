import { artboardService } from '@/services/artboard';

import { openBoardPanel } from './Conversation/openBoardPanel';
import { mutateArtboard } from './data/useArtboard';
import { openArtboardFullscreen } from './Gallery/loader';
import { loadArtboardTool } from './loadArtboardTool';
import { isArtboardEnabled } from './useArtboardFeature';

export const artboardOpensInPanel = (pathname: string, topicId: string | null | undefined) =>
  !!topicId && pathname.split('/').includes(topicId);

const conversationTopicOf = async (artboardId: string) => {
  if (!window.location.pathname.includes('/topic/')) return null;
  try {
    const view = await artboardService.get(artboardId);
    void mutateArtboard(artboardId, view);
    return view.artboard.topicId;
  } catch {
    return null;
  }
};

export const openArtboard = async (artboardId: string) => {
  if (!isArtboardEnabled()) return;
  const topicId = await conversationTopicOf(artboardId);
  if (!artboardOpensInPanel(window.location.pathname, topicId))
    return openArtboardFullscreen(artboardId);
  await loadArtboardTool();
  openBoardPanel(artboardId);
};
