'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import Content from './Content';

export const openAgentShareSettingsModal = (agentId: string): ModalInstance =>
  createModal({
    content: <Content agentId={agentId} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { maxHeight: '70vh', overflow: 'auto', padding: 0 },
    },
    title: t('share.settings.title', { ns: 'agent' }),
    width: 'min(90%, 680px)',
  });
