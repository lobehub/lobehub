'use client';

import { Avatar, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Spin } from 'antd';
import { cssVar } from 'antd-style';
import { BookOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import Balancer from 'react-wrap-balancer';

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
      <Center
        flex={1}
        gap={8}
        paddingBlock={24}
        style={{ border: `1px dashed ${cssVar.colorSplit}`, borderRadius: 8, marginInline: 12 }}
      >
        <Avatar
          avatar={<Icon icon={BookOpenIcon} size={'large'} />}
          background={cssVar.colorFillTertiary}
          shape={'square'}
          size={48}
        />
        <Balancer>
          <Text type={'secondary'}>{t('notebook.empty')}</Text>
        </Balancer>
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
      <Center
        flex={1}
        gap={8}
        paddingBlock={24}
        style={{ border: `1px dashed ${cssVar.colorSplit}`, borderRadius: 8, marginInline: 12 }}
      >
        <Avatar
          avatar={<Icon icon={BookOpenIcon} size={'large'} />}
          background={cssVar.colorFillTertiary}
          shape={'square'}
          size={48}
        />
        <Balancer>
          <Text style={{ textAlign: 'center' }} type={'secondary'}>
            {t('notebook.empty')}
          </Text>
        </Balancer>
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
