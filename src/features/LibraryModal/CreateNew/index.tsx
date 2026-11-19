import { createModal, useModalContext } from '@lobehub/ui';
import { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import CreateForm from './CreateForm';
import type { LibraryFormOptions } from './useLibraryForm';

type OpenParams = Omit<LibraryFormOptions, 'onClose'>;

const ModalContent = memo<OpenParams>((props) => {
  const { close } = useModalContext();

  return <CreateForm {...props} onClose={close} />;
});

ModalContent.displayName = 'KnowledgeBaseCreateModalContent';

export const useCreateNewModal = () => {
  const { t } = useTranslation('knowledgeBase');

  const open = useCallback(
    (props?: OpenParams) => {
      const isEditMode = !!props?.id;

      createModal({
        content: (
          <Suspense fallback={<div style={{ minHeight: 200 }} />}>
            <ModalContent {...props} />
          </Suspense>
        ),
        footer: null,
        styles: { content: { padding: 0 } },
        title: isEditMode ? t('createNew.edit.title') : t('createNew.title'),
        width: 420,
      });
    },
    [t],
  );

  return { open };
};
