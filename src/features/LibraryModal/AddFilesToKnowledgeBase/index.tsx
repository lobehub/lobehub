import { Flexbox, Icon } from '@lobehub/ui';
import { createModal, useModalContext } from '@lobehub/ui/base-ui';
import { t as i18nt } from 'i18next';
import { BookUp2Icon } from 'lucide-react';
import { memo, Suspense, useCallback } from 'react';

import SelectForm from './SelectForm';

interface AddFilesToKnowledgeBaseModalProps {
  fileIds: string[];
  knowledgeBaseId?: string;
  onClose?: () => void;
  resolveFileIds?: () => Promise<string[]>;
  selectedCount?: number;
}

interface ModalContentProps {
  fileIds: string[];
  knowledgeBaseId?: string;
  resolveFileIds?: () => Promise<string[]>;
  selectedCount?: number;
}

const ModalContent = memo<ModalContentProps>(
  ({ fileIds, knowledgeBaseId, resolveFileIds, selectedCount }) => {
    const { close } = useModalContext();
    return (
      <SelectForm
        fileIds={fileIds}
        knowledgeBaseId={knowledgeBaseId}
        resolveFileIds={resolveFileIds}
        selectedCount={selectedCount}
        onClose={close}
      />
    );
  },
);

ModalContent.displayName = 'AddFilesToKnowledgeBaseModalContent';

export const useAddFilesToKnowledgeBaseModal = () => {
  const open = useCallback((params?: AddFilesToKnowledgeBaseModalProps) => {
    createModal({
      content: (
        <Suspense fallback={<div style={{ minHeight: 200 }} />}>
          <ModalContent
            fileIds={params?.fileIds || []}
            knowledgeBaseId={params?.knowledgeBaseId}
            resolveFileIds={params?.resolveFileIds}
            selectedCount={params?.selectedCount}
          />
        </Suspense>
      ),
      footer: null,
      onOpenChangeComplete: (open) => {
        if (!open) params?.onClose?.();
      },
      title: (
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={BookUp2Icon} />
          {i18nt('addToKnowledgeBase.title', { ns: 'knowledgeBase' })}
        </Flexbox>
      ),
    });
  }, []);

  return { open };
};
