import { createModal, Flexbox, useModalContext } from '@lobehub/ui';
import { memo, Suspense, useCallback } from 'react';

import CreateForm from './CreateForm';

interface ModalContentProps {
  onSuccess?: (id: string) => void;
}

const ModalContent = memo<ModalContentProps>(({ onSuccess }) => {
  const { close } = useModalContext();

  return (
    <Flexbox paddingInline={16} style={{ paddingBottom: 16 }}>
      <CreateForm onClose={close} onSuccess={onSuccess} />
    </Flexbox>
  );
});

ModalContent.displayName = 'KnowledgeBaseCreateModalContent';

export const useCreateNewModal = () => {
  const open = useCallback((props?: { onSuccess?: (id: string) => void }) => {
    createModal({
      children: (
        <Suspense fallback={<div style={{ minHeight: 200 }} />}>
          <ModalContent onSuccess={props?.onSuccess} />
        </Suspense>
      ),
      focusTriggerAfterClose: true,
      footer: null,
      title: null,
    });
  }, []);

  return { open };
};
