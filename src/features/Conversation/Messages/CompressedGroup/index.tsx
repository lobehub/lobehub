'use client';

import type { CompressionGroupMetadata, UIChatMessage } from '@lobechat/types';
import {
  ActionIcon,
  confirmModal,
  cx,
  Divider,
  Flexbox,
  Icon,
  Markdown,
  Tabs,
  type TabsItem,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp, FoldVertical, History, Sparkles, Undo2 } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import StreamingMarkdown from '@/components/StreamingMarkdown';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { shinyTextStyles } from '@/styles/loading';

import { dataSelectors, useConversationStore } from '../../store';
import { useCompressedHistoryInline } from '../Contexts/CompressedHistoryInlineContext';
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
  compressingLabel: {
    paddingBlock: '2px',
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  container: { marginBlockEnd: '8px' },
  divider: { margin: '0' },
  summaryTitle: { fontSize: '13px', fontWeight: 500, color: cssVar.colorTextSecondary },
  messagesContainer: { paddingBlock: '8px' },
});

export interface CompressedGroupMessageProps {
  id: string;
  index: number;
}

const CompressedGroupMessage = memo<CompressedGroupMessageProps>(({ id }) => {
  const { t } = useTranslation('chat');
  const { activeTab, expanded, setActiveTab, toggleExpanded } = useGroupPreferences(id);
  // The chat list renders the original conversation as rows above this group,
  // so the group is just the divider at the compression point plus its summary.
  const historyInline = useCompressedHistoryInline();

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

  // Compression should stay out of the reader's way: while the summary is
  // generated the group is a single in-progress row at the compression point,
  // and the summary only appears when the reader opens it afterwards.
  if (isGeneratingSummary && historyInline) {
    return (
      <Flexbox className={stylex.props(styles.container).className}>
        <Divider className={stylex.props(styles.divider).className}>
          <Flexbox horizontal align={'center'} gap={6} {...stylex.props(styles.compressingLabel)}>
            <Icon icon={FoldVertical} size={14} />
            <span className={cx(shinyTextStyles.shinyText)}>
              {t('compression.dividerCompressing')}
            </span>
          </Flexbox>
        </Divider>
      </Flexbox>
    );
  }

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

  const turnsLabel = (inline: boolean) =>
    compressedTurnCount > 0
      ? t(inline ? 'compression.dividerAbove' : 'compression.collapsed', {
          turns: compressedTurnCount,
        })
      : t(inline ? 'compression.dividerAboveUnknown' : 'compression.collapsedUnknown');

  const cancelAction = (
    <ActionIcon
      icon={Undo2}
      size={'small'}
      title={t('compression.cancel')}
      onClick={handleCancelCompression}
    />
  );

  // The original conversation sits right above as ordinary rows, so the
  // divider stays put as the compression marker and only toggles the summary.
  if (historyInline) {
    return (
      <Flexbox className={stylex.props(styles.container).className} gap={8}>
        <Divider className={stylex.props(styles.divider).className}>
          <button
            {...stylex.props(styles.collapsedButton)}
            aria-expanded={expanded}
            type={'button'}
            onClick={toggleExpanded}
          >
            <Icon icon={FoldVertical} size={14} />
            <span>{turnsLabel(true)}</span>
            <Icon icon={expanded ? ChevronUp : ChevronDown} size={14} />
          </button>
        </Divider>
        {showPanelContent && (
          <Flexbox gap={8}>
            <Flexbox horizontal align={'center'} distribution={'space-between'} width={'100%'}>
              <Flexbox horizontal align={'center'} gap={6} {...stylex.props(styles.summaryTitle)}>
                <Icon icon={Sparkles} size={14} />
                <span>{t('compression.summary')}</span>
              </Flexbox>
              {cancelAction}
            </Flexbox>
            <Markdown variant={'chat'}>{content}</Markdown>
          </Flexbox>
        )}
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
              {cancelAction}
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
            <Icon icon={FoldVertical} size={14} />
            <span>{turnsLabel(false)}</span>
            <Icon icon={ChevronDown} size={14} />
          </button>
        </Divider>
      )}
    </Flexbox>
  );
});

CompressedGroupMessage.displayName = 'CompressedGroupMessage';

export default CompressedGroupMessage;
