'use client';

import { Markdown } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { shareChatService } from '@/services/shareChat';

export interface ShareVisitorDocumentContentProps {
  documentId: string;
  shareId: string;
  topicId: string;
}

/**
 * Read-only body of a `document` Work opened from the agent-share visitor
 * surface. The visitor has no owner-scoped document access (the document
 * belongs to the CREATOR), so it is fetched through the share-authorized read
 * instead of the Portal's document viewer.
 */
const ShareVisitorDocumentContent = memo<ShareVisitorDocumentContentProps>(
  ({ documentId, shareId, topicId }) => {
    const { t } = useTranslation('chat');
    const { data, error, isLoading } = useClientDataSWR(
      ['shareChat.getDocument', shareId, topicId, documentId],
      () => shareChatService.getDocument(shareId, topicId, documentId),
    );

    if (error) return <Text type="secondary">{t('workingPanel.works.documentLoadError')}</Text>;
    if (isLoading || !data) return <Skeleton height={160} radius={8} />;

    return <Markdown>{data.content ?? ''}</Markdown>;
  },
);

ShareVisitorDocumentContent.displayName = 'ShareVisitorDocumentContent';

export default ShareVisitorDocumentContent;
