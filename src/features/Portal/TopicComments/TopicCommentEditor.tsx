import type { TopicCommentJson } from '@lobechat/types';
import type { IEditor, ISlashMenuOption } from '@lobehub/editor';
import { INSERT_MENTION_COMMAND } from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { Avatar } from '@lobehub/ui';
import type { Ref } from 'react';
import { memo, useCallback, useImperativeHandle, useMemo } from 'react';

import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';

import {
  createTopicCommentMentionItems,
  createTopicCommentMentionPayload,
  type MentionableWorkspaceMember,
  readTopicCommentEditorValue,
  resolveTopicCommentEditorContent,
  type TopicCommentEditorValue,
  writeTopicCommentMentionMarkdown,
} from './editorUtils';

export type { TopicCommentEditorValue } from './editorUtils';

export interface TopicCommentEditorRef {
  clean: () => void;
  focus: () => void;
  getValue: () => TopicCommentEditorValue;
  setValue: (value: TopicCommentEditorValue) => void;
}

interface TopicCommentEditorProps {
  autoFocus?: boolean;
  disabled?: boolean;
  initialContent: string;
  initialEditorData?: TopicCommentJson | null;
  onChange?: (value: TopicCommentEditorValue) => void;
  onPressEnter?: (event: KeyboardEvent) => boolean | void;
  placeholder: string;
}

const TopicCommentEditor = memo(
  ({
    ref,
    autoFocus,
    disabled,
    initialContent,
    initialEditorData,
    onChange,
    onPressEnter,
    placeholder,
  }: TopicCommentEditorProps & { ref?: Ref<TopicCommentEditorRef> }) => {
    const editor = useEditor();
    const workspaceMembers = useWorkspaceMembers() as MentionableWorkspaceMember[];

    const mentionItems = useMemo<ISlashMenuOption[]>(
      () =>
        createTopicCommentMentionItems(workspaceMembers).map(({ avatar, ...item }) => ({
          ...item,
          icon: <Avatar avatar={avatar} size={24} />,
        })),
      [workspaceMembers],
    );

    const handleMentionSelect = useCallback((currentEditor: IEditor, option: ISlashMenuOption) => {
      currentEditor.dispatchCommand(
        INSERT_MENTION_COMMAND,
        createTopicCommentMentionPayload(option),
      );
    }, []);

    const setValue = useCallback(
      (value: TopicCommentEditorValue) => {
        if (value.editorData) editor.setDocument('json', value.editorData);
        else editor.setDocument('markdown', value.content);
      },
      [editor],
    );

    useImperativeHandle(
      ref,
      () => ({
        clean: () => editor.cleanDocument(),
        focus: () => editor.focus(),
        getValue: () => readTopicCommentEditorValue(editor),
        setValue,
      }),
      [editor, setValue],
    );

    const { content, type } = resolveTopicCommentEditorContent(initialContent, initialEditorData);

    return (
      <Editor
        pasteAsPlainText
        autoFocus={autoFocus}
        content={content}
        debounceWait={0}
        editable={!disabled}
        editor={editor}
        enablePasteMarkdown={false}
        markdownOption={false}
        placeholder={placeholder}
        style={{ maxHeight: 184, minHeight: 44, overflowY: 'auto', padding: 0 }}
        type={type}
        variant={'chat'}
        mentionOption={{
          fuseOptions: { keys: ['label', 'metadata.description'], threshold: 0.35 },
          items: mentionItems,
          markdownWriter: writeTopicCommentMentionMarkdown,
          maxLength: 50,
          onSelect: handleMentionSelect,
        }}
        onPressEnter={({ event }) => onPressEnter?.(event)}
        onTextChange={(currentEditor) => onChange?.(readTopicCommentEditorValue(currentEditor))}
      />
    );
  },
);

TopicCommentEditor.displayName = 'TopicCommentEditor';

export default TopicCommentEditor;
