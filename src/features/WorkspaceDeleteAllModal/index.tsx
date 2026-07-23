'use client';

import { Checkbox, Flexbox, Text } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';

interface WorkspaceDeleteAllModalContentProps {
  acknowledgeText: string;
  cancelText: string;
  confirmText: string;
  description: string;
  onConfirm: () => Promise<void>;
}

const WorkspaceDeleteAllModalContent = memo<WorkspaceDeleteAllModalContentProps>(
  ({ acknowledgeText, cancelText, confirmText, description, onConfirm }) => {
    const { close } = useModalContext();
    const [acknowledged, setAcknowledged] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleConfirm = useCallback(async () => {
      if (!acknowledged || loading) return;

      setLoading(true);
      try {
        await onConfirm();
        close();
      } finally {
        setLoading(false);
      }
    }, [acknowledged, close, loading, onConfirm]);

    return (
      <Flexbox gap={20}>
        <Text type={'secondary'}>{description}</Text>
        <Checkbox checked={acknowledged} onChange={setAcknowledged}>
          {acknowledgeText}
        </Checkbox>
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={loading} onClick={close}>
            {cancelText}
          </Button>
          <Button
            danger
            disabled={!acknowledged}
            loading={loading}
            type={'primary'}
            onClick={handleConfirm}
          >
            {confirmText}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

WorkspaceDeleteAllModalContent.displayName = 'WorkspaceDeleteAllModalContent';

export interface OpenWorkspaceDeleteAllModalOptions {
  acknowledgeText: string;
  cancelText: string;
  confirmText: string;
  description: string;
  onConfirm: () => Promise<void>;
  title: string;
}

export const openWorkspaceDeleteAllModal = ({
  acknowledgeText,
  cancelText,
  confirmText,
  description,
  onConfirm,
  title,
}: OpenWorkspaceDeleteAllModalOptions): ModalInstance =>
  createModal({
    content: (
      <WorkspaceDeleteAllModalContent
        acknowledgeText={acknowledgeText}
        cancelText={cancelText}
        confirmText={confirmText}
        description={description}
        onConfirm={onConfirm}
      />
    ),
    footer: null,
    maskClosable: false,
    styles: { header: { borderBottom: 'none' } },
    title,
    width: 'min(90vw, 480px)',
  });
