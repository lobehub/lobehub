'use client';

import { CHANNEL_URL } from '@lobechat/const';
import type { InboundWebhookItem } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = stylex.create({
  link: {
    overflow: 'hidden',
    display: 'block',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorLink },
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  muted: { fontSize: '12px', color: cssVar.colorTextTertiary },
});

/** Where a row's run results are posted, when it delivers to a Channel; null otherwise. */
export const channelTargetOf = (item: InboundWebhookItem) => {
  const delivery = item.source.delivery;
  if (!delivery) return null;
  return { delivery, visible: item.channel };
};

/**
 * The Channel (or Thread) a webhook or subscription posts its results to, linked when the viewer
 * is a member; a Channel they are not in is named only as such.
 */
const ChannelTarget = memo<{ item: InboundWebhookItem }>(({ item }) => {
  const { t } = useTranslation('setting');
  const target = channelTargetOf(item);
  if (!target) return null;
  const { visible } = target;
  if (!visible)
    return <span {...stylex.props(styles.muted)}>{t('automations.target.channelHidden')}</span>;

  const channel = visible.title?.trim() || t('automations.target.untitledChannel');
  const label = visible.threadId
    ? t('automations.target.channelThread', {
        channel,
        thread: visible.threadTitle?.trim() || t('automations.target.untitledThread'),
      })
    : t('automations.target.channel', { channel });
  return (
    <WorkspaceLink
      title={label}
      to={CHANNEL_URL(visible.id, visible.threadId, visible.projectId)}
      {...stylex.props(styles.link)}
      onClick={(event) => event.stopPropagation()}
    >
      {label}
    </WorkspaceLink>
  );
});

ChannelTarget.displayName = 'AutomationChannelTarget';

export default ChannelTarget;
