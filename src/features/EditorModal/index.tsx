import { useEditor } from '@lobehub/editor/react';
import { Modal, ModalProps, createRawModal } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EditorCanvas from './EditorCanvas';

interface EditorModalProps extends ModalProps {
  onConfirm?: (value: string) => Promise<void>;
  value?: string;
}

export const EditorModal = memo<EditorModalProps>(({ value, onConfirm, ...rest }) => {
  const [confirmLoading, setConfirmLoading] = useState(false);
  const { t } = useTranslation('common');

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
        try {
          await onConfirm?.((editor?.getDocument('markdown') as unknown as string) || '');
        } catch (e) {
          console.error('EditorModal onOk error:', e);
          onConfirm?.(value || '');
        }
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
      <EditorCanvas defaultValue={value} editor={editor} />
    </Modal>
  );
});

export const createEditorModal = (props: EditorModalProps) => createRawModal(EditorModal, props);
