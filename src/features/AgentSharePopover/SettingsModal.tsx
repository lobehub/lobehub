'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import SettingsContent from './SettingsContent';

export const createAgentShareSettingsModal = (agentId: string) =>
  createModal({
    content: <SettingsContent agentId={agentId} />,
    footer: null,
    title: t('share.settings.title', { ns: 'agent' }),
    width: 600,
  });
