'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';

import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import GenerationShareContent, { type GenerationShareContentProps } from './GenerationShareContent';

export type { GenerationShareType } from './GenerationShareContent';

/** Opens the share panel of one generation result (image, video or song). */
export const openGenerationShareModal = (props: GenerationShareContentProps) =>
  createModal({
    content: <GenerationShareContent {...props} />,
    footer: null,
    maskClosable: true,
    title: t('shareModal.generation.title', { ns: 'chat' }),
    width: 'min(92vw, 400px)',
  });

/**
 * A generation is shared as the library file it was saved as, so it needs:
 * - file sharing, which only the cloud edition implements;
 * - a saved file (`fileId`); older generations without one have nothing to share;
 * - to be the creator's own. The file share API enforces the same; a batch
 *   without a creator is a personal-space one, always the user's.
 */
export const useCanShareGeneration = (fileId?: string | null, creatorId?: string | null) => {
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const enableFileShare = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  return enableFileShare && !!fileId && (!creatorId || creatorId === currentUserId);
};
