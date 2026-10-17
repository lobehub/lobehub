'use client';

import { Block, createStaticStyles, Flexbox, Tag, Text, useTheme } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '@/types/botRuntimeStatus';

import { type ChannelPlatformDefinition, getPlatformIcon } from './const';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: stretch;

    min-height: 104px;
    padding-block: 12px;
    padding-inline: 12px;

    transition:
      transform 0.18s,
      box-shadow 0.18s,
      border-color 0.18s;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgb(0 0 0 / 6%);
    }
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    line-height: 1.5;
  `,
  statusDot: css`
    flex-shrink: 0;

    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 1px ${cssVar.colorBgContainer};
  `,
  titleRow: css`
    width: 100%;
    min-width: 0;
  `,
  trailing: css`
    flex-shrink: 0;
  `,
}));

interface PlatformCardProps {
  onSelect: (id: string) => void;
  platform: ChannelPlatformDefinition;
  /** Live runtime status of this platform's bot, when one is configured. */
  status?: BotRuntimeStatus;
}

/** One channel platform: icon, name, plan / coming-soon badges, runtime status and description. */
const PlatformCard = memo<PlatformCardProps>(({ onSelect, platform, status }) => {
  const { t } = useTranslation(['agent', 'common']);
  const theme = useTheme();

  const getPlatformDescription = (id: string, name: string) => {
    switch (id) {
      case 'discord': {
        return t('channel.platform.discord.description');
      }
      case 'feishu': {
        return t('channel.platform.feishu.description');
      }
      case 'imessage': {
        return t('channel.platform.imessage.description');
      }
      case 'lark': {
        return t('channel.platform.lark.description');
      }
      case 'line': {
        return t('channel.platform.line.description');
      }
      case 'qq': {
        return t('channel.platform.qq.description');
      }
      case 'slack': {
        return t('channel.platform.slack.description');
      }
      case 'telegram': {
        return t('channel.platform.telegram.description');
      }
      case 'wechat': {
        return t('channel.platform.wechat.description');
      }
      case 'whatsapp': {
        return t('channel.platform.whatsapp.description');
      }
      default: {
        return t('channel.platform.default.description', { name });
      }
    }
  };

  const getStatusColor = (status?: BotRuntimeStatus) => {
    switch (status) {
      case BOT_RUNTIME_STATUSES.connected: {
        return theme.colorSuccess;
      }
      case BOT_RUNTIME_STATUSES.failed: {
        return theme.colorError;
      }
      case BOT_RUNTIME_STATUSES.queued:
      case BOT_RUNTIME_STATUSES.starting: {
        return theme.colorInfo;
      }
      case BOT_RUNTIME_STATUSES.dormant: {
        return theme.colorWarning;
      }
      case BOT_RUNTIME_STATUSES.disconnected: {
        return theme.colorTextQuaternary;
      }
      default: {
        return undefined;
      }
    }
  };

  const getStatusTitle = (status?: BotRuntimeStatus) => {
    switch (status) {
      case BOT_RUNTIME_STATUSES.connected: {
        return t('channel.connectSuccess');
      }
      case BOT_RUNTIME_STATUSES.failed: {
        return t('channel.connectFailed');
      }
      case BOT_RUNTIME_STATUSES.queued: {
        return t('channel.connectQueued');
      }
      case BOT_RUNTIME_STATUSES.starting: {
        return t('channel.connectStarting');
      }
      case BOT_RUNTIME_STATUSES.dormant: {
        return t('channel.statusDormant');
      }
      case BOT_RUNTIME_STATUSES.disconnected: {
        return t('channel.runtimeDisconnected');
      }
      default: {
        return undefined;
      }
    }
  };

  const PlatformIcon = getPlatformIcon(platform.name);
  const ColorIcon =
    PlatformIcon && 'Color' in PlatformIcon ? (PlatformIcon as any).Color : PlatformIcon;
  const runtimeStatus = platform.comingSoon ? undefined : status;
  const statusColor = getStatusColor(runtimeStatus);
  const statusTitle = getStatusTitle(runtimeStatus);
  const description = getPlatformDescription(platform.id, platform.name);

  return (
    <Block
      clickable
      className={styles.card}
      variant={'outlined'}
      onClick={() => onSelect(platform.id)}
    >
      <Flexbox horizontal align={'center'} className={styles.titleRow} gap={8}>
        {ColorIcon && <ColorIcon size={24} />}
        <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={600}>
          {platform.name}
        </Text>
        <Flexbox horizontal align={'center'} className={styles.trailing} gap={4}>
          {platform.comingSoon && (
            <Tag size={'small'} style={{ marginInlineEnd: 0 }}>
              {t('channel.comingSoon')}
            </Tag>
          )}
          {platform.access?.requiredPlan === 'paid' && (
            <Tag color="gold" size={'small'} style={{ marginInlineEnd: 0 }}>
              {platform.access.rolloutMode === 'notice'
                ? t('channel.paidFeature.noticeBadge')
                : t('channel.paidFeature.badge')}
            </Tag>
          )}
          {runtimeStatus && (
            <div
              className={styles.statusDot}
              style={{ background: statusColor }}
              title={statusTitle}
            />
          )}
        </Flexbox>
      </Flexbox>
      <Text className={styles.description} fontSize={12} type={'secondary'}>
        {description}
      </Text>
    </Block>
  );
});

PlatformCard.displayName = 'PlatformCard';

export default PlatformCard;
