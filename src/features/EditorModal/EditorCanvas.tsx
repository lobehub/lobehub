import {
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { FC } from 'react';

import TypoBar from './Typobar';

interface EditorCanvasProps {
  onChange?: (value: string) => void;
  value?: string;
}

const EditorCanvas: FC<EditorCanvasProps> = ({ value, onChange }) => {
  const editor = useEditor();
  return (
    <>
      <TypoBar editor={editor} />
      <Flexbox
        onClick={() => {
          editor?.focus();
        }}
        padding={16}
        style={{ cursor: 'text', maxHeight: '80vh', minHeight: '50vh', overflowY: 'auto' }}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <Editor
            autoFocus
            content={''}
            editor={editor}
            onInit={(editor) => {
              if (!editor || !value) return;
              try {
                editor?.setDocument('markdown', value);
              } catch (e) {
                console.error('setDocument error:', e);
              }
            }}
            onTextChange={(editor) => {
              try {
                const newValue = editor.getDocument('markdown') as unknown as string;
                onChange?.(newValue);
              } catch (e) {
                console.error('getDocument error:', e);
                onChange?.('');
              }
            }}
            plugins={[
              ReactListPlugin,
              ReactCodePlugin,
              ReactCodemirrorPlugin,
              ReactHRPlugin,
              ReactLinkPlugin,
              ReactTablePlugin,
              ReactMathPlugin,
            ]}
            style={{
              paddingBottom: 120,
            }}
            type={'text'}
            variant={'chat'}
          />
        </div>
      </Flexbox>
    </>
  );
};

export default EditorCanvas;
