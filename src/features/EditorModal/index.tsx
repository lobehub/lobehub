import { useEditor } from '@lobehub/editor/react';
import { type ModalProps } from '@lobehub/ui';
import { createRawModal, Modal } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EditorCanvas from './EditorCanvas';

interface EditorModalProps extends ModalProps {
  editorData?: unknown;
  onConfirm?: (value: string, editorData?: unknown) => Promise<void>;
  value?: string;
}

export const EditorModal = memo<EditorModalProps>(
  ({ value, editorData: initialEditorData, onConfirm, ...rest }) => {
    const [confirmLoading, setConfirmLoading] = useState(false);
    const { t } = useTranslation('common');
    const editor = useEditor();

    return (
      <Modal
        destroyOnHidden
        cancelText={t('cancel')}
        closable={false}
        confirmLoading={confirmLoading}
        okText={t('ok')}
        title={null}
        width={'min(90vw, 920px)'}
        styles={{
          body: {
            overflow: 'hidden',
            padding: 0,
          },
        }}
        onOk={async () => {
          setConfirmLoading(true);
          const finalValue = (editor?.getDocument('markdown') as unknown as string) || '';
          const editorData = editor?.getDocument('json');
          await onConfirm?.(finalValue, editorData);
          setConfirmLoading(false);
        }}
        {...rest}
      >
        <EditorCanvas defaultValue={value} editor={editor} editorData={initialEditorData} />
      </Modal>
    );
  },
);

export const createEditorModal = (props: EditorModalProps) => createRawModal(EditorModal, props);
