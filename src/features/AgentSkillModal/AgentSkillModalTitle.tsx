'use client';

import { ActionIcon, Flexbox, useModalContext } from '@lobehub/ui';
import { Maximize2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { buildAgentDocumentPath } from '@/features/AgentDocumentPage/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useAgentSkill } from './useAgentSkill';

export interface AgentSkillModalTitleProps {
  agentDocumentId: string;
  agentId: string;
  /** The name the opener already knows, shown until the skill loads. */
  title: string;
}

/**
 * The skill's name, and beside it the way out to its full document page — where
 * it can be edited. The action waits for the skill, since that page is
 * addressed by its `SKILL.md` document.
 */
const AgentSkillModalTitle = ({ agentDocumentId, agentId, title }: AgentSkillModalTitleProps) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const { data: skill } = useAgentSkill(agentId, agentDocumentId);

  return (
    <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
      <span
        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {skill?.title || title}
      </span>
      {skill && (
        <ActionIcon
          icon={Maximize2Icon}
          size={'small'}
          title={t('agentSkillModal.openDocument')}
          onClick={() => {
            close();
            navigate(buildAgentDocumentPath(agentId, skill.index.documentId));
          }}
        />
      )}
    </Flexbox>
  );
};

export default AgentSkillModalTitle;
