import type { ISlashMenuOption } from '@lobehub/editor';
import type { EditorProps } from '@lobehub/editor/react';
import { cssVar } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { createAgentMentionItems } from '@/features/Portal/TopicComments/editorUtils';
import {
  useCommentMentionOption,
  useWorkspaceMemberMentionItems,
} from '@/features/Portal/TopicComments/useWorkspaceCommentMentionOption';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

/**
 * `@` candidates of a task comment: the workspace's members, then the agents
 * this task can wake. A mentioned agent runs the task to answer the comment,
 * so a public task only offers the agents every member can see — the same
 * rule the server applies before it wakes one.
 */
export const useTaskCommentMentionOption = (): EditorProps['mentionOption'] => {
  const { t } = useTranslation('chat');
  useFetchAgentList();

  const memberItems = useWorkspaceMemberMentionItems();
  const visibility = useTaskStore(taskDetailSelectors.activeTaskVisibility);
  const agents = useHomeStore(
    visibility === 'private'
      ? homeAgentListSelectors.allAgents
      : homeAgentListSelectors.sharedAgents,
    isEqual,
  );

  const agentItems = useMemo<ISlashMenuOption[]>(
    () =>
      createAgentMentionItems(agents, {
        description: t('taskDetail.comment.mention.agent'),
        fallbackLabel: t('taskDetail.comment.mention.unnamedAgent'),
      }).map(({ avatar: _avatar, ...item }) => {
        const agent = agents.find((a) => a.id === item.metadata.id);
        return {
          ...item,
          icon: (
            <AgentAvatar
              agentId={item.metadata.id}
              avatar={typeof agent?.avatar === 'string' ? agent.avatar : undefined}
              background={agent?.backgroundColor || cssVar.colorBgContainer}
              name={String(item.label)}
              shape={'circle'}
              size={24}
            />
          ),
        };
      }),
    [agents, t],
  );

  const items = useMemo(() => [...memberItems, ...agentItems], [memberItems, agentItems]);

  return useCommentMentionOption(items);
};
