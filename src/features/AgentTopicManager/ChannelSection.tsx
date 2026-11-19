'use client';

import { CHANNEL_URL } from '@lobechat/const';
import type { ChannelListItem } from '@lobechat/types';
import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { Hash } from 'lucide-react';
import { type KeyboardEvent, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActivityTime } from '@/hooks/useActivityTime';
import { densityTokens } from '@/styles/density.stylex';

export const channelCardStyles = stylex.create({
  // Same column rules as the topic grid, so Channel cards line up with the topics below them.
  grid: {
    display: 'grid',
    gap: densityTokens['--lobe-density-content-gap'],
    gridTemplateColumns: {
      default: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
      [media.md]: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
    },
    minWidth: 0,
    width: '100%',
  },
  card: {
    cursor: 'pointer',
    minHeight: 96,
    padding: 14,
    transform: { 'default': null, ':hover': 'translateY(-1px)' },
    boxShadow: { 'default': null, ':hover': '0 4px 12px rgb(0 0 0 / 6%)' },
    transitionDuration: '0.18s',
    transitionProperty: 'transform, box-shadow',
  },
  icon: { color: cssVar.colorTextDescription, flexShrink: 0 },
  title: {
    flex: '1',
    minWidth: 0,
  },
  preview: {
    display: '-webkit-box',
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  },
  footer: {
    color: cssVar.colorTextQuaternary,
    fontSize: 11,
    marginBlockStart: 'auto',
  },
});

const ChannelCard = memo<{ channel: ChannelListItem }>(({ channel }) => {
  const { t } = useTranslation('topic');
  const navigate = useWorkspaceAwareNavigate();
  const activity = useActivityTime(channel.updatedAt ?? channel.createdAt);
  const open = () => navigate(CHANNEL_URL(channel.id, null, channel.projectId));
  const preview = channel.lastMessage?.content?.trim();

  return (
    <Block
      className={stylex.props(channelCardStyles.card).className}
      gap={8}
      role={'link'}
      tabIndex={0}
      variant={'outlined'}
      onClick={open}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Enter') open();
      }}
    >
      <Flexbox horizontal align={'center'} gap={6}>
        <Icon className={stylex.props(channelCardStyles.icon).className} icon={Hash} size={14} />
        <Text
          ellipsis
          className={stylex.props(channelCardStyles.title).className}
          fontSize={14}
          weight={600}
        >
          {channel.title}
        </Text>
        {channel.status === 'archived' && (
          <Tag size={'small'}>{t('management.filters.status.archived')}</Tag>
        )}
      </Flexbox>
      {preview && (
        <Text
          className={stylex.props(channelCardStyles.preview).className}
          fontSize={12}
          type={'secondary'}
        >
          {preview}
        </Text>
      )}
      <span title={activity.title} {...stylex.props(channelCardStyles.footer)}>
        {activity.text}
      </span>
    </Block>
  );
});

ChannelCard.displayName = 'AgentTopicManagerChannelCard';

/**
 * The group Channels an Agent takes part in. Its run topics there are private execution
 * context and never listed, so the Channel itself is the entry to those conversations.
 */
const ChannelSection = memo<{ channels: ChannelListItem[] }>(({ channels }) => {
  const { t } = useTranslation('topic');
  if (channels.length === 0) return null;

  return (
    <Flexbox gap={12}>
      <Flexbox gap={2}>
        <Text fontSize={13} type={'secondary'} weight={500}>
          {t('management.channels.title')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {t('management.channels.desc')}
        </Text>
      </Flexbox>
      <div {...stylex.props(channelCardStyles.grid)}>
        {channels.map((channel) => (
          <ChannelCard channel={channel} key={channel.id} />
        ))}
      </div>
    </Flexbox>
  );
});

ChannelSection.displayName = 'AgentTopicManagerChannelSection';

export default ChannelSection;
