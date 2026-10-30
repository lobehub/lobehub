'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { formatPrice, formatTokenNumber } from '@lobechat/utils/format';
import { Block, Checkbox, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleDollarSign, FolderIcon, GitBranchIcon, MessageSquare, Pin, Zap } from 'lucide-react';
import { memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { getPlatformIcon } from '@/features/AgentChannel/const';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActivityTime } from '@/hooks/useActivityTime';
import type { ChatTopic } from '@/types/topic';

import StatusDot from './StatusDot';
import { useTopicsViewStore } from './store';
import moduleStyles from './TopicCard.module.css';
import { getProjectInfo } from './utils';

const styles = stylex.create({
  projectLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  card: {
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '140px',
    padding: '14px',
    transition: 'transform 0.18s,\n      box-shadow 0.18s,\n      border-color 0.18s',
    transform: { 'default': null, ':hover': 'translateY(-1px)' },
    boxShadow: { 'default': null, ':hover': '0 4px 12px rgb(0 0 0 / 6%)' },
  },
  cardSelected: { borderColor: cssVar.colorPrimary, boxShadow: `0 0 0 1px ${cssVar.colorPrimary}` },
  checkbox: { position: 'absolute', zIndex: 1, insetBlockStart: '10px', insetInlineEnd: '10px' },
  checkboxBox: { borderColor: cssVar.colorBorder },
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
  },
  footer: {
    marginBlockStart: 'auto',
    paddingBlockStart: '10px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorSplit,
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    flex: '1',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
  },
  titleRow: { paddingInlineEnd: '28px' },
});

interface TopicCardProps {
  agentId: string;
  topic: ChatTopic;
}

const TopicCard = memo<TopicCardProps>(({ topic, agentId }) => {
  const { t } = useTranslation('topic');
  const navigate = useWorkspaceAwareNavigate();

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
      navigate(AGENT_CHAT_TOPIC_URL(agentId, topic.id));
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

  const project = getProjectInfo(topic);
  const status = topic.status ?? 'active';
  // Bot source platform icon (same identity mark as the sidebar topic item).
  const botPlatform = topic.metadata?.bot?.platform;
  const BotPlatformIcon = botPlatform ? getPlatformIcon(botPlatform) : undefined;
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
      gap={8}
      variant={'outlined'}
      className={[
        stylex.props(styles.card).className,
        stylex.props(selected && styles.cardSelected).className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
    >
      <div {...stylex.props(styles.checkbox)} onClick={stopPropagation}>
        <Checkbox
          checked={selected}
          classNames={{ checkbox: stylex.props(styles.checkboxBox).className }}
          size={18}
          onChange={handleCheckboxChange}
        />
      </div>

      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.titleRow).className}
        gap={6}
      >
        {topic.favorite && (
          <Icon icon={Pin} size={13} style={{ color: cssVar.colorTextTertiary, flexShrink: 0 }} />
        )}
        {BotPlatformIcon && (
          <BotPlatformIcon
            color={cssVar.colorTextDescription}
            size={14}
            style={{ flexShrink: 0 }}
          />
        )}
        <Text className={stylex.props(styles.title).className} fontSize={14} weight={600}>
          {topic.title || t('defaultTitle')}
        </Text>
      </Flexbox>

      {preview && (
        <Text
          className={stylex.props(styles.description).className}
          fontSize={12}
          type={'secondary'}
        >
          {preview}
        </Text>
      )}

      {project && (
        <Flexbox gap={4}>
          <Tag
            className={moduleStyles.projectTag}
            icon={<Icon icon={FolderIcon} size={11} />}
            size={'small'}
            title={project.path}
          >
            <span className={stylex.props(styles.projectLabel).className}>{project.path}</span>
          </Tag>
          {project.branch && (
            <Tag
              className={moduleStyles.projectTag}
              icon={<Icon icon={GitBranchIcon} size={11} />}
              size={'small'}
              title={project.branch}
            >
              <span className={stylex.props(styles.projectLabel).className}>{project.branch}</span>
            </Tag>
          )}
        </Flexbox>
      )}

      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.footer).className}
        justify={'space-between'}
      >
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
