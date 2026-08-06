import { Button, createModal, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { lazy, memo, type ReactNode, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EditorBridge } from './type';
import { useEditorBridgeReady } from './useEditorBridgeReady';

// The editor package is heavy and this module is imported statically by hot
// paths (every chat message row), so the half that pulls it in stays lazy.
const EditorModalContent = lazy(() => import('./EditorModalContent'));

interface EditorModalFooterProps {
  editorBridge: EditorBridge;
  okText?: ReactNode;
  onConfirm?: (value: string, editorData?: unknown) => Promise<void>;
}

const EditorModalFooter = memo<EditorModalFooterProps>(({ editorBridge, okText, onConfirm }) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const [confirmLoading, setConfirmLoading] = useState(false);
  const ready = useEditorBridgeReady(editorBridge);

  const handleConfirm = async () => {
    const editor = editorBridge.current;
    // Saving before the lazy content mounted would read an empty document and
    // overwrite the caller's value with ''.
    if (!editor) return;

    setConfirmLoading(true);
    try {
      const finalValue = (editor.getDocument('markdown') as unknown as string) || '';
      const editorData = editor.getDocument('json');
      await onConfirm?.(finalValue, editorData);
      close();
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <ModalFooter>
      <Button onClick={close}>{t('cancel')}</Button>
      <Button disabled={!ready} loading={confirmLoading} type={'primary'} onClick={handleConfirm}>
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
  const editorBridge: EditorBridge = {};

  return createModal({
    content: (
      <Suspense fallback={<div style={{ minHeight: '50vh' }} />}>
        <EditorModalContent editorBridge={editorBridge} editorData={editorData} value={value} />
      </Suspense>
    ),
    footer: <EditorModalFooter editorBridge={editorBridge} okText={okText} onConfirm={onConfirm} />,
    // NOT `onOpenChange`: that only fires for user dismissal, while the footer's
    // Cancel goes through `instance.close()`. Cancelling would then leave the
    // caller's editing flag set and the editor could never be reopened.
    // `createModal` only ever completes with `false`, but the open flag is
    // honored so this does not depend on that renderer detail.
    onOpenChangeComplete: (open) => {
      if (!open) onClose?.();
    },
    styles: { content: { overflow: 'hidden', padding: 0 } },
    width: 'min(90vw, 920px)',
  });
};
