'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import AgentArtworkStudioContent from './Content';

export { styleReferencesForArtworkStyle } from '@/features/ArtworkStudio';

/**
 * Character workshop for one agent: upload an image or generate either an
 * avatar or full-body composition. Reads everything from the agent store, so
 * any surface that knows an agent id can open it.
 */
export const openAgentArtworkStudio = (agentId: string): ModalInstance =>
  createModal({
    content: <AgentArtworkStudioContent agentId={agentId} />,
    footer: null,
    maskClosable: true,
    styles: { content: { paddingBlockStart: 0 } },
    title: t('settingAgent.artwork.studio.title', { ns: 'setting' }),
    width: 'min(94vw, 920px)',
  });
