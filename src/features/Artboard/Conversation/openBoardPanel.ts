import { useChatStore } from '@/store/chat/store';

import { ARTBOARD_TOOL } from './tool';

export const openBoardPanel = (toolMessageId: string) =>
  useChatStore.getState().openToolUI(toolMessageId, ARTBOARD_TOOL);
