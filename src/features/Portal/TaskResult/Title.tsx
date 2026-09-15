import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useTaskStore } from '@/store/task';
import { oneLineEllipsis } from '@/styles';

import Actions from './Actions';
import { useLiveRun } from './useLiveRun';

const Title = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useChatStore(chatPortalSelectors.taskResultId);
  const detail = useTaskStore((state) => (taskId ? state.taskDetailMap[taskId] : undefined));
  const liveRun = useLiveRun();
  const agentMeta = useAgentDisplayMeta(liveRun?.agentId);

  // A live run is a conversation, so it is headed like one: who is working,
  // then what this run is about.
  if (liveRun)
    return (
      <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
        <AssigneeAvatar agentId={liveRun.agentId} size={20} />
        <Text fontSize={14} style={{ flexShrink: 0 }} weight={500}>
          {agentMeta?.title ?? liveRun.activity.author?.name}
        </Text>
        <Text
          className={oneLineEllipsis}
          fontSize={13}
          style={{ color: cssVar.colorTextSecondary, flex: '0 1 auto', minWidth: 0 }}
        >
          {liveRun.activity.title}
        </Text>
        <Actions />
      </Flexbox>
    );

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
      <Text fontSize={14} style={{ flexShrink: 0 }} weight={500}>
        {t('goalDetail.taskResult')}
      </Text>
      {(detail?.identifier || detail?.name) && (
        <Text
          className={oneLineEllipsis}
          fontSize={13}
          style={{ color: cssVar.colorTextSecondary, flex: '0 1 auto', minWidth: 0 }}
        >
          {[detail.identifier, detail.name].filter(Boolean).join(' · ')}
        </Text>
      )}
      <Actions />
    </Flexbox>
  );
});

Title.displayName = 'TaskResultPortalTitle';
export default Title;
