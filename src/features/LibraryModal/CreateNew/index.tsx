import { createModal, useModalContext } from '@lobehub/ui/base-ui';
import { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import CreateForm from './CreateForm';

interface ModalContentProps {
  id?: string;
  initialValues?: { name?: string; description?: string };
  onSuccess?: (id: string) => void;
}

const ModalContent = memo<ModalContentProps>(({ id, initialValues, onSuccess }) => {
  const { close } = useModalContext();

  return <CreateForm id={id} initialValues={initialValues} onClose={close} onSuccess={onSuccess} />;
});

ModalContent.displayName = 'KnowledgeBaseCreateModalContent';

interface OpenParams {
  id?: string;
  initialValues?: { name?: string; description?: string };
  onSuccess?: (id: string) => void;
}

export const useCreateNewModal = () => {
  const { t } = useTranslation('knowledgeBase');

  const open = useCallback(
    (props?: OpenParams) => {
      const isEditMode = !!props?.id;

      createModal({
        content: (
          <Suspense fallback={<div style={{ minHeight: 200 }} />}>
            <ModalContent
              id={props?.id}
              initialValues={props?.initialValues}
              onSuccess={props?.onSuccess}
            />
          </Suspense>
        ),
        footer: null,
        title: isEditMode ? t('createNew.edit.title') : t('createNew.title'),
        width: 420,
      });
    },
    [t],
  );

  return { open };
};
