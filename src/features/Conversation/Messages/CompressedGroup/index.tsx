'use client';

import type { UIChatMessage } from '@lobechat/types';
import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { ActionIcon, confirmModal, Tabs, type TabsItem } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp, History, Sparkles, Undo2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import StreamingMarkdown from '@/components/StreamingMarkdown';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { shinyTextStyles } from '@/styles/loading';

import { dataSelectors, useConversationStore } from '../../store';
import CompressedMessageItem from './CompressedMessageItem';
import { isCompressionSummaryGenerating, shouldShowCompressedGroupPanel } from './logic';

/**
 * Whether a group is folded open, and which of its two views is showing, are
 * per-browser reading preferences rather than conversation data: both live in
 * localStorage and are never written back to the message group.
 *
 * Both are read synchronously in the state initialiser instead of through
 * `useLocalStorageState`. That hook defers its read to an effect, which is the
 * right trade for a preference that only tweaks rendering — but the fold decides
 * whether a potentially very long summary renders at all, so a deferred read
 * paints the whole block and then collapses it on every mount, including each
 * virtual-list remount, dragging the transcript's scroll position around.
 */
const activeTabStorageKey = (id: string) => `compressed-group-tab:${id}`;
const expandedStorageKey = (id: string) => `compressed-group-expanded:${id}`;

const readPreference = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writePreference = (key: string, value: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore write failures (private mode, quota)
  }
};

const styles = createStaticStyles(({ css }) => ({
  container: css`
    margin-block-end: 8px;
  `,
  header: css`
    .ant-tabs-nav {
      margin-block-end: 0;
    }
  `,
  messagesContainer: css`
    padding-block: 8px;
  `,
}));

export interface CompressedGroupMessageProps {
  id: string;
  index: number;
}

const CompressedGroupMessage = memo<CompressedGroupMessageProps>(({ id }) => {
  const { t } = useTranslation('chat');
  const [activeTab, setActiveTab] = useState(
    () => readPreference(activeTabStorageKey(id)) ?? 'summary',
  );

  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab);
      writePreference(activeTabStorageKey(id), tab);
    },
    [id],
  );

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
  const [expanded, setExpanded] = useState(
    () => readPreference(expandedStorageKey(id)) !== 'false',
  );

  const handleToggleExpanded = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    writePreference(expandedStorageKey(id), String(next));
  }, [expanded, id]);

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
    [],
  );

  return (
    <Flexbox className={styles.container} gap={8}>
      {isGeneratingSummary ? (
        <>
          <Flexbox horizontal>
            {/*<Icon icon={FolderArchive} size={14} />*/}
            <span className={cx(isGeneratingSummary ? shinyTextStyles.shinyText : '')}>
              {t('compressedHistory')}
            </span>
          </Flexbox>
          <StreamingMarkdown>{content}</StreamingMarkdown>
        </>
      ) : (
        <Flexbox horizontal align={'center'} distribution={'space-between'} width={'100%'}>
          <Tabs
            activeKey={isGeneratingSummary ? 'summary' : activeTab}
            className={styles.header}
            items={tabItems}
            variant={'rounded'}
            onChange={handleTabChange}
          />
          <Flexbox horizontal gap={4}>
            <ActionIcon
              icon={Undo2}
              size={'small'}
              title={t('compression.cancel')}
              onClick={handleCancelCompression}
            />
            <ActionIcon
              icon={expanded ? ChevronUp : ChevronDown}
              size={'small'}
              onClick={handleToggleExpanded}
            />
          </Flexbox>
        </Flexbox>
      )}
      {!showPanelContent ? null : activeTab === 'summary' ? (
        <Markdown variant={'chat'}>{content}</Markdown>
      ) : (
        <Flexbox className={styles.messagesContainer} gap={4}>
          {compressedMessages?.map((msg) => (
            <CompressedMessageItem key={msg.id} message={msg} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

CompressedGroupMessage.displayName = 'CompressedGroupMessage';

export default CompressedGroupMessage;
