import { useEditor } from '@lobehub/editor/react';
import { Modal, ModalProps, createRawModal } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import EditorCanvas from './EditorCanvas';
import TextareCanvas from './TextArea';

interface EditorModalProps extends ModalProps {
  onConfirm?: (value: string) => Promise<void>;
  value?: string;
}

export const EditorModal = memo<EditorModalProps>(({ value, onConfirm, ...rest }) => {
  const [confirmLoading, setConfirmLoading] = useState(false);
  const { t } = useTranslation('common');
  const [v, setV] = useState(value);
  const enableRichRender = useUserStore(labPreferSelectors.enableInputMarkdown);
  const editor = useEditor();

  return (
    <Modal
      cancelText={t('cancel')}
      closable={false}
      confirmLoading={confirmLoading}
      destroyOnHidden
      okText={t('ok')}
      onOk={async () => {
        setConfirmLoading(true);
        let finalValue;
        if (enableRichRender) {
          finalValue = editor?.getDocument('markdown') as unknown as string;
        } else {
          finalValue = v;
        }
        await onConfirm?.(finalValue || '');
        setConfirmLoading(false);
      }}
      styles={{
        body: {
          overflow: 'hidden',
          padding: 0,
        },
      }}
      title={null}
      width={'min(90vw, 920px)'}
      {...rest}
    >
      {enableRichRender ? (
        <EditorCanvas defaultValue={value} editor={editor} />
      ) : (
        <TextareCanvas defaultValue={value} onChange={(v) => setV(v)} value={v} />
      )}
    </Modal>
  );
});

export const createEditorModal = (props: EditorModalProps) => createRawModal(EditorModal, props);
