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
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/slices/preference/selectors';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

import TypoBar from './Typobar';

const EditableModal = memo(() => {
  const { t } = useTranslation('common');
  const editor = useEditor();
  const [confirmLoading, setConfirmLoading] = useState(false);
  const editingMemoryId = useUserMemoryStore((s) => s.editingMemoryId);
  const editingMemoryContent = useUserMemoryStore((s) => s.editingMemoryContent);
  const editingMemoryLayer = useUserMemoryStore((s) => s.editingMemoryLayer);
  const clearEditingMemory = useUserMemoryStore((s) => s.clearEditingMemory);
  const updateMemory = useUserMemoryStore((s) => s.updateMemory);

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

  const layerMap = {
    context: LayersEnum.Context,
    experience: LayersEnum.Experience,
    identity: LayersEnum.Identity,
    preference: LayersEnum.Preference,
  };

  return (
    <Modal
      cancelText={t('cancel')}
      closable={false}
      confirmLoading={confirmLoading}
      destroyOnHidden
      okText={t('ok')}
      onCancel={clearEditingMemory}
      onOk={async () => {
        if (!editor || !editingMemoryId || !editingMemoryLayer) return;
        setConfirmLoading(true);
        const newValue = editor.getDocument('markdown') as unknown as string;
        await updateMemory(editingMemoryId, newValue, layerMap[editingMemoryLayer]);
        setConfirmLoading(false);
      }}
      open={!!editingMemoryId}
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
              editor?.setDocument('markdown', editingMemoryContent);
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
});

export default EditableModal;
