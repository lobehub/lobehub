'use client';

import { Center, Flexbox, SkeletonTitle } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { MessageSquarePlus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useChatStore } from '@/store/chat';

import { getTopicPanelViewState } from './topicPanelViewState';
import { isTopicRowActivationKey } from './topicRowActivation';
import { useVisitorTopics } from './useVisitorTopics';

/** Placeholder rows shown while the visitor's topic list is loading, sized like a typical topic title. */
const LOADING_ROW_WIDTHS = ['80%', '55%', '68%'];

const styles = createStaticStyles(({ css }) => ({
  row: css`
    cursor: pointer;
    border-radius: 6px;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -1px;
    }
  `,
  rowActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
}));

/**
 * The visitor's topic list under the current share (server-scoped by
 * senderId). Selecting a topic drives the chat store's activeTopicId — the
 * same signal the conversation surface and composer key off.
 */
const TopicPanel = memo<{
  /** Off for a non-interactive share (owner preview): skips the fetch that would only 403. */
  enabled?: boolean;
  onSelect?: () => void;
  shareId: string;
  showTitle?: boolean;
}>(({ enabled = true, onSelect, shareId, showTitle = true }) => {
  const { t } = useTranslation('agent');
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const { data: topics, error, isLoading, mutate } = useVisitorTopics(shareId, enabled);
  const viewState = getTopicPanelViewState(topics, error, isLoading);

  const selectTopic = (topicId?: string) => {
    useChatStore.setState({ activeTopicId: topicId }, false, 'AgentShareVisitor/selectTopic');
    onSelect?.();
  };

  return (
    <Flexbox gap={8} height={'100%'} padding={12} style={{ overflowY: 'auto' }}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        {showTitle && (
          <Text fontSize={12} type={'secondary'} weight={500}>
            {t('share.visitor.topics.title')}
          </Text>
        )}
        <ActionIcon
          icon={MessageSquarePlus}
          size={'small'}
          title={t('share.visitor.topics.new')}
          onClick={() => selectTopic(undefined)}
        />
      </Flexbox>
      {viewState === 'error' ? (
        <Center flex={1}>
          <AsyncError error={error} variant={'inline'} onRetry={() => mutate()} />
        </Center>
      ) : viewState === 'loading' ? (
        <Flexbox gap={4}>
          {LOADING_ROW_WIDTHS.map((width, index) => (
            <Flexbox key={index} paddingBlock={6} paddingInline={8}>
              <SkeletonTitle style={{ marginBottom: 0, width }} />
            </Flexbox>
          ))}
        </Flexbox>
      ) : viewState === 'empty' ? (
        <Center flex={1}>
          <Text fontSize={12} type={'secondary'}>
            {t('share.visitor.topics.empty')}
          </Text>
        </Center>
      ) : (
        (topics ?? []).map((topic) => {
          const active = topic.id === activeTopicId;
          return (
            <Flexbox
              aria-current={active || undefined}
              className={cx(styles.row, active && styles.rowActive)}
              key={topic.id}
              paddingBlock={6}
              paddingInline={8}
              role={'button'}
              tabIndex={0}
              onClick={() => selectTopic(topic.id)}
              onKeyDown={(e) => {
                // Mirror native button keyboard semantics for the div-as-button row.
                if (!isTopicRowActivationKey(e.key)) return;
                // Space's default action scrolls the page; Enter has no default
                // action on a non-form div, so only Space needs suppressing.
                if (e.key === ' ') e.preventDefault();
                selectTopic(topic.id);
              }}
            >
              <Text ellipsis fontSize={13}>
                {topic.title || t('share.visitor.topics.untitled')}
              </Text>
            </Flexbox>
          );
        })
      )}
    </Flexbox>
  );
});

TopicPanel.displayName = 'ShareVisitorTopicPanel';

export default TopicPanel;
