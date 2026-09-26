import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

export const useVerifyResultMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const operationId = useChatStore(chatPortalSelectors.verifyResultOperationId);
  const checkItemId = useChatStore(chatPortalSelectors.verifyResultCheckItemId);

  if (!operationId || !checkItemId) return;

  return {
    // The plan item id — the handle `lh verify` commands and evidence take.
    copyId: checkItemId,
    // Title reads the plan (state), the badge and body read the results.
    refresh: () =>
      Promise.all([
        globalMutate(verifyKeys.state(operationId)),
        globalMutate(verifyKeys.results(operationId)),
      ]),
  };
};
