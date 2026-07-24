import type { TopicCommentJson } from '@lobechat/types';
import type { IEditor, ISlashMenuOption } from '@lobehub/editor';
import { INSERT_MENTION_COMMAND } from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { Avatar } from '@lobehub/ui';
import type { Ref } from 'react';
import { memo, useCallback, useImperativeHandle, useMemo } from 'react';

import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';

interface MentionableWorkspaceMember {
  user?: {
    avatar?: string | null;
    email?: string | null;
    fullName?: string | null;
    username?: string | null;
  } | null;
  userId: string;
}

export interface TopicCommentEditorValue {
  content: string;
  editorData: TopicCommentJson;
}

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

const readValue = (editor: IEditor): TopicCommentEditorValue => ({
  content: String(editor.getDocument('markdown') ?? ''),
  editorData: (editor.getDocument('json') ?? null) as unknown as TopicCommentJson,
});

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

    const mentionItems = useMemo<ISlashMenuOption[]>(() => {
      const seen = new Set<string>();

      return workspaceMembers.flatMap((member) => {
        if (!member.userId || seen.has(member.userId)) return [];
        seen.add(member.userId);

        const profile = member.user;
        const label = profile?.fullName || profile?.username || profile?.email || member.userId;
        const description = profile?.email && profile.email !== label ? profile.email : undefined;

        return [
          {
            icon: <Avatar avatar={profile?.avatar || label} size={24} />,
            key: `member-${member.userId}`,
            label,
            metadata: {
              description,
              id: member.userId,
              timestamp: 0,
              type: 'member',
            },
          },
        ];
      });
    }, [workspaceMembers]);

    const mentionMarkdownWriter = useCallback(
      (mention: { label?: string; metadata?: Record<string, unknown> }) =>
        `<mention name="${mention.label ?? ''}" id="${String(mention.metadata?.id ?? '')}" />`,
      [],
    );

    const handleMentionSelect = useCallback((currentEditor: IEditor, option: ISlashMenuOption) => {
      currentEditor.dispatchCommand(INSERT_MENTION_COMMAND, {
        label: String(option.label),
        metadata: option.metadata,
      });
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
        getValue: () => readValue(editor),
        setValue,
      }),
      [editor, setValue],
    );

    const content = initialEditorData ?? initialContent;
    const type = initialEditorData ? 'json' : initialContent ? 'markdown' : 'text';

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
          markdownWriter: mentionMarkdownWriter,
          maxLength: 50,
          onSelect: handleMentionSelect,
        }}
        onPressEnter={({ event }) => onPressEnter?.(event)}
        onTextChange={(currentEditor) => onChange?.(readValue(currentEditor))}
      />
    );
  },
);

TopicCommentEditor.displayName = 'TopicCommentEditor';

export default TopicCommentEditor;
