import { Flexbox, Icon } from '@lobehub/ui';
import { BookUp2Icon } from 'lucide-react';
import { Suspense, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { createModal } from '@/components/FunctionModal';

import SelectForm from './SelectForm';

interface AddFilesToKnowledgeBaseModalProps {
  fileIds: string[];
  knowledgeBaseId?: string;
  onClose?: () => void;
}

interface ModalContentProps {
  fileIds: string[];
  knowledgeBaseId?: string;
  onClose?: () => void;
}

const ModalContent = memo<ModalContentProps>(({ fileIds, knowledgeBaseId, onClose }) => {
  const { t } = useTranslation('knowledgeBase');

  return (
    <>
      <Flexbox gap={8} horizontal paddingBlock={16} paddingInline={16} style={{ paddingBottom: 0 }}>
        <Icon icon={BookUp2Icon} />
        {t('addToKnowledgeBase.title')}
      </Flexbox>
      <Flexbox padding={16} style={{ paddingTop: 0 }}>
        <SelectForm fileIds={fileIds} knowledgeBaseId={knowledgeBaseId} onClose={onClose} />
      </Flexbox>
    </>
  );
});

ModalContent.displayName = 'AddFilesToKnowledgeBaseModalContent';

export const useAddFilesToKnowledgeBaseModal = createModal<AddFilesToKnowledgeBaseModalProps>(
  (instance, params) => ({
    content: (
      <Suspense fallback={<div style={{ minHeight: 200 }} />}>
        <ModalContent
          fileIds={params?.fileIds || []}
          knowledgeBaseId={params?.knowledgeBaseId}
          onClose={() => {
            instance.current?.destroy();
            params?.onClose?.();
          }}
        />
      </Suspense>
    ),
  }),
);
