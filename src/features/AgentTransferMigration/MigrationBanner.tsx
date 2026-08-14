'use client';

import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2 } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { agentService } from '@/services/agent';
import { useChatStore } from '@/store/chat';

import { type MigrationTarget, useAgentTransferJob } from './useAgentTransferJob';

interface MigrationBannerProps extends MigrationTarget {
  topicId?: string | null;
}

/**
 * Whether this topic's history is still awaiting its transfer/copy backfill.
 * Exposed so the surrounding surface can also gate the chat input.
 */
export const useTopicMigrationPending = (target: MigrationTarget, topicId?: string | null) => {
  const { data } = useAgentTransferJob(target);
  return {
    job: data ?? null,
    topicPending: !!topicId && !!data && data.pendingTopicIds.includes(topicId),
  };
};

/**
 * Centered placeholder shown INSIDE a conversation whose topic is still
 * migrating: it jump-the-queues the topic on mount, keeps polling via the
 * shared job hook, and refetches messages the moment the topic flips over —
 * so the usual wait is a few seconds, then the history appears in place.
 */
export const TopicMigrationPlaceholder = memo<MigrationBannerProps>(
  ({ agentId, groupId, topicId }) => {
    const { t } = useTranslation('chat');
    const { data, mutate } = useAgentTransferJob({ agentId, groupId });
    const refreshMessages = useChatStore((s) => s.refreshMessages);
    // Tracks WHICH topic was prioritized (not just whether one was): switching
    // straight from one pending topic to another reuses this component, and the
    // new topic must jump the queue too.
    const prioritizedTopicId = useRef<string | null>(null);

    useEffect(() => {
      if (!topicId || prioritizedTopicId.current === topicId) return;
      prioritizedTopicId.current = topicId;

      void agentService
        .prioritizeTransferTopic(topicId)
        .then(({ pending }) => {
          // Already migrated between render and request — sync the job status
          // and pull the messages straight away.
          if (!pending) {
            void mutate();
            void refreshMessages();
          }
        })
        .catch(() => {
          if (prioritizedTopicId.current === topicId) prioritizedTopicId.current = null;
        });
    }, [topicId, mutate, refreshMessages]);

    // The placeholder unmounts when `pendingTopicIds` stops listing this topic;
    // fetch the freshly migrated history exactly once on the way out.
    useEffect(
      () => () => {
        void refreshMessages();
      },
      [refreshMessages],
    );

    return (
      <Flexbox align={'center'} flex={1} gap={12} justify={'center'} padding={24}>
        <Icon spin color={cssVar.colorTextDescription} icon={Loader2} size={20} />
        <Text type={'secondary'} weight={500}>
          {t(
            data?.type === 'copy'
              ? 'transferMigration.topicPendingCopy.title'
              : 'transferMigration.topicPending.title',
          )}
        </Text>
        <Text fontSize={12} style={{ maxWidth: 420, textAlign: 'center' }} type={'secondary'}>
          {t('transferMigration.topicPending.desc')}
        </Text>
      </Flexbox>
    );
  },
);

TopicMigrationPlaceholder.displayName = 'TopicMigrationPlaceholder';

const chipStyles = createStaticStyles(({ css }) => ({
  chip: css`
    pointer-events: auto;
    cursor: default;

    padding-block: 3px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 20px;

    font-size: 12px;
    color: ${cssVar.colorText};
    white-space: nowrap;

    /* Solid surface under the translucent fill: the chip also renders as a
       floating overlay on top of chat content, where a bare alpha fill would
       let the text underneath bleed through. */
    background-color: ${cssVar.colorBgElevated};
    background-image: linear-gradient(${cssVar.colorFillTertiary}, ${cssVar.colorFillTertiary});
  `,
}));

/**
 * Compact migration chip for the chat header's center slot: spinner +
 * "Migrating n/m". The full explanation (new chats unaffected, opening a
 * conversation prioritizes it) lives in the tooltip so the header stays calm.
 * Renders nothing once the job completes.
 */
export const AgentMigrationBadge = memo<MigrationTarget>(({ agentId, groupId }) => {
  const { t } = useTranslation('chat');
  const { data } = useAgentTransferJob({ agentId, groupId });

  if (!data) return null;

  return (
    <Tooltip title={t('transferMigration.agentBanner.desc')}>
      <Flexbox horizontal align={'center'} className={chipStyles.chip} gap={6}>
        <Icon spin color={cssVar.colorWarning} icon={Loader2} size={12} />
        <span>
          {t(
            data.type === 'copy'
              ? 'transferMigration.agentBadgeCopy'
              : 'transferMigration.agentBadge',
            {
              completed: data.completedTopics,
              total: data.totalTopics,
            },
          )}
        </span>
      </Flexbox>
    </Tooltip>
  );
});

AgentMigrationBadge.displayName = 'AgentMigrationBadge';
