import { useChatStore } from '@/store/chat/store';

import { isArtboardEnabled } from '../useArtboardFeature';
import { ARTBOARD_TOOL } from './tool';

export const openBoardPanel = (toolMessageId?: string, artboardId?: string) => {
  if (!isArtboardEnabled()) return;
  useChatStore
    .getState()
    .openToolUI(toolMessageId ?? '', ARTBOARD_TOOL, artboardId ? { artboardId } : undefined);
};
