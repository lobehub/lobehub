import type { UIChatMessage } from '@lobechat/types';

import { isLocalOnlyMessage } from '@/store/chat/utils/localMessages';

export const getMessageInteractionState = (
  message: UIChatMessage | undefined,
  disableEditing?: boolean,
) => {
  const isLocalOnly = isLocalOnlyMessage(message);

  return {
    effectiveDisableEditing: Boolean(disableEditing || isLocalOnly),
    shouldSuppressContextMenu: isLocalOnly,
  };
};

export const getMessageContextMenuAction = (target: EventTarget, suppress: boolean) => {
  // Let the platform hit-test the actual image for its Copy Image command.
  if (target instanceof HTMLImageElement) return 'native';
  return suppress ? 'suppress' : 'message';
};
