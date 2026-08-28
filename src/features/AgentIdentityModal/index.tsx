'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import AgentIdentityContent from './Content';

/** Open the identity form (name / role / slug) for a specific agent. */
export const createAgentIdentityModal = (agentId: string) =>
  createModal({
    content: <AgentIdentityContent agentId={agentId} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: t('settingAgent.identity.edit', { ns: 'setting' }),
    width: 'min(90%, 460px)',
  });
