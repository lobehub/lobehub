import { createModal, useModalContext } from '@lobehub/ui';
import { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import CreateForm from './CreateForm';

interface ModalContentProps {
  id?: string;
  initialValues?: { cover?: string; description?: string; name?: string };
  onSuccess?: (id: string) => void;
  visibility?: 'private' | 'public';
}

const ModalContent = memo<ModalContentProps>(({ id, initialValues, onSuccess, visibility }) => {
  const { close } = useModalContext();

  return (
    <CreateForm
      id={id}
      initialValues={initialValues}
      visibility={visibility}
      onClose={close}
      onSuccess={onSuccess}
    />
  );
});

ModalContent.displayName = 'KnowledgeBaseCreateModalContent';

interface OpenParams {
  id?: string;
  initialValues?: { cover?: string; description?: string; name?: string };
  onSuccess?: (id: string) => void;
  /** Scope for a new library; defaults to the Resources sidebar mode. */
  visibility?: 'private' | 'public';
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
              visibility={props?.visibility}
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
