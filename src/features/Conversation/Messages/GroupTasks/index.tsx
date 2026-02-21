'use client';

import { type UIChatMessage } from '@lobechat/types';
import { Block, Flexbox, GroupAvatar, Icon, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ListTodo } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import { ChatItem } from '../../ChatItem';
import { dataSelectors, useConversationStore } from '../../store';
import { AssistantActionsBar } from '../Task/Actions';
import TaskItem from './TaskItem';

interface GroupTasksMessageProps {
  id: string;
  index: number;
}

/**
 * Custom avatar component for GroupTasks
 * Shows GroupAvatar (only task agents, no user) with a ListTodo badge
 */
const GroupTasksAvatar = memo<{ avatars: { avatar?: string; background?: string }[] }>(
  ({ avatars }) => {
    return (
      <Flexbox flex={'none'} height={28} style={{ position: 'relative' }} width={28}>
        <GroupAvatar
          avatarShape={'square'}
          cornerShape={'square'}
          size={28}
          avatars={avatars.map((a) => ({
            avatar: a.avatar || DEFAULT_AVATAR,
            background: a.background,
          }))}
        />
        <Block
          align={'center'}
          flex={'none'}
          height={16}
          justify={'center'}
          variant={'outlined'}
          width={16}
          style={{
            borderRadius: 4,
            position: 'absolute',
            right: -4,
            top: -4,
          }}
        >
          <Icon color={cssVar.colorTextDescription} icon={ListTodo} size={10} />
        </Block>
      </Flexbox>
    );
  },
);

GroupTasksAvatar.displayName = 'GroupTasksAvatar';

const GroupTasksMessage = memo<GroupTasksMessageProps>(({ id, index }) => {
  const { t } = useTranslation('chat');
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;
  const actionsConfig = useConversationStore((s) => s.actionsBar?.assistant);
  const tasks = (item as UIChatMessage)?.tasks?.filter(Boolean) as UIChatMessage[] | undefined;

  // Get unique agent IDs from tasks
  const taskAgentIds = useMemo(() => {
    if (!tasks) return [];
    const ids = tasks.map((task) => task.agentId).filter(Boolean) as string[];
    return [...new Set(ids)];
  }, [tasks]);

  // Get active group ID
  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);

  // Get agent info (avatars and names) for all unique agents in tasks
  const taskAgents = useAgentGroupStore((s) => {
    if (!activeGroupId || taskAgentIds.length === 0) return [];
    return taskAgentIds
      .map((agentId) => {
        const agent = agentGroupSelectors.getAgentByIdFromGroup(activeGroupId, agentId)(s);
        return agent
          ? { avatar: agent.avatar, background: agent.backgroundColor, title: agent.title }
          : null;
      })
      .filter(Boolean) as { avatar?: string; background?: string; title?: string }[];
  }, isEqual);

  // Build title: "Agent1 / Agent2 等 N 个 agents tasks" (show max 2 agents)
  const title = useMemo(() => {
    const agentNames = taskAgents.map((a) => a.title).filter(Boolean);
    if (agentNames.length === 0) return '';

    const totalAgents = agentNames.length;
    // Show at most 2 agent names
    const displayedAgents = agentNames.slice(0, 2).join(' / ');

    if (totalAgents <= 2) {
      // Show all agent names when 2 or fewer
      return t('task.groupTasksTitleSimple', {
        agents: displayedAgents,
        count: tasks?.length || 0,
      });
    }

    // Show "Agent1 / Agent2 等 X 个 agents tasks" when more than 2
    return t('task.groupTasksTitle', {
      agents: displayedAgents,
      count: totalAgents,
      taskCount: tasks?.length || 0,
    });
  }, [taskAgents, tasks?.length, t]);

  if (!tasks || tasks.length === 0) {
    return null;
  }

  const { createdAt } = item;

  return (
    <ChatItem
      showTitle
      aboveMessage={null}
      avatar={{ title }}
      customAvatarRender={() => <GroupTasksAvatar avatars={taskAgents} />}
      id={id}
      message=""
      placement="left"
      time={createdAt}
      titleAddon={<Tag>{t('task.groupTasks', { count: tasks.length })}</Tag>}
      actions={
        <AssistantActionsBar actionsConfig={actionsConfig} data={item} id={id} index={index} />
      }
    >
      <Flexbox gap={8} width={'100%'}>
        {tasks.map((task) => (
          <TaskItem item={task} key={task.id} />
        ))}
      </Flexbox>
    </ChatItem>
  );
}, isEqual);

GroupTasksMessage.displayName = 'GroupTasksMessage';

export default GroupTasksMessage;
