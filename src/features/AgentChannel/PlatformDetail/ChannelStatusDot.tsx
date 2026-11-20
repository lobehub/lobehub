'use client';

import { Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '@/types/botRuntimeStatus';

const styles = stylex.create({
  dot: {
    blockSize: 12,
    borderRadius: '50%',
    // A ring in the page colour keeps the dot readable on top of the logo tile.
    boxShadow: `0 0 0 2px ${cssVar.colorBgContainer}`,
    display: 'block',
    inlineSize: 12,
    insetBlockEnd: -2,
    insetInlineEnd: -2,
    position: 'absolute',
  },
  connected: { backgroundColor: cssVar.colorSuccess },
  disconnected: { backgroundColor: cssVar.colorTextQuaternary },
  dormant: { backgroundColor: cssVar.colorWarning },
  failed: { backgroundColor: cssVar.colorError },
  pending: { backgroundColor: cssVar.colorInfo },
});

const TONES: Partial<Record<BotRuntimeStatus, keyof typeof styles>> = {
  [BOT_RUNTIME_STATUSES.connected]: 'connected',
  [BOT_RUNTIME_STATUSES.disconnected]: 'disconnected',
  [BOT_RUNTIME_STATUSES.dormant]: 'dormant',
  [BOT_RUNTIME_STATUSES.failed]: 'failed',
  [BOT_RUNTIME_STATUSES.queued]: 'pending',
  [BOT_RUNTIME_STATUSES.starting]: 'pending',
};

const LABELS: Partial<Record<BotRuntimeStatus, string>> = {
  [BOT_RUNTIME_STATUSES.connected]: 'channel.statusConnected',
  [BOT_RUNTIME_STATUSES.disconnected]: 'channel.statusDisconnected',
  [BOT_RUNTIME_STATUSES.dormant]: 'channel.statusDormant',
  [BOT_RUNTIME_STATUSES.failed]: 'channel.statusFailed',
  [BOT_RUNTIME_STATUSES.queued]: 'channel.statusQueued',
  [BOT_RUNTIME_STATUSES.starting]: 'channel.statusStarting',
};

/**
 * The bot's connection state as a dot on the bottom-right corner of its logo, the way a chat app
 * marks someone online. The state's name is in the tooltip and the accessible label.
 */
export const ChannelStatusDot = memo<{ status?: BotRuntimeStatus }>(({ status }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;

  const tone = status ? TONES[status] : undefined;
  const label = status ? LABELS[status] : undefined;
  if (!tone || !label) return null;

  return (
    <Tooltip title={t(label)}>
      <span
        aria-label={t(label)}
        data-status={status}
        role={'img'}
        {...stylex.props(styles.dot, styles[tone])}
      />
    </Tooltip>
  );
});

ChannelStatusDot.displayName = 'ChannelStatusDot';
