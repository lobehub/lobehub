import {
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkHighlightPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { Flexbox, Modal } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/slices/preference/selectors';

import TypoBar from './Typobar';

interface EditableMessageProps {
  editing?: boolean;
  onChange?: (value: string) => void;
  onEditingChange?: (editing: boolean) => void;
  value?: string;
}

const EditableMessage = memo<EditableMessageProps>(
  ({ editing, onEditingChange, onChange, value }) => {
    const { t } = useTranslation('common');
    const editor = useEditor();

    const enableRichRender = useUserStore(labPreferSelectors.enableInputMarkdown);

    const richRenderProps = useMemo(
      () =>
        !enableRichRender
          ? {
              enablePasteMarkdown: false,
              markdownOption: {
                bold: false,
                code: false,
                header: false,
                italic: false,
                quote: false,
                strikethrough: false,
                underline: false,
                underlineStrikethrough: false,
              },
            }
          : {
              plugins: [
                ReactListPlugin,
                ReactCodePlugin,
                ReactCodemirrorPlugin,
                ReactHRPlugin,
                ReactLinkHighlightPlugin,
                ReactTablePlugin,
                ReactMathPlugin,
              ],
            },
      [enableRichRender],
    );

    return (
      <Modal
        cancelText={t('cancel')}
        closable={false}
        destroyOnHidden
        okText={t('ok')}
        onCancel={() => onEditingChange?.(false)}
        onOk={() => {
          if (!editor) return;
          const newValue = editor.getDocument('markdown') as unknown as string;
          onChange?.(newValue);
          onEditingChange?.(false);
        }}
        open={editing}
        styles={{
          body: {
            overflow: 'hidden',
            padding: 0,
          },
        }}
        title={null}
        width={'min(90vw, 960px)'}
      >
        <TypoBar editor={editor} />
        <Flexbox
          onClick={() => {
            editor.focus();
          }}
          paddingBlock={16}
          paddingInline={48}
          style={{ cursor: 'text', maxHeight: '80vh', minHeight: '50vh', overflowY: 'auto' }}
        >
          <Editor
            autoFocus
            content={''}
            editor={editor}
            onInit={(editor) => {
              if (!editor) return;
              try {
                editor?.setDocument('markdown', value);
              } catch {}
            }}
            style={{
              paddingBottom: 120,
            }}
            type={'text'}
            variant={'chat'}
            {...richRenderProps}
          />
        </Flexbox>
      </Modal>
    );
  },
);

export default EditableMessage;
