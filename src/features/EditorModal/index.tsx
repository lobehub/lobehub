import { Button, createModal, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { lazy, memo, type ReactNode, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EditorRef } from './type';

// The editor package is heavy and this module is imported statically by hot
// paths (every chat message row), so the half that pulls it in stays lazy.
const EditorModalContent = lazy(() => import('./EditorModalContent'));

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
    content: (
      <Suspense fallback={<div style={{ minHeight: '50vh' }} />}>
        <EditorModalContent editorData={editorData} editorRef={editorRef} value={value} />
      </Suspense>
    ),
    footer: <EditorModalFooter editorRef={editorRef} okText={okText} onConfirm={onConfirm} />,
    onOpenChange: (open) => {
      if (!open) onClose?.();
    },
    styles: { content: { overflow: 'hidden', padding: 0 } },
    width: 'min(90vw, 920px)',
  });
};
