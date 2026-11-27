import type { IEditor, ISlashMenuOption } from '@lobehub/editor';
import type { EditorProps } from '@lobehub/editor/react';
import { Avatar } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import {
  insertTopicCommentMention,
  type MentionableWorkspaceMember,
  writeTopicCommentMentionMarkdown,
} from '@/features/Portal/TopicComments/editorUtils';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { createTaskCommentMentionSections } from './taskCommentMentionSections';

/**
 * The `@` source of task comments: workspace members and agents. A comment on
 * a public task is read by the whole workspace, so it only offers the agents
 * everyone can see; a private task may name the caller's private agents too.
 */
export const useTaskCommentMentionOption = (): EditorProps['mentionOption'] => {
  const { t } = useTranslation('chat');
  useFetchWorkspaceMembers();
  const members = useWorkspaceMembers() as MentionableWorkspaceMember[];
  const isPrivateTask = useTaskStore(taskDetailSelectors.activeTaskVisibility) === 'private';
  const agents = useHomeStore(
    isPrivateTask ? homeAgentListSelectors.allAgents : homeAgentListSelectors.sharedAgents,
    isEqual,
  );

  const sections = useMemo(
    () =>
      createTaskCommentMentionSections({
        agents: agents
          .filter((agent) => agent.type === 'agent')
          .map((agent) => ({
            avatar: typeof agent.avatar === 'string' ? agent.avatar : null,
            backgroundColor: agent.backgroundColor,
            description: agent.description,
            id: agent.id,
            name: agent.name,
            title: agent.title,
          })),
        labels: {
          agents: t('taskDetail.comment.mention.agents'),
          members: t('taskDetail.comment.mention.members'),
        },
        members,
        unnamedAgent: t('taskDetail.comment.mention.unnamedAgent'),
      }).map((section) => ({
        ...section,
        items: section.items.map(({ avatar, ...item }) => ({
          ...item,
          icon: <Avatar avatar={avatar.value} background={avatar.background} size={24} />,
        })),
      })),
    [agents, members, t],
  );

  const handleMentionSelect = useCallback((editor: IEditor, option: ISlashMenuOption) => {
    insertTopicCommentMention(editor, option);
  }, []);

  return useMemo(
    () => ({
      fuseOptions: { keys: ['label', 'metadata.description'], threshold: 0.35 },
      items: sections,
      markdownWriter: writeTopicCommentMentionMarkdown,
      maxLength: 50,
      onSelect: handleMentionSelect,
    }),
    [handleMentionSelect, sections],
  );
};
