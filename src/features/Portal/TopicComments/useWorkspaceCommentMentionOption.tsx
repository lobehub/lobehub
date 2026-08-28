import type { IEditor, ISlashMenuOption } from '@lobehub/editor';
import type { EditorProps } from '@lobehub/editor/react';
import { Avatar } from '@lobehub/ui/base-ui';
import { useCallback, useMemo } from 'react';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';

import {
  createTopicCommentMentionItems,
  insertTopicCommentMention,
  type MentionableWorkspaceMember,
  writeTopicCommentMentionMarkdown,
} from './editorUtils';

/**
 * Shared comment mention source. Mention metadata carries a stable `type`, so
 * Agent candidates can be merged here later without changing the editor JSON.
 */
export const useWorkspaceCommentMentionOption = (): EditorProps['mentionOption'] => {
  useFetchWorkspaceMembers();
  const workspaceMembers = useWorkspaceMembers() as MentionableWorkspaceMember[];

  const mentionItems = useMemo<ISlashMenuOption[]>(
    () =>
      createTopicCommentMentionItems(workspaceMembers).map(({ avatar, ...item }) => ({
        ...item,
        icon: <Avatar avatar={avatar} size={24} />,
      })),
    [workspaceMembers],
  );

  const handleMentionSelect = useCallback((editor: IEditor, option: ISlashMenuOption) => {
    insertTopicCommentMention(editor, option);
  }, []);

  return useMemo(
    () => ({
      fuseOptions: { keys: ['label', 'metadata.description'], threshold: 0.35 },
      items: mentionItems,
      markdownWriter: writeTopicCommentMentionMarkdown,
      maxLength: 50,
      onSelect: handleMentionSelect,
    }),
    [handleMentionSelect, mentionItems],
  );
};
