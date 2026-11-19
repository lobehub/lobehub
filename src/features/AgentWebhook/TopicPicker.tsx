'use client';

import { Flexbox, Icon, Input, Popover, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react';
import { memo, type UIEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { densityTokens } from '@/styles/density.stylex';

import { useWebhookTopics, type WebhookTopicOption } from './useWebhookTopics';

const styles = stylex.create({
  item: {
    alignItems: 'center',
    display: 'flex',
    gap: '8px',
    inlineSize: '100%',
    minInlineSize: 0,
    paddingBlock: '6px',
    paddingInline: '8px',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: cssVar.borderRadiusSM,
    font: 'inherit',
    color: cssVar.colorText,
    textAlign: 'start',
    cursor: 'pointer',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  itemText: { flex: '1', minInlineSize: 0 },
  list: { overflowY: 'auto', maxBlockSize: '280px' },
  muted: { fontSize: '12px', color: cssVar.colorTextTertiary },
  trigger: {
    alignItems: 'center',
    display: 'flex',
    gap: '8px',
    inlineSize: '100%',
    paddingBlock: '6px',
    paddingInline: densityTokens['--lobe-density-content-gap'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    font: 'inherit',
    color: cssVar.colorText,
    textAlign: 'start',
    cursor: 'pointer',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

/** Scrolling within this distance of the end loads the next page. */
const LOAD_MORE_THRESHOLD = 48;

interface TopicPickerProps {
  agentId: string;
  onChange: (topic: WebhookTopicOption | undefined) => void;
  /** The picked topic; undefined: the webhook keeps a topic of its own. */
  value?: WebhookTopicOption;
}

/**
 * Which topic a `reuse` webhook continues: one of the caller's topics of this agent, found by
 * searching or by scrolling a list that loads as it goes, or a topic of the webhook's own.
 */
const TopicPicker = memo<TopicPickerProps>(({ agentId, onChange, value }) => {
  const { t } = useTranslation('agent');
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const { error, loading, loadMore, loadingMore, topics } = useWebhookTopics(
    agentId,
    keyword,
    open,
  );
  const titleOf = (topic: WebhookTopicOption) => topic.title?.trim() || t('webhook.topic.untitled');

  const pick = (topic: WebhookTopicOption | undefined) => {
    onChange(topic);
    setOpen(false);
  };
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < LOAD_MORE_THRESHOLD) loadMore();
  };

  const row = (topic: WebhookTopicOption | undefined) => {
    const selected = topic ? value?.id === topic.id : !value;
    return (
      <button
        key={topic?.id ?? 'own'}
        type={'button'}
        {...stylex.props(styles.item)}
        onClick={() => pick(topic)}
      >
        <Flexbox gap={2} {...stylex.props(styles.itemText)}>
          <Text ellipsis>{topic ? titleOf(topic) : t('webhook.topic.own')}</Text>
          <span {...stylex.props(styles.muted)}>
            {topic
              ? topic.updatedAt && dayjs(topic.updatedAt).format('YYYY-MM-DD HH:mm')
              : t('webhook.topic.ownHint')}
          </span>
        </Flexbox>
        {selected && <Icon icon={CheckIcon} size={14} />}
      </button>
    );
  };

  const content = (
    <Flexbox gap={8} style={{ inlineSize: 'min(80vw, 420px)' }}>
      <Input
        allowClear
        placeholder={t('webhook.topic.searchPlaceholder')}
        prefix={<Icon icon={SearchIcon} size={14} />}
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <Flexbox gap={2} {...stylex.props(styles.list)} onScroll={onScroll}>
        {!keyword.trim() && row(undefined)}
        {topics.map((topic) => row(topic))}
        {(loading || loadingMore) && (
          <Flexbox horizontal justify={'center'} paddingBlock={8}>
            <Spin size={'small'} />
          </Flexbox>
        )}
        {!loading && !error && topics.length === 0 && keyword.trim() && (
          <Text style={{ paddingBlock: 12, textAlign: 'center' }} type={'secondary'}>
            {t('webhook.topic.empty')}
          </Text>
        )}
        {error && (
          <Text style={{ paddingBlock: 12, textAlign: 'center' }} type={'danger'}>
            {t('webhook.topic.loadFailed')}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      open={open}
      placement={'bottomLeft'}
      onOpenChange={setOpen}
    >
      <button type={'button'} {...stylex.props(styles.trigger)}>
        <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
          {value ? titleOf(value) : t('webhook.topic.own')}
        </Text>
        <Icon icon={ChevronDownIcon} size={14} />
      </button>
    </Popover>
  );
});

TopicPicker.displayName = 'AgentWebhookTopicPicker';

export default TopicPicker;
