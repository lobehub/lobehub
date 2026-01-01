'use client';

import { Center, Empty, Flexbox } from '@lobehub/ui';
import { Spin } from 'antd';
import { BookOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchNotebookDocuments } from '@/hooks/useFetchNotebookDocuments';
import { useChatStore } from '@/store/chat';

import DocumentItem from './DocumentItem';

const NotebookBody = memo(() => {
  const { t } = useTranslation('portal');
  const topicId = useChatStore((s) => s.activeTopicId);
  const { documents, isLoading } = useFetchNotebookDocuments(topicId);

  // Show message when no topic is selected
  if (!topicId) {
    return (
      <Center flex={1} gap={8} paddingBlock={24}>
        <Empty description={t('notebook.empty')} icon={BookOpenIcon} />
      </Center>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <Center flex={1}>
        <Spin />
      </Center>
    );
  }

  // Show empty state
  if (documents.length === 0) {
    return (
      <Center flex={1} gap={8} paddingBlock={24}>
        <Empty description={t('notebook.empty')} icon={BookOpenIcon} />
      </Center>
    );
  }

  // Render document list
  return (
    <Flexbox gap={8} height={'100%'} paddingInline={12} style={{ overflow: 'auto' }}>
      {documents.map((doc) => (
        <DocumentItem document={doc} key={doc.id} topicId={topicId} />
      ))}
    </Flexbox>
  );
});

export default NotebookBody;
