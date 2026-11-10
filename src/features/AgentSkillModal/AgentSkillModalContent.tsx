'use client';

import { Button, Center, Empty } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { FileWarningIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/CircleLoading';
import SkillViewer from '@/features/SkillViewer';

import { useAgentSkill } from './useAgentSkill';

export interface AgentSkillModalContentProps {
  /** The skill bundle row or its `SKILL.md` index row, from `agent_documents.id`. */
  agentDocumentId: string;
  agentId: string;
}

// Managed skills keep `SKILL.md` alone, so the tree lists just that file.
const NO_OTHER_FILES: { content: string; path: string }[] = [];

/**
 * One of an agent's managed skills, read-only: its file tree beside the
 * selected file. Editing happens on the skill's own document page, which the
 * modal title opens.
 */
const AgentSkillModalContent = ({ agentDocumentId, agentId }: AgentSkillModalContentProps) => {
  const { t } = useTranslation(['chat', 'common']);
  const { data: skill, error, isLoading, mutate } = useAgentSkill(agentId, agentDocumentId);

  if (isLoading) return <Loading />;

  if (error || !skill) {
    return (
      <Center flex={1} gap={12}>
        <Empty
          description={t(error ? 'agentSkillModal.loadFailed' : 'agentSkillModal.notFound')}
          icon={error ? FileWarningIcon : SkillsIcon}
        />
        {error && <Button onClick={() => void mutate()}>{t('retry', { ns: 'common' })}</Button>}
      </Center>
    );
  }

  return (
    <SkillViewer
      content={skill.content}
      entityId={`agent-skill:${skill.index.documentId}`}
      files={NO_OTHER_FILES}
      filesPosition={'start'}
    />
  );
};

export default AgentSkillModalContent;
