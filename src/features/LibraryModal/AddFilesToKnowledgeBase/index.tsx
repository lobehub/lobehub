import { createModal, Flexbox, Icon, useModalContext } from '@lobehub/ui';
import { BookUp2Icon } from 'lucide-react';
import { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import SelectForm from './SelectForm';

interface AddFilesToKnowledgeBaseModalProps {
  fileIds: string[];
  knowledgeBaseId?: string;
  onClose?: () => void;
}

interface ModalContentProps {
  fileIds: string[];
  knowledgeBaseId?: string;
}

const ModalContent = memo<ModalContentProps>(({ fileIds, knowledgeBaseId }) => {
  const { t } = useTranslation('knowledgeBase');
  const { close } = useModalContext();
  return (
    <>
      <Flexbox horizontal gap={8} paddingBlock={16} paddingInline={16} style={{ paddingBottom: 0 }}>
        <Icon icon={BookUp2Icon} />
        {t('addToKnowledgeBase.title')}
      </Flexbox>
      <Flexbox padding={16} style={{ paddingTop: 0 }}>
        <SelectForm fileIds={fileIds} knowledgeBaseId={knowledgeBaseId} onClose={close} />
      </Flexbox>
    </>
  );
});

ModalContent.displayName = 'AddFilesToKnowledgeBaseModalContent';

export const useAddFilesToKnowledgeBaseModal = () => {
  const open = useCallback((params?: AddFilesToKnowledgeBaseModalProps) => {
    createModal({
      afterClose: params?.onClose,
      children: (
        <Suspense fallback={<div style={{ minHeight: 200 }} />}>
          <ModalContent fileIds={params?.fileIds || []} knowledgeBaseId={params?.knowledgeBaseId} />
        </Suspense>
      ),
      footer: null,
      title: null,
    });
  }, []);

  return { open };
};
