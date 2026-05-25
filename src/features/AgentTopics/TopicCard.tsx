'use client';

import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2, FolderIcon, MessageSquare, Star } from 'lucide-react';
import { memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import type { ChatTopic } from '@/types/topic';

import { useTopicsViewStore } from './store';
import { formatRelativeTime, getProjectLabel } from './utils';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    cursor: pointer;

    position: relative;

    display: flex;
    flex-direction: column;

    min-height: 200px;
    padding: 16px;

    transition:
      transform 0.18s,
      box-shadow 0.18s,
      border-color 0.18s;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgb(0 0 0 / 4%);
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
    inset-inline-start: 10px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border: 1.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 4px;

    opacity: 0;
    background: ${cssVar.colorBgContainer};

    transition: opacity 0.15s;
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
  footer: css`
    padding-block-start: 10px;
    border-block-start: 1px solid ${cssVar.colorSplit};
  `,
  preview: css`
    overflow: hidden;
    display: -webkit-box;
    flex: 1;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;

    margin-block-end: 12px;
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    flex: 1;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  `,
}));

const STATUS_COLOR_MAP: Record<string, string> = {
  active: 'success',
  archived: 'warning',
  completed: 'default',
  failed: 'error',
  paused: 'processing',
  running: 'processing',
  waitingForHuman: 'processing',
};

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

  const projectLabel = getProjectLabel(topic);
  const status = topic.status ?? 'active';
  const statusColor = STATUS_COLOR_MAP[status] ?? 'default';
  const statusLabelKey = `management.status.${status}` as const;

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
          (selectMode || selected) && styles.checkboxVisible,
          selected && styles.checkboxChecked,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {selected && <Icon icon={CheckCircle2} size={12} />}
      </span>

      <Flexbox horizontal align={'flex-start'} gap={8} justify={'space-between'}>
        <Text className={styles.title} fontSize={14} weight={600}>
          {topic.title || t('defaultTitle')}
        </Text>
        {topic.favorite && (
          <Icon icon={Star} size={14} style={{ color: cssVar.colorWarning, flexShrink: 0 }} />
        )}
      </Flexbox>

      <Text className={styles.preview} fontSize={12} type={'secondary'}>
        {topic.historySummary || t('management.card.noPreview')}
      </Text>

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
          <Flexbox horizontal align={'center'} gap={3}>
            <Icon icon={MessageSquare} size={11} />
            {formatRelativeTime(topic.updatedAt)}
          </Flexbox>
        </Flexbox>
        <Tag color={statusColor as any} size={'small'}>
          {t(statusLabelKey as any)}
        </Tag>
      </Flexbox>
    </Block>
  );
});

TopicCard.displayName = 'AgentTopicCard';

export default TopicCard;
