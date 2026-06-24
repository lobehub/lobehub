import { useEditor } from '@lobehub/editor/react';
import { Modal, type ModalComponentProps } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EditorCanvas from './EditorCanvas';

interface EditorModalProps extends ModalComponentProps {
  editorData?: unknown;
  onConfirm?: (value: string, editorData?: unknown) => Promise<void>;
  value?: string;
}

export const EditorModal = memo<EditorModalProps>(
  ({ value, editorData: initialEditorData, onConfirm, ...rest }) => {
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [modalPanel, setModalPanel] = useState<HTMLDivElement | null>(null);
    const { t } = useTranslation('common');
    const editor = useEditor();

    return (
      <Modal
        destroyOnHidden
        cancelText={t('cancel')}
        closable={false}
        confirmLoading={confirmLoading}
        okText={t('ok')}
        panelRef={setModalPanel}
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
          try {
            await onConfirm?.(finalValue, editorData);
          } finally {
            setConfirmLoading(false);
          }
        }}
        {...rest}
      >
        <EditorCanvas
          defaultValue={value}
          editor={editor}
          editorData={initialEditorData}
          tooltipPopupContainer={modalPanel}
        />
      </Modal>
    );
  },
);
