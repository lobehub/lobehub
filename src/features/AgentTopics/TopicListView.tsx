'use client';

import { Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Checkbox } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderIcon, Star } from 'lucide-react';
import { memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import type { ChatTopic } from '@/types/topic';

import { useTopicsViewStore } from './store';
import { formatRelativeTime, getProjectLabel } from './utils';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    display: grid;
    grid-template-columns: 28px 28px 1fr 140px 110px 70px 110px;
    gap: 12px;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.04em;

    background: ${cssVar.colorFillQuaternary};
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 28px 28px 1fr 140px 110px 70px 110px;
    gap: 12px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    transition: background 0.12s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:last-child {
      border-block-end: none;
    }
  `,
  rowSelected: css`
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
  sub: css`
    overflow: hidden;
    margin-block-start: 2px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

interface TopicListViewProps {
  agentId: string;
  topics: ChatTopic[];
}

interface RowProps {
  agentId: string;
  topic: ChatTopic;
}

const Row = memo<RowProps>(({ topic, agentId }) => {
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

  const status = topic.status ?? 'active';
  const projectLabel = getProjectLabel(topic);
  const statusLabelKey = `management.status.${status}` as const;

  return (
    <div
      className={[styles.row, selected && styles.rowSelected].filter(Boolean).join(' ')}
      onClick={handleClick}
    >
      <Checkbox
        checked={selected}
        onChange={() => toggleSelected(topic.id)}
        onClick={(e) => e.stopPropagation()}
      />
      <Flexbox align={'center'} justify={'center'}>
        {topic.favorite && <Icon icon={Star} size={13} style={{ color: cssVar.colorWarning }} />}
      </Flexbox>
      <div>
        <Text className={styles.title} fontSize={13} weight={500}>
          {topic.title || t('defaultTitle')}
        </Text>
        {topic.historySummary && (
          <Text className={styles.sub} fontSize={11} type={'secondary'}>
            {topic.historySummary}
          </Text>
        )}
      </div>
      <div>
        {projectLabel ? (
          <Tag bordered={false} icon={<Icon icon={FolderIcon} size={11} />} size={'small'}>
            {projectLabel}
          </Tag>
        ) : (
          <Text fontSize={12} type={'secondary'}>
            —
          </Text>
        )}
      </div>
      <Tag color={(STATUS_COLOR_MAP[status] ?? 'default') as any} size={'small'}>
        {t(statusLabelKey as any)}
      </Tag>
      <Text fontSize={12} type={'secondary'}>
        {topic.trigger ?? 'chat'}
      </Text>
      <Text fontSize={12} style={{ color: cssVar.colorTextQuaternary }}>
        {formatRelativeTime(topic.updatedAt)}
      </Text>
    </div>
  );
});

Row.displayName = 'AgentTopicsRow';

const TopicListView = memo<TopicListViewProps>(({ topics, agentId }) => {
  const { t } = useTranslation('topic');

  return (
    <div className={styles.list}>
      <div className={styles.header}>
        <span />
        <span />
        <span>{t('management.columns.title')}</span>
        <span>{t('management.columns.project')}</span>
        <span>{t('management.columns.status')}</span>
        <span>{t('management.columns.trigger')}</span>
        <span>{t('management.columns.updated')}</span>
      </div>
      {topics.map((topic) => (
        <Row agentId={agentId} key={topic.id} topic={topic} />
      ))}
    </div>
  );
});

TopicListView.displayName = 'AgentTopicsListView';

export default TopicListView;
