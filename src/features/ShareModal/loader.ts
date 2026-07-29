import { type ModalInstance } from '@lobehub/ui/base-ui';

import { type OpenShareModalOptions } from './Modal';

const importShareModal = () => import('./Modal');

let shareModalModulePromise: ReturnType<typeof importShareModal> | undefined;

export const preloadShareModal = (): ReturnType<typeof importShareModal> =>
  (shareModalModulePromise ??= importShareModal().catch((error) => {
    shareModalModulePromise = undefined;
    throw error;
  }));

export const openShareModal = async (options?: OpenShareModalOptions): Promise<ModalInstance> => {
  const { openShareModal: createShareModal } = await preloadShareModal();

  return createShareModal(options);
};
