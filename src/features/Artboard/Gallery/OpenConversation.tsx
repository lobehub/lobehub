import { ActionIcon } from '@lobehub/ui';
import { MessageSquareIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getProjectTopicPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { artboardService } from '@/services/artboard';

import { useBoard } from '../BoardContext';
import { ARTBOARD_SEARCH_PARAM } from '../useOpenArtboardFromRoute';

const OpenConversation = ({ onLeave }: { onLeave?: () => void }) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const { id, topicId } = useBoard().artboard;
  const { data: topic } = useClientDataSWR(topicId ? ['artboard-topic', topicId] : null, () =>
    artboardService.getConversation(topicId!),
  );
  const projectId = topic?.projectId;
  if (!topicId || !projectId) return null;

  return (
    <ActionIcon
      icon={MessageSquareIcon}
      size={'small'}
      title={t('artboard.gallery.openConversation')}
      onClick={() => {
        onLeave?.();
        navigate(`${getProjectTopicPath(projectId, topicId)}?${ARTBOARD_SEARCH_PARAM}=${id}`);
      }}
    />
  );
};

export default OpenConversation;
