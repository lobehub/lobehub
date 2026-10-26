'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';

import AgentSkillModalContent, { type AgentSkillModalContentProps } from './AgentSkillModalContent';
import AgentSkillModalTitle from './AgentSkillModalTitle';

export interface AgentSkillModalOptions extends AgentSkillModalContentProps {
  /** The skill's name as the opener already knows it, shown while it loads. */
  title?: string | null;
}

export const createAgentSkillModal = ({ title, ...props }: AgentSkillModalOptions) =>
  createModal({
    content: <AgentSkillModalContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: {
        display: 'flex',
        flexDirection: 'column',
        height: 'min(80vh, 800px)',
        overflow: 'hidden',
        padding: 0,
      },
    },
    title: (
      <AgentSkillModalTitle
        {...props}
        title={title || t('workingPanel.skills.detail.title', { ns: 'chat' })}
      />
    ),
    width: 'min(90vw, 960px)',
  });
