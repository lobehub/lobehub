// The Share build stubs this specifier; a relative path would bypass the stub.
import { openArtboardFullscreen } from '@/features/Artboard/Gallery/loader';
import { artboardService } from '@/services/artboard';

import { openBoardPanel } from './Conversation/openBoardPanel';
import { mutateArtboard } from './data/useArtboard';
import { loadArtboardTool } from './loadArtboardTool';
import { isArtboardEnabled } from './useArtboardFeature';

export const artboardOpensInPanel = (pathname: string, topicId: string | null | undefined) =>
  !!topicId && pathname.split('/').includes(topicId);

// Every conversation route ends in its topic id (`/agent/:aid/:topicId`,
// `/project/:pid/topic/:topicId`, …); `artboardOpensInPanel` matches it, so
// no route shape is assumed here.
const conversationTopicOf = async (artboardId: string) => {
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
