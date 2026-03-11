import { type IEditor } from '@lobehub/editor';
import {
  ReactCodemirrorPlugin,
  ReactCodePlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import TypoBar from './Typobar';

interface EditorCanvasProps {
  defaultValue?: string;
  editor?: IEditor;
}

const EditorCanvas: FC<EditorCanvasProps> = ({ defaultValue, editor }) => {
  return (
    <>
      <TypoBar editor={editor} />
      <Flexbox
        padding={16}
        style={{ cursor: 'text', maxHeight: '80vh', minHeight: '50vh', overflowY: 'auto' }}
      >
        <Editor
          autoFocus
          content={''}
          editor={editor}
          type={'text'}
          variant={'chat'}
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
          onInit={(editor) => {
            if (!editor || !defaultValue) return;
            try {
              editor?.setDocument('markdown', defaultValue);
            } catch (e) {
              console.error('setDocument error:', e);
            }
          }}
        />
      </Flexbox>
    </>
  );
};

export default EditorCanvas;
