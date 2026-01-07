import {
  IEditor,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { FC, useMemo } from 'react';

import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import TypoBar from './Typobar';

interface EditorCanvasProps {
  defaultValue?: string;
  editor?: IEditor;
}

const EditorCanvas: FC<EditorCanvasProps> = ({ defaultValue, editor }) => {
  const enableRichRender = useUserStore(labPreferSelectors.enableInputMarkdown);

  const richRenderProps = useMemo(
    () =>
      !enableRichRender
        ? {
            enablePasteMarkdown: false,
            markdownOption: false,
          }
        : {
            plugins: [
              ReactListPlugin,
              ReactCodePlugin,
              ReactCodemirrorPlugin,
              ReactHRPlugin,
              ReactLinkPlugin,
              ReactTablePlugin,
              ReactMathPlugin,
            ],
          },
    [enableRichRender],
  );

  return (
    <>
      {enableRichRender && <TypoBar editor={editor} />}
      <Flexbox
        padding={16}
        style={{ cursor: 'text', maxHeight: '80vh', minHeight: '50vh', overflowY: 'auto' }}
      >
        <Editor
          autoFocus
          content={''}
          editor={editor}
          onInit={(editor) => {
            if (!editor || !defaultValue) return;
            try {
              if (enableRichRender) {
                editor?.setDocument('markdown', defaultValue);
              } else {
                editor?.setDocument('text', defaultValue);
              }
            } catch (e) {
              console.error('setDocument error:', e);
            }
          }}
          style={{
            paddingBottom: 120,
          }}
          type={'text'}
          variant={'chat'}
          {...richRenderProps}
        />
      </Flexbox>
    </>
  );
};

export default EditorCanvas;
