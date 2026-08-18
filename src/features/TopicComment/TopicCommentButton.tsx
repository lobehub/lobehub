import { ActionIcon } from '@lobehub/ui';
import { Badge } from 'antd';
import { MessageCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { DESKTOP_HEADER_ICON_SMALL_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useAgentContext } from '@/features/Conversation/useAgentContext';
import { useChatStore } from '@/store/chat';

import { usePrefetchTopicCommentsOnTopicLoad, useTopicCommentSummary } from './hooks';

const TopicCommentButton = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('chat');
  const workspaceId = useActiveWorkspaceId();
  const { topicId } = useAgentContext();
  const openTopicComments = useChatStore((s) => s.openTopicComments);
  const { data } = useTopicCommentSummary(workspaceId ? topicId : undefined);
  usePrefetchTopicCommentsOnTopicLoad(workspaceId ? topicId : undefined);

  if (!workspaceId || !topicId) return null;

  return (
    <Badge count={data?.total} offset={[-3, 3]} overflowCount={99} size={'small'}>
      <ActionIcon
        icon={MessageCircle}
        size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={t('topicComment.title')}
        tooltipProps={{ placement: 'bottom' }}
        onClick={() => openTopicComments(topicId)}
      />
    </Badge>
  );
});

TopicCommentButton.displayName = 'TopicCommentButton';

export default TopicCommentButton;
