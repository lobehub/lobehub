'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import AgentArtworkStudioContent from './Content';

export { styleReferencesForArtworkStyle } from './lobeStyleReferences';

/**
 * Large avatar workshop for one agent: make your own (upload) or one-click
 * generate in the official style. Reads everything from the agent store, so
 * any surface that knows an agent id can open it.
 */
export const openAgentArtworkStudio = (agentId: string): ModalInstance =>
  createModal({
    content: <AgentArtworkStudioContent agentId={agentId} />,
    footer: null,
    maskClosable: true,
    title: t('settingAgent.artwork.studio.title', { ns: 'setting' }),
    width: 'min(92vw, 820px)',
  });
