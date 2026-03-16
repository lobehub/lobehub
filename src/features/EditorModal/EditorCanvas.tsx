import { type IEditor } from '@lobehub/editor';
import { ReactLinkPlugin, ReactMentionPlugin, ReactTablePlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { type FC, useMemo } from 'react';

import { createChatInputRichPlugins } from '@/features/ChatInput/InputEditor/plugins';

import TypoBar from './Typobar';

interface EditorCanvasProps {
  defaultValue?: string;
  editor?: IEditor;
  editorData?: unknown;
}

const EDITOR_PLUGINS = [
  ...createChatInputRichPlugins({ linkPlugin: ReactLinkPlugin }),
  ReactTablePlugin,
  ReactMentionPlugin,
];

const EditorCanvas: FC<EditorCanvasProps> = ({ defaultValue, editor, editorData }) => {
  const { content, type } = useMemo(() => {
    const hasValidEditorData =
      editorData && typeof editorData === 'object' && Object.keys(editorData).length > 0;

    if (hasValidEditorData) {
      return { content: JSON.stringify(editorData), type: 'json' as const };
    }

    return { content: defaultValue || '', type: 'markdown' as const };
  }, [editorData, defaultValue]);

  return (
    <>
      <TypoBar editor={editor} />
      <Flexbox
        padding={16}
        style={{ cursor: 'text', maxHeight: '80vh', minHeight: '50vh', overflowY: 'auto' }}
      >
        <Editor
          autoFocus
          content={content}
          editor={editor}
          plugins={EDITOR_PLUGINS}
          type={type}
          variant={'chat'}
          style={{
            paddingBottom: 120,
          }}
        />
      </Flexbox>
    </>
  );
};

export default EditorCanvas;
