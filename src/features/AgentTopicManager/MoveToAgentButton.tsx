'use client';

import { ActionIcon } from '@lobehub/ui';
import { FolderInput } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { createMoveTopicsModal } from './MoveTopicsModal';
import { useTopicsViewStore } from './store';

const MoveToAgentButton = memo(() => {
  const { t } = useTranslation('topic');

  const selectedIds = useTopicsViewStore((s) => s.selectedIds);
  const exitSelectMode = useTopicsViewStore((s) => s.exitSelectMode);
  const activeAgentId = useChatStore((s) => s.activeAgentId);

  return (
    <ActionIcon
      icon={FolderInput}
      size={'small'}
      title={t('management.bulk.move')}
      onClick={() => {
        if (selectedIds.length === 0) return;
        createMoveTopicsModal({
          onMoved: exitSelectMode,
          sourceAgentId: activeAgentId,
          topicIds: selectedIds,
        });
      }}
    />
  );
});

MoveToAgentButton.displayName = 'AgentTopicManagerMoveToAgentButton';

export default MoveToAgentButton;
