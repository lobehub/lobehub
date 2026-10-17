import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useVerifyStore } from '@/store/verify';

export const useVerifyResultMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const operationId = useChatStore(chatPortalSelectors.verifyResultOperationId);
  const checkItemId = useChatStore(chatPortalSelectors.verifyResultCheckItemId);

  if (!operationId || !checkItemId) return;

  return {
    // The plan item id — the handle `lh verify` commands and evidence take.
    copyId: checkItemId,
    // Title reads the plan (state), the badge and body read the results — one replica entry.
    refresh: () => useVerifyStore.getState().refreshVerifyRun(operationId),
  };
};
