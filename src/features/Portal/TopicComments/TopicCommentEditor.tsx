import type { TopicCommentJson } from '@lobechat/types';
import { Editor, useEditor } from '@lobehub/editor/react';
import type { Ref } from 'react';
import { memo, useCallback, useImperativeHandle } from 'react';

import {
  readTopicCommentEditorValue,
  resolveTopicCommentEditorContent,
  type TopicCommentEditorValue,
} from './editorUtils';
import { useWorkspaceCommentMentionOption } from './useWorkspaceCommentMentionOption';

export type { TopicCommentEditorValue } from './editorUtils';

export interface TopicCommentEditorRef {
  clean: () => void;
  focus: () => void;
  getValue: () => TopicCommentEditorValue;
  setValue: (value: TopicCommentEditorValue) => void;
}

export interface TopicCommentEditorProps {
  autoFocus?: boolean;
  compact?: boolean;
  disabled?: boolean;
  enableMarkdown?: boolean;
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
    compact = false,
    disabled,
    enableMarkdown = false,
    initialContent,
    initialEditorData,
    onChange,
    onPressEnter,
    placeholder,
  }: TopicCommentEditorProps & { ref?: Ref<TopicCommentEditorRef> }) => {
    const editor = useEditor();
    const mentionOption = useWorkspaceCommentMentionOption();

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
        enablePasteMarkdown={enableMarkdown}
        markdownOption={enableMarkdown}
        mentionOption={mentionOption}
        placeholder={placeholder}
        type={type}
        variant={'chat'}
        style={{
          maxHeight: compact ? 120 : 184,
          minHeight: compact ? 24 : 44,
          overflowY: 'auto',
          padding: 0,
        }}
        onPressEnter={({ event }) => onPressEnter?.(event)}
        onTextChange={(currentEditor) => onChange?.(readTopicCommentEditorValue(currentEditor))}
      />
    );
  },
);

TopicCommentEditor.displayName = 'TopicCommentEditor';

export default TopicCommentEditor;
