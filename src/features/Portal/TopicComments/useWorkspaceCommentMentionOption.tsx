import type { IEditor, ISlashMenuOption } from '@lobehub/editor';
import type { EditorProps } from '@lobehub/editor/react';
import { Avatar } from '@lobehub/ui';
import { useCallback, useMemo } from 'react';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';

import {
  createTopicCommentMentionItems,
  insertTopicCommentMention,
  type MentionableWorkspaceMember,
  writeTopicCommentMentionMarkdown,
} from './editorUtils';

/** The workspace's members as `@` candidates. */
export const useWorkspaceMemberMentionItems = (): ISlashMenuOption[] => {
  useFetchWorkspaceMembers();
  const workspaceMembers = useWorkspaceMembers() as MentionableWorkspaceMember[];

  return useMemo<ISlashMenuOption[]>(
    () =>
      createTopicCommentMentionItems(workspaceMembers).map(({ avatar, ...item }) => ({
        ...item,
        icon: <Avatar avatar={avatar} size={24} />,
      })),
    [workspaceMembers],
  );
};

/**
 * The editor's `@` option over a candidate list. Every candidate writes the
 * same mention node; its `metadata.type` (`member` / `agent`) tells the server
 * what the mention asks for.
 */
export const useCommentMentionOption = (
  items: ISlashMenuOption[],
): EditorProps['mentionOption'] => {
  const handleMentionSelect = useCallback((editor: IEditor, option: ISlashMenuOption) => {
    insertTopicCommentMention(editor, option);
  }, []);

  return useMemo(
    () => ({
      fuseOptions: { keys: ['label', 'metadata.description'], threshold: 0.35 },
      items,
      markdownWriter: writeTopicCommentMentionMarkdown,
      maxLength: 50,
      onSelect: handleMentionSelect,
    }),
    [handleMentionSelect, items],
  );
};

/** Shared comment mention source: workspace members. */
export const useWorkspaceCommentMentionOption = (): EditorProps['mentionOption'] =>
  useCommentMentionOption(useWorkspaceMemberMentionItems());
