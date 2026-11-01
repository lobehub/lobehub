'use client';

import type { CompressionGroupMetadata, UIChatMessage } from '@lobechat/types';
import { cx, Divider, Flexbox, Icon, Markdown } from '@lobehub/ui';
import { ActionIcon, confirmModal, Tabs, type TabsItem } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp, History, Sparkles, Undo2 } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import StreamingMarkdown from '@/components/StreamingMarkdown';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { shinyTextStyles } from '@/styles/loading';

import { dataSelectors, useConversationStore } from '../../store';
import CompressedMessageItem from './CompressedMessageItem';
import {
  getCompressedTurnCount,
  isCompressionSummaryGenerating,
  shouldShowCompressedGroupPanel,
} from './logic';
import { useGroupPreferences } from './useGroupPreferences';

const styles = stylex.create({
  collapsedButton: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderStyle: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextDescription, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: 'color 0.2s ease',
  },
  container: { marginBlockEnd: '8px' },
  divider: { margin: '0' },
  messagesContainer: { paddingBlock: '8px' },
});

export interface CompressedGroupMessageProps {
  id: string;
  index: number;
}

const CompressedGroupMessage = memo<CompressedGroupMessageProps>(({ id }) => {
  const { t } = useTranslation('chat');
  const { activeTab, expanded, setActiveTab, toggleExpanded } = useGroupPreferences(id);

  const message = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);
  const cancelCompression = useConversationStore((s) => s.cancelCompression);

  const handleCancelCompression = useCallback(() => {
    confirmModal({
      content: t('compression.cancelConfirm'),
      onOk: () => cancelCompression(id),
      title: t('compression.cancel'),
    });
  }, [id, cancelCompression, t]);

  const content = message?.content;
  const rawCompressedMessages = (message as UIChatMessage)?.compressedMessages;

  // Filter out placeholder assistant message (content === '...' without tools)
  const compressedMessages = useMemo(() => {
    if (!rawCompressedMessages || rawCompressedMessages.length === 0) return rawCompressedMessages;

    const lastMsg = rawCompressedMessages.at(-1);
    const isPlaceholder =
      lastMsg &&
      (lastMsg.role === 'assistant' || lastMsg.role === 'assistantGroup') &&
      lastMsg.content === '...' &&
      (!lastMsg.tools || lastMsg.tools.length === 0) &&
      (!lastMsg.children || lastMsg.children.length === 0);

    return isPlaceholder ? rawCompressedMessages.slice(0, -1) : rawCompressedMessages;
  }, [rawCompressedMessages]);

  // Check if generateSummary operation is running for this message
  const runningOp = useChatStore(operationSelectors.getDeepestRunningOperationByMessage(id));
  const isGeneratingSummary = isCompressionSummaryGenerating(runningOp?.type);

  const showPanelContent = shouldShowCompressedGroupPanel({
    expanded,
    isGeneratingSummary,
  });

  // How much history this group folded away, phrased as conversation turns.
  const compressedTurnCount = useMemo(
    () =>
      getCompressedTurnCount({
        compressedMessages,
        compressedTurnCount: (message as UIChatMessage | undefined)?.compressedTurnCount,
        originalMessageCount: (
          (message as UIChatMessage | undefined)?.metadata as CompressionGroupMetadata | undefined
        )?.originalMessageCount,
      }),
    [compressedMessages, message],
  );

  const tabItems: TabsItem[] = useMemo(
    () => [
      {
        icon: <Icon icon={Sparkles} size={14} />,
        key: 'summary',
        label: t('compression.summary'),
      },
      {
        icon: <Icon icon={History} size={14} />,
        key: 'history',
        label: t('compression.history'),
      },
    ],
    [t],
  );

  if (isGeneratingSummary) {
    return (
      <Flexbox className={stylex.props(styles.container).className} gap={8}>
        <Flexbox horizontal>
          <span className={cx(shinyTextStyles.shinyText)}>{t('compressedHistory')}</span>
        </Flexbox>
        <StreamingMarkdown>{content}</StreamingMarkdown>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={8}>
      {expanded ? (
        <>
          <Flexbox horizontal align={'center'} distribution={'space-between'} width={'100%'}>
            <Tabs
              activeKey={activeTab}
              items={tabItems}
              variant={'rounded'}
              onChange={setActiveTab}
            />
            <Flexbox horizontal gap={4}>
              <ActionIcon
                icon={Undo2}
                size={'small'}
                title={t('compression.cancel')}
                onClick={handleCancelCompression}
              />
              <ActionIcon icon={ChevronUp} size={'small'} onClick={toggleExpanded} />
            </Flexbox>
          </Flexbox>
          {!showPanelContent ? null : activeTab === 'summary' ? (
            <Markdown variant={'chat'}>{content}</Markdown>
          ) : (
            <Flexbox className={stylex.props(styles.messagesContainer).className} gap={4}>
              {compressedMessages?.map((msg) => (
                <CompressedMessageItem key={msg.id} message={msg} />
              ))}
            </Flexbox>
          )}
        </>
      ) : (
        <Divider className={stylex.props(styles.divider).className}>
          <button
            {...stylex.props(styles.collapsedButton)}
            type={'button'}
            onClick={toggleExpanded}
          >
            <Icon icon={History} size={14} />
            <span>
              {compressedTurnCount > 0
                ? t('compression.collapsed', { turns: compressedTurnCount })
                : t('compression.collapsedUnknown')}
            </span>
            <Icon icon={ChevronDown} size={14} />
          </button>
        </Divider>
      )}
    </Flexbox>
  );
});

CompressedGroupMessage.displayName = 'CompressedGroupMessage';

export default CompressedGroupMessage;
