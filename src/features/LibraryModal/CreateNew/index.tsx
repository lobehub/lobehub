import { Flexbox } from '@lobehub/ui';
import { Suspense, memo } from 'react';

import { createModal } from '@/components/FunctionModal';

import CreateForm from './CreateForm';

interface ModalContentProps {
  onClose?: () => void;
  onSuccess?: (id: string) => void;
}

const ModalContent = memo<ModalContentProps>(({ onClose, onSuccess }) => {
  return (
    <Flexbox paddingInline={16} style={{ paddingBottom: 16 }}>
      <CreateForm onClose={onClose} onSuccess={onSuccess} />
    </Flexbox>
  );
});

ModalContent.displayName = 'KnowledgeBaseCreateModalContent';

// eslint-disable-next-line unused-imports/no-unused-vars
export const useCreateNewModal = createModal<{ onSuccess?: (id: string) => void }>(
  (instance, props) => {
    return {
      content: (
        <Suspense fallback={<div style={{ minHeight: 200 }} />}>
          <ModalContent
            onClose={() => {
              instance.current?.destroy();
            }}
            onSuccess={props?.onSuccess}
          />
        </Suspense>
      ),
      focusTriggerAfterClose: true,
      footer: false,
    };
  },
);
