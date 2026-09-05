import type { DocumentCommentJson } from '@lobechat/types';
import type { IEditor } from '@lobehub/editor';
import type { EditorProps } from '@lobehub/editor/react';
import { useEditor } from '@lobehub/editor/react';
import type { Ref } from 'react';
import { memo, useCallback, useImperativeHandle } from 'react';

import { mentionFilledClassName } from '@/features/ChatInput/InputEditor/mentionStyle';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  readTopicCommentEditorValue,
  type TopicCommentEditorValue,
} from '@/features/Portal/TopicComments/editorUtils';
import { useWorkspaceCommentMentionOption } from '@/features/Portal/TopicComments/useWorkspaceCommentMentionOption';

import { styles } from './styles';

export type DocumentCommentEditorValue = TopicCommentEditorValue;

export interface DocumentCommentEditorRef {
  clean: () => void;
  focus: () => void;
  getValue: () => DocumentCommentEditorValue;
  setValue: (value: DocumentCommentEditorValue) => void;
}

interface DocumentCommentEditorProps {
  autoFocus?: boolean;
  compact?: boolean;
  disabled?: boolean;
  editor?: IEditor;
  entityId: string;
  getPopupContainer?: EditorProps['getPopupContainer'];
  initialContent: string;
  initialEditorData?: DocumentCommentJson | null;
  onChange?: (value: DocumentCommentEditorValue) => void;
  onPressEnter?: (event: KeyboardEvent) => boolean | void;
  placeholder: string;
  ref?: Ref<DocumentCommentEditorRef>;
}

const DocumentCommentEditor = memo<DocumentCommentEditorProps>(
  ({
    ref,
    autoFocus,
    compact = false,
    disabled,
    editor: externalEditor,
    entityId,
    getPopupContainer,
    initialContent,
    initialEditorData,
    onChange,
    onPressEnter,
    placeholder,
  }) => {
    const internalEditor = useEditor();
    const editor = externalEditor ?? internalEditor;
    const mentionOption = useWorkspaceCommentMentionOption();

    const setValue = useCallback(
      (value: DocumentCommentEditorValue) => {
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

    const handleInit = useCallback(
      (currentEditor: IEditor) => {
        if (autoFocus) currentEditor.focus();
      },
      [autoFocus],
    );

    return (
      <div className={`${styles.commentEditor} ${mentionFilledClassName}`}>
        <EditorCanvas
          disabled={disabled}
          editor={editor}
          editorData={{ content: initialContent, editorData: initialEditorData }}
          entityId={entityId}
          floatingToolbar={false}
          getPopupContainer={getPopupContainer}
          mentionOption={mentionOption}
          placeholder={placeholder}
          contentStyle={{
            minHeight: compact ? 24 : 44,
            // On top of ChatInput's own 8px/12px body padding: keep content —
            // images especially — clear of the box edges.
            paddingBlock: '6px 10px',
            paddingInline: 8,
          }}
          onContentChange={() => onChange?.(readTopicCommentEditorValue(editor))}
          onInit={handleInit}
          onPressEnter={({ event }) => onPressEnter?.(event)}
        />
      </div>
    );
  },
);

DocumentCommentEditor.displayName = 'DocumentCommentEditor';

export default DocumentCommentEditor;
