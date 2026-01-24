'use client';

import { CompressionGroupMetadata } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Markdown, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp, FolderArchive } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StreamingMarkdown from '@/components/StreamingMarkdown';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { shinyTextStyles } from '@/styles/loading';

import { dataSelectors, useConversationStore } from '../../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    border-radius: 12px;
    padding: 8px 12px;
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorderSecondary};
  `,
  contentScroll: css`
    max-height: min(40vh, 400px);
    padding-block-end: 8px;
  `,
  tag: css`
    gap: 4px;
    align-items: center;

    padding-block: 4px;

    border-radius: 4px;
  `,
}));

export interface CompressedGroupMessageProps {
  id: string;
  index: number;
}

const CompressedGroupMessage = memo<CompressedGroupMessageProps>(({ id }) => {
  const { t } = useTranslation('chat');

  const message = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);
  const toggleCompressedGroupExpanded = useConversationStore(
    (s) => s.toggleCompressedGroupExpanded,
  );

  const content = message?.content;
  const expanded = (message?.metadata as CompressionGroupMetadata)?.expanded ?? true;

  // Check if generateSummary operation is running for this message
  const runningOp = useChatStore(operationSelectors.getDeepestRunningOperationByMessage(id));
  const isGeneratingSummary = runningOp?.type === 'generateSummary';

  // Auto-expand when generating summary to show streaming content
  const showContent = expanded || isGeneratingSummary;

  return (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox align={'center'} distribution={'space-between'} horizontal>
        <Flexbox className={styles.tag} horizontal>
          <Icon icon={FolderArchive} size={14} />
          <span className={cx(isGeneratingSummary ? shinyTextStyles.shinyText : '')}>
            {t('compressedHistory')}
          </span>
        </Flexbox>
        {!!content && !isGeneratingSummary && (
          <ActionIcon
            icon={expanded ? ChevronUp : ChevronDown}
            onClick={() => toggleCompressedGroupExpanded(id)}
            size={'small'}
          />
        )}
      </Flexbox>
      {!(!!content && showContent) ? undefined : isGeneratingSummary ? (
        <StreamingMarkdown>{content}</StreamingMarkdown>
      ) : (
        <ScrollShadow className={styles.contentScroll} offset={12} size={12}>
          <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
            {content}
          </Markdown>
        </ScrollShadow>
      )}
    </Flexbox>
  );
});

CompressedGroupMessage.displayName = 'CompressedGroupMessage';

export default CompressedGroupMessage;
