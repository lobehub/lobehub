'use client';

import { formatPrice, formatTokenNumber } from '@lobechat/utils/format';
import { Block, Checkbox, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleDollarSign, FolderIcon, MessageSquare, Star, Zap } from 'lucide-react';
import { memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { useActivityTime } from '@/hooks/useActivityTime';
import type { ChatTopic } from '@/types/topic';

import StatusDot from './StatusDot';
import { useTopicsViewStore } from './store';
import { getProjectLabel } from './utils';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    cursor: pointer;

    position: relative;

    display: flex;
    flex-direction: column;

    /* min-height keeps short cards consistent without forcing tall empty
       whitespace — preview + footer can still grow the card naturally. */
    min-height: 140px;
    padding: 14px;

    transition:
      transform 0.18s,
      box-shadow 0.18s,
      border-color 0.18s;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgb(0 0 0 / 6%);
    }
  `,
  cardSelected: css`
    border-color: ${cssVar.colorPrimary};
    box-shadow: 0 0 0 1px ${cssVar.colorPrimary};
  `,
  checkbox: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 10px;
    inset-inline-end: 10px;
  `,
  checkboxBox: css`
    border-color: ${cssVar.colorBorder};
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
  footer: css`
    /* push to bottom so cards with short content keep the stats row anchored */
    margin-block-start: auto;
    padding-block-start: 10px;
    border-block-start: 1px solid ${cssVar.colorSplit};
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    flex: 1;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  `,
}));

interface TopicCardProps {
  agentId: string;
  topic: ChatTopic;
}

const TopicCard = memo<TopicCardProps>(({ topic, agentId }) => {
  const { t } = useTranslation('topic');
  const navigate = useNavigate();

  const selectMode = useTopicsViewStore((s) => s.selectMode);
  const selected = useTopicsViewStore((s) => s.selectedIds.includes(topic.id));
  const toggleSelected = useTopicsViewStore((s) => s.toggleSelected);
  const toggleSelectMode = useTopicsViewStore((s) => s.toggleSelectMode);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (selectMode || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        toggleSelected(topic.id);
        return;
      }
      navigate(SESSION_CHAT_TOPIC_URL(agentId, topic.id));
    },
    [selectMode, topic.id, agentId, toggleSelected, navigate],
  );

  const handleCheckboxChange = useCallback(() => {
    if (!selectMode) toggleSelectMode();
    toggleSelected(topic.id);
  }, [selectMode, topic.id, toggleSelected, toggleSelectMode]);

  const stopPropagation = useCallback((e: MouseEvent) => {
    e.stopPropagation();
  }, []);

  const projectLabel = getProjectLabel(topic);
  const status = topic.status ?? 'active';
  // Preview priority: user-written description → AI history summary → first user
  // message (sliced server-side when neither richer field exists).
  const preview =
    topic.description?.trim() || topic.historySummary?.trim() || topic.firstUserMessage?.trim();
  const updatedAt = useActivityTime(topic.updatedAt);
  // Postgres `numeric` / `int` round-trip through TRPC/JSON as strings in
  // some shapes, so coerce defensively before any `.toFixed` / format call.
  const messageCount = Number(topic.messageCount ?? 0);
  const tokenUsage = Number(topic.tokenUsage ?? 0);
  const cost = Number(topic.cost ?? 0);

  return (
    <Block
      className={[styles.card, selected && styles.cardSelected].filter(Boolean).join(' ')}
      gap={8}
      variant={'outlined'}
      onClick={handleClick}
    >
      <div className={styles.checkbox} onClick={stopPropagation}>
        <Checkbox
          checked={selected}
          classNames={{ checkbox: styles.checkboxBox }}
          size={18}
          onChange={handleCheckboxChange}
        />
      </div>

      <Flexbox horizontal align={'center'} gap={6}>
        {topic.favorite && (
          <Icon icon={Star} size={13} style={{ color: cssVar.colorWarning, flexShrink: 0 }} />
        )}
        <Text className={styles.title} fontSize={14} weight={600}>
          {topic.title || t('defaultTitle')}
        </Text>
      </Flexbox>

      {preview && (
        <Text className={styles.description} fontSize={12} type={'secondary'}>
          {preview}
        </Text>
      )}

      {projectLabel && (
        <Tag bordered={false} icon={<Icon icon={FolderIcon} size={11} />} size={'small'}>
          {projectLabel}
        </Tag>
      )}

      <Flexbox horizontal align={'center'} className={styles.footer} justify={'space-between'}>
        <Flexbox
          horizontal
          align={'center'}
          gap={10}
          style={{ color: cssVar.colorTextQuaternary, fontSize: 11 }}
        >
          {messageCount > 0 && (
            <Flexbox horizontal align={'center'} gap={3}>
              <Icon icon={MessageSquare} size={11} />
              {messageCount}
            </Flexbox>
          )}
          {tokenUsage > 0 && (
            <Flexbox horizontal align={'center'} gap={3} title={`${tokenUsage} tokens`}>
              <Icon icon={Zap} size={11} />
              {formatTokenNumber(tokenUsage)}
            </Flexbox>
          )}
          {cost > 0 && (
            <Flexbox horizontal align={'center'} gap={3} title={`$${cost.toFixed(4)}`}>
              <Icon icon={CircleDollarSign} size={11} />
              {formatPrice(cost, 2)}
            </Flexbox>
          )}
          <span title={updatedAt.title}>{updatedAt.text}</span>
        </Flexbox>
        <StatusDot status={status} />
      </Flexbox>
    </Block>
  );
});

TopicCard.displayName = 'AgentTopicCard';

export default TopicCard;
