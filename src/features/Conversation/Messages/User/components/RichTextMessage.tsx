import { ReactMentionPlugin, ReactTablePlugin } from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { memo, useEffect, useMemo } from 'react';

import { createChatInputRichPlugins } from '@/features/ChatInput/InputEditor/plugins';

interface RichTextMessageProps {
  editorState: unknown;
}

const EDITOR_PLUGINS = [...createChatInputRichPlugins(), ReactTablePlugin, ReactMentionPlugin];

const RichTextMessage = memo<RichTextMessageProps>(({ editorState }) => {
  const editor = useEditor();

  const content = useMemo(() => {
    if (!editorState || typeof editorState !== 'object') return null;
    if (Object.keys(editorState as Record<string, unknown>).length === 0) return null;

    try {
      return JSON.stringify(editorState);
    } catch {
      return null;
    }
  }, [editorState]);

  useEffect(() => {
    if (editor && content) {
      editor.setDocument('json', content);
    }
  }, [editor, content]);

  if (!content) return null;

  return (
    <Editor
      content={content}
      editable={false}
      editor={editor}
      enablePasteMarkdown={false}
      markdownOption={false}
      plugins={EDITOR_PLUGINS}
      type={'json'}
      variant={'chat'}
    />
  );
});

RichTextMessage.displayName = 'RichTextMessage';

export default RichTextMessage;
