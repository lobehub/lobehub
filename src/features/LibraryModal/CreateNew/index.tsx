import { Flexbox, createModal, useModalContext } from '@lobehub/ui';
import { Suspense, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import CreateForm from './CreateForm';

interface ModalContentProps {
  id?: string;
  initialValues?: { name?: string; description?: string };
  onSuccess?: (id: string) => void;
}

const ModalContent = memo<ModalContentProps>(({ id, initialValues, onSuccess }) => {
  const { close } = useModalContext();

  return (
    <Flexbox paddingInline={8} style={{ paddingBottom: 8 }}>
      <CreateForm id={id} initialValues={initialValues} onClose={close} onSuccess={onSuccess} />
    </Flexbox>
  );
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
        children: (
          <Suspense fallback={<div style={{ minHeight: 200 }} />}>
            <ModalContent
              id={props?.id}
              initialValues={props?.initialValues}
              onSuccess={props?.onSuccess}
            />
          </Suspense>
        ),
        width: 420,
        focusTriggerAfterClose: true,
        footer: null,
        title: isEditMode ? t('createNew.edit.title') : t('createNew.title'),
      });
    },
    [t],
  );

  return { open };
};
