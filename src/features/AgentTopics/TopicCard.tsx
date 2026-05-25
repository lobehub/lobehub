'use client';

import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, FolderIcon, Star } from 'lucide-react';
import { memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { useActivityTime } from '@/hooks/useActivityTime';
import type { ChatTopic } from '@/types/topic';

import StatusDot from './StatusDot';
import { useTopicsViewStore } from './store';
import { getProjectLabel } from './utils';

// Module-scoped class string so the card's `:hover` rule can target the
// checkbox without a circular reference inside `createStaticStyles`.
const CHECKBOX_CLASS = 'agent-topic-card__checkbox';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    cursor: pointer;

    position: relative;

    display: flex;
    flex-direction: column;

    padding: 14px;

    transition:
      transform 0.18s,
      box-shadow 0.18s,
      border-color 0.18s;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgb(0 0 0 / 6%);
    }

    &:hover .${CHECKBOX_CLASS} {
      opacity: 1;
    }
  `,
  cardSelected: css`
    border-color: ${cssVar.colorPrimary};
    box-shadow: 0 0 0 1px ${cssVar.colorPrimary};
  `,
  checkbox: css`
    cursor: pointer;

    position: absolute;
    z-index: 1;
    inset-block-start: 10px;
    inset-inline-end: 10px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border: 1.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 4px;

    opacity: 0;
    background: ${cssVar.colorBgContainer};

    transition:
      opacity 0.15s,
      border-color 0.15s;

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  checkboxChecked: css`
    border-color: ${cssVar.colorPrimary};
    color: #fff;
    opacity: 1 !important;
    background: ${cssVar.colorPrimary};
  `,
  checkboxVisible: css`
    opacity: 1;
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
  footer: css`
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

  const handleCheckboxClick = useCallback(
    (e: MouseEvent) => {
      // Stop the card's onClick from firing — checkbox owns its own behaviour:
      // enters select-mode on first click and toggles this card's selection.
      e.stopPropagation();
      if (!selectMode) toggleSelectMode();
      toggleSelected(topic.id);
    },
    [selectMode, topic.id, toggleSelected, toggleSelectMode],
  );

  const projectLabel = getProjectLabel(topic);
  const status = topic.status ?? 'active';
  const preview = topic.description?.trim() || topic.historySummary?.trim();
  const updatedAt = useActivityTime(topic.updatedAt);

  return (
    <Block
      className={[styles.card, selected && styles.cardSelected].filter(Boolean).join(' ')}
      gap={8}
      variant={'outlined'}
      onClick={handleClick}
    >
      <span
        className={[
          styles.checkbox,
          CHECKBOX_CLASS,
          (selectMode || selected) && styles.checkboxVisible,
          selected && styles.checkboxChecked,
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={handleCheckboxClick}
      >
        {selected && <Icon icon={Check} size={12} />}
      </span>

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
        <Text fontSize={11} style={{ color: cssVar.colorTextQuaternary }} title={updatedAt.title}>
          {updatedAt.text}
        </Text>
        <StatusDot status={status} />
      </Flexbox>
    </Block>
  );
});

TopicCard.displayName = 'AgentTopicCard';

export default TopicCard;
