import { type IEditor } from '@lobehub/editor';
import { useEditor } from '@lobehub/editor/react';
import { Button, createModal, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { lazy, memo, type ReactNode, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const EditorCanvas = lazy(() => import('./EditorCanvas'));

type EditorRef = { current?: IEditor };

interface EditorModalContentProps {
  editorData?: unknown;
  editorRef: EditorRef;
  value?: string;
}

const EditorModalContent = memo<EditorModalContentProps>(({ editorData, editorRef, value }) => {
  const editor = useEditor();

  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);

  return (
    <Suspense fallback={<div style={{ minHeight: '50vh' }} />}>
      <EditorCanvas defaultValue={value} editor={editor} editorData={editorData} />
    </Suspense>
  );
});

EditorModalContent.displayName = 'EditorModalContent';

interface EditorModalFooterProps {
  editorRef: EditorRef;
  okText?: ReactNode;
  onConfirm?: (value: string, editorData?: unknown) => Promise<void>;
}

const EditorModalFooter = memo<EditorModalFooterProps>(({ editorRef, okText, onConfirm }) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const [confirmLoading, setConfirmLoading] = useState(false);

  const handleConfirm = async () => {
    setConfirmLoading(true);
    try {
      const editor = editorRef.current;
      const finalValue = (editor?.getDocument('markdown') as unknown as string) || '';
      const editorData = editor?.getDocument('json');
      await onConfirm?.(finalValue, editorData);
      close();
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <ModalFooter>
      <Button onClick={close}>{t('cancel')}</Button>
      <Button loading={confirmLoading} type={'primary'} onClick={handleConfirm}>
        {okText ?? t('ok', { defaultValue: 'OK' })}
      </Button>
    </ModalFooter>
  );
});

EditorModalFooter.displayName = 'EditorModalFooter';

export interface OpenEditorModalOptions {
  editorData?: unknown;
  okText?: ReactNode;
  /** Runs whenever the modal closes, including confirm — clear caller-side editing flags here. */
  onClose?: () => void;
  onConfirm?: (value: string, editorData?: unknown) => Promise<void>;
  value?: string;
}

export const openEditorModal = ({
  editorData,
  okText,
  onClose,
  onConfirm,
  value,
}: OpenEditorModalOptions) => {
  // The editor instance is created by the content component but read by the
  // footer, and the two are siblings in the modal tree — bridge them by ref.
  const editorRef: EditorRef = {};

  return createModal({
    content: <EditorModalContent editorData={editorData} editorRef={editorRef} value={value} />,
    footer: <EditorModalFooter editorRef={editorRef} okText={okText} onConfirm={onConfirm} />,
    onOpenChange: (open) => {
      if (!open) onClose?.();
    },
    styles: { content: { overflow: 'hidden', padding: 0 } },
    width: 'min(90vw, 920px)',
  });
};
